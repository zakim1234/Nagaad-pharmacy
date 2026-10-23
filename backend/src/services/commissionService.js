import mongoose from 'mongoose';
import CommissionPayment from '../models/CommissionPayment.js';
import Expense from '../models/Expense.js';
import User from '../models/User.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { computePeriod } from './profitLossService.js';
import { postExpense, voidExpenseDoc } from './expenseService.js';
import { resolveExpenseCategory } from './expenseCategoryService.js';
import { periodRange } from './itemsSoldService.js';
import { currentBranch } from './branchContext.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';

const COMMISSION = 'Commission';

function range(type, key) {
  if (!['month', 'year'].includes(type)) throw new ApiError(400, 'Choose monthly or yearly.');
  return periodRange(type, key); // [start, end)
}

// The period's profit before commissions: the P&L net income with any
// commission already posted in it added back, so paying commission never
// shrinks the base it is a percentage of.
export async function profitBeforeCommissionCents(type, key) {
  const { start, end } = range(type, key);
  const last = new Date(end.getTime() - 1);
  const [{ netIncomeCents }, [paid]] = await Promise.all([
    computePeriod({ start, end: last, basis: 'accrual' }),
    Expense.aggregate([
      { $match: { status: 'POSTED', category: COMMISSION, date: { $gte: start, $lt: end } } },
      { $group: { _id: null, cents: { $sum: '$amountCents' } } },
    ]),
  ]);
  return netIncomeCents + (paid?.cents || 0);
}

// Who can receive commission: the branch's active users (staff and admins).
export async function commissionStaff() {
  return User.find({ active: { $ne: false }, ...(currentBranch() ? { branch: currentBranch() } : {}) })
    .select('name username role branch isSuperAdmin')
    .sort({ name: 1 });
}

export async function previewCommission({ type, key }) {
  const { start, end } = range(type, key);
  const [baseProfitCents, staff, earlier] = await Promise.all([
    profitBeforeCommissionCents(type, key),
    commissionStaff(),
    CommissionPayment.find({ periodType: type, periodKey: key, status: 'ACTIVE' }).sort({ createdAt: 1 }),
  ]);
  return { type, key, start, end, baseProfitCents, staff, earlier };
}

