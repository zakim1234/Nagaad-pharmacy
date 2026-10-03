// One-off catch-up: for every customer who currently owes debt while also
// holding wallet credit (possible before Close Day learned to draw on the
// wallet -- e.g. money deposited while a credit sale was still a Draft),
// pays that debt from the wallet now, oldest invoice first, recorded as a
// normal debt payment. Safe to run more than once: customers with no debt
// or an empty wallet are skipped.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Customer from '../models/Customer.js';
import { runInTransaction } from './transaction.js';
import { applyWalletToDebt } from '../services/walletService.js';

async function run() {
  await connectDB();
  const candidates = await Customer.find({ balanceCents: { $gt: 0 }, walletBalanceCents: { $gt: 0 } }).select('_id name');
  console.log(`[wallet-debt] ${candidates.length} customer(s) owe debt while holding wallet credit`);

  for (const { _id, name } of candidates) {
    const appliedCents = await runInTransaction(async (session) => {
      const customer = await Customer.findById(_id).session(session);
      return applyWalletToDebt(customer, session, null);
    });
    console.log(`[wallet-debt] ${name}: paid ${(appliedCents / 100).toFixed(2)} from wallet`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[wallet-debt] failed:', err);
  process.exit(1);
});
