import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import DayClose from '../models/DayClose.js';
import { runInTransaction } from './transaction.js';

// One-time repair: Close Day used to empty every account with a "Close Day
// reset" adjustment (and a Reopen put it back with a "Reopen restoration").
// Accounts now keep their money, so this undoes those adjustments: each is
// marked REVERSED (kept, never deleted) and its amount goes back into the
// account. Safe to run more than once -- it only touches POSTED ones.
//   npm run fix:close-day-resets
async function restore() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required (backend/.env).');
  await connectDB();

  const summary = await runInTransaction(async (session) => {
    const txns = await AccountTransaction.find({
      type: 'ADJUSTMENT',
      status: 'POSTED',
      description: { $regex: '^(Close Day reset|Reopen restoration)' },
    })
      .sort({ createdAt: 1 })
      .session(session);

    const byAccount = new Map();
    for (const t of txns) {
      const account = await Account.findById(t.account).session(session);
      if (!account) continue;
      const entry = byAccount.get(String(account._id)) || { name: account.name, before: account.currentBalanceCents, count: 0 };
      // Undo it: money that went OUT comes back in, and the other way round.
      account.currentBalanceCents += t.direction === 'OUT' ? t.amountCents : -t.amountCents;
      await account.save({ session });
      t.status = 'REVERSED';
      t.reversedAt = new Date();
      t.description = `${t.description} -- undone: Close Day no longer empties accounts`;
      await t.save({ session });
      entry.count += 1;
      entry.after = account.currentBalanceCents;
      byAccount.set(String(account._id), entry);
    }
    await DayClose.updateMany({ balancesKept: { $ne: true } }, { $set: { balancesKept: true } }, { session });
    return { count: txns.length, accounts: [...byAccount.values()] };
  });

  if (!summary.count) {
    console.log('Nothing to restore -- no Close Day resets left.');
    return;
  }
  console.log(`Undid ${summary.count} Close Day reset entr${summary.count === 1 ? 'y' : 'ies'}:`);
  for (const a of summary.accounts) {
    console.log(`  ${a.name}: ${(a.before / 100).toFixed(2)} -> ${(a.after / 100).toFixed(2)}`);
  }
}

restore()
  .catch((error) => {
    console.error('Restore failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