export async function payCommission({ type, key, kind = 'STAFF', paymentAccountId, lines, note = '', user }) {
  const { start, end } = range(type, key);
  if (!['STAFF', 'ADMIN'].includes(kind)) throw new ApiError(400, 'Choose staff or admin commission.');
  if (kind === 'ADMIN' && !user?.isSuperAdmin) throw new ApiError(403, 'Only the Super Admin pays commission to branch admins.');
  if (!Array.isArray(lines) || !lines.length) throw new ApiError(400, 'Choose who gets commission and their percentage.');
  if (!paymentAccountId) throw new ApiError(400, 'Choose the account the commission is paid from.');
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const cleaned = lines.map((l, i) => {
    const percent = Number(l.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new ApiError(400, `Line ${i + 1}: the percentage must be more than 0 and at most 100.`);
    return { userId: l.userId || null, name: String(l.name || '').trim(), percent: Math.round(percent * 100) / 100 };
  });
  const totalPercent = cleaned.reduce((s, l) => s + l.percent, 0);
  if (totalPercent > 100.0001) throw new ApiError(400, `Commission cannot be more than 100% of the profit (now ${Math.round(totalPercent * 100) / 100}%).`);

  const baseProfitCents = await profitBeforeCommissionCents(type, key);
  if (baseProfitCents <= 0) throw new ApiError(400, 'This period has no profit to pay commission on.');
  const category = await resolveExpenseCategory(COMMISSION);
  // The expense lands inside the period it is for: today, or the period's
  // last day when paying for a period that has already ended.
  const now = new Date();
  const date = now < end ? now : new Date(end.getTime() - 12 * 3600 * 1000);

  return runInTransaction(async (session) => {
    const account = await Account.findById(paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected account is not available.');

    // Never the same person twice for the same period.
    const earlier = await CommissionPayment.find({ periodType: type, periodKey: key, status: 'ACTIVE' }).session(session);
    const paidUsers = new Set(earlier.flatMap((c) => c.lines.filter((l) => l.user).map((l) => String(l.user))));
    const paidNames = new Set(earlier.flatMap((c) => c.lines.filter((l) => !l.user).map((l) => l.name.toLowerCase())));
    const earlierPercent = earlier.reduce((s, c) => s + c.lines.reduce((x, l) => x + l.percent, 0), 0);
    if (earlierPercent + totalPercent > 100.0001) throw new ApiError(400, `This period already has ${earlierPercent}% commission paid; the total cannot go over 100%.`);

    const seq = await nextSequence('commission', session);
    const commissionNumber = `CM-${start.getFullYear()}-${String(seq).padStart(4, '0')}`;
    const periodLabel = type === 'year' ? key : key;
    const built = [];
    const seen = new Set();
    for (const l of cleaned) {
      let person = null;
      if (l.userId) {
        if (!mongoose.isValidObjectId(l.userId)) throw new ApiError(400, 'A selected person is not valid.');
        person = await User.findById(l.userId).select('name role').session(session);
        if (!person) throw new ApiError(404, 'A selected person no longer exists.');
      }
      const name = person?.name || l.name;
      if (!name) throw new ApiError(400, 'Enter the name of each person.');
      // Staff commission never goes to an admin, admin commission only to admins.
      if (kind === 'STAFF' && person?.role === 'admin') throw new ApiError(403, `${name} is an admin: their commission is paid by the Super Admin (Admin commission).`);
      if (kind === 'ADMIN' && person?.role !== 'admin') throw new ApiError(400, `${name} is not a branch admin; pay them under Staff commission.`);
      const who = person ? String(person._id) : `name:${name.toLowerCase()}`;
      if (seen.has(who)) throw new ApiError(400, `${name} is listed twice.`);
      seen.add(who);
      if ((person && paidUsers.has(String(person._id))) || (!person && paidNames.has(name.toLowerCase()))) {
        throw new ApiError(409, `${name} has already been paid commission for ${periodLabel}.`);
      }
      const amountCents = Math.round((baseProfitCents * l.percent) / 100);
      const expense =
        amountCents > 0
          ? await postExpense(session, { category, amountCents, date, account, note: `${commissionNumber} ${name} ${l.percent}% of ${periodLabel} profit`, user })
          : null;
      built.push({ user: person?._id || null, name, role: person?.role || '', percent: l.percent, amountCents, expense: expense?._id || null });
    }

    const [doc] = await CommissionPayment.create(
      [
        {
          commissionNumber,
          kind,
          periodType: type,
          periodKey: key,
          baseProfitCents,
          account: account._id,
          accountName: account.name,
          date,
          note: String(note).trim(),
          lines: built,
          totalCents: built.reduce((s, l) => s + l.amountCents, 0),
          createdBy: user?._id || null,
          createdByName: user?.name || '',
        },
      ],
      { session }
    );
    return doc;
  });
}

export async function cancelCommission({ id, reason = '', user }) {
  return runInTransaction(async (session) => {
    const doc = await CommissionPayment.findById(id).session(session);
    if (!doc) throw new ApiError(404, 'Commission payment not found.');
    if (doc.status === 'CANCELLED') throw new ApiError(409, 'This commission payment is already cancelled.');
    if (doc.kind === 'ADMIN' && !user?.isSuperAdmin) throw new ApiError(403, 'Only the Super Admin can cancel admin commission.');
    for (const line of doc.lines) {
      if (!line.expense) continue;
      const exp = await Expense.findById(line.expense).session(session);
      if (exp && exp.status !== 'VOIDED') await voidExpenseDoc(session, exp, { reason: reason || `${doc.commissionNumber} cancelled`, user });
    }
    doc.status = 'CANCELLED';
    doc.cancelledAt = new Date();
    doc.cancelledByName = user?.name || '';
    doc.cancelReason = String(reason || '').slice(0, 500);
    await doc.save({ session });
    return doc;
  });
}
