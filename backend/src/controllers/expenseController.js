import Expense from '../models/Expense.js';
import { listExpenseCategories, resolveExpenseCategory, addExpenseCategory } from '../services/expenseCategoryService.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { postImmediateTransaction } from '../services/accountService.js';
import { logAudit } from '../services/auditService.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { runInTransaction } from '../utils/transaction.js';

function toDTO(e) {
  return {
    id: e._id,
    expenseNumber: e.expenseNumber,
    category: e.category,
    amount: fromCents(e.amountCents),
    date: e.date,
    paymentAccount: e.paymentAccount,
    paymentAccountName: e.paymentAccountName,
    note: e.note,
    status: e.status,
    voidedAt: e.voidedAt,
    voidReason: e.voidReason,
    createdByName: e.createdByName,
    createdAt: e.createdAt,
  };
}

async function generateExpenseNumber(session) {
  const seq = await nextSequence('expense', session);
  return `EXP-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
}

// Expense dates are calendar days, not instants. Anchoring them at local noon
// keeps them inside the right day for every from/to range the reports build,
// whatever timezone the server runs in.
function parseExpenseDate(value) {
  if (!value) return new Date();
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError(400, 'Enter a valid expense date.');
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Enter a valid expense date.');
  return date;
}

// GET /api/expenses/categories
export const getExpenseCategories = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listExpenseCategories() });
});

// POST /api/expenses/categories -- admin/manager only (enforced at the route).
export const createExpenseCategory = asyncHandler(async (req, res) => {
  const name = await addExpenseCategory(req.body.name);
  await logAudit({ user: req.user, action: 'expense.category.create', entityType: 'ExpenseCategory', details: { name } });
  res.status(201).json({ success: true, data: { name, categories: await listExpenseCategories() } });
});

// POST /api/expenses
export const createExpense = asyncHandler(async (req, res) => {
  const { amount, date, paymentAccountId, note = '' } = req.body;
  const category = await resolveExpenseCategory(req.body.category);
  const amountNumber = Number(amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0 || !Number.isSafeInteger(toCents(amountNumber)) || toCents(amountNumber) <= 0) {
    throw new ApiError(400, 'Amount must be greater than zero.');
  }
  if (!paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const amountCents = toCents(amountNumber);
  const expenseDate = parseExpenseDate(date);

  const expense = await runInTransaction(async (session) => {
    const account = await Account.findById(paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

    const expenseNumber = await generateExpenseNumber(session);
    const txn = await postImmediateTransaction(
      {
        account,
        direction: 'OUT',
        type: 'EXPENSE',
        amountCents,
        referenceType: 'Expense',
        referenceId: null, // filled below once the expense _id exists
        description: `Expense ${expenseNumber} - ${category}${note ? `: ${note}` : ''}`,
        createdBy: req.user,
      },
      session
    );

    const [created] = await Expense.create(
      [
        {
          expenseNumber,
          category,
          amountCents,
          date: expenseDate,
          paymentAccount: account._id,
          paymentAccountName: account.name,
          accountTransaction: txn._id,
          note: String(note).trim(),
          createdBy: req.user?._id || null,
          createdByName: req.user?.name || '',
        },
      ],
      { session }
    );
    txn.referenceId = created._id;
    await txn.save({ session });
    return created;
  });

  await logAudit({
    user: req.user,
    action: 'expense.create',
    entityType: 'Expense',
    entityId: expense._id,
    details: { expenseNumber: expense.expenseNumber, category, amount: amountNumber, account: expense.paymentAccountName },
  });

  res.status(201).json({ success: true, data: toDTO(expense) });
});

// GET /api/expenses?range=|from=|to=&category=&includeVoided=
// `summary.totalThisMonth` is always the calendar month to date regardless of
// the list's own filters, mirroring the "Total This Month" line on the page.
export const listExpenses = asyncHandler(async (req, res) => {
  const { category, includeVoided } = req.query;
  const filter = {};
  if (req.query.range || req.query.from || req.query.to) {
    const { start, end } = resolveDateRange(req.query);
    filter.date = { $gte: start, $lte: end };
  }
  if (category) {
    filter.category = await resolveExpenseCategory(category);
  }
  if (includeVoided !== 'true') filter.status = 'POSTED';

  const month = resolveDateRange({ range: 'month' });
  const [expenses, [monthAgg], [filteredAgg]] = await Promise.all([
    Expense.find(filter).sort({ date: -1, createdAt: -1 }).limit(500),
    Expense.aggregate([
      { $match: { status: 'POSTED', date: { $gte: month.start, $lte: month.end } } },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]),
    Expense.aggregate([
      { $match: { ...filter, status: 'POSTED' } },
      { $group: { _id: null, total: { $sum: '$amountCents' } } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      expenses: expenses.map(toDTO),
      summary: { totalThisMonth: fromCents(monthAgg?.total || 0), totalFiltered: fromCents(filteredAgg?.total || 0) },
      categories: await listExpenseCategories(),
    },
  });
});

// POST /api/expenses/:id/void -- admin/manager only (enforced at the route).
// Puts the money back into the account it left as one compensating IN
// transaction; the original expense and its OUT transaction stay on record.
export const voidExpense = asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  const expense = await runInTransaction(async (session) => {
    const doc = await Expense.findById(req.params.id).session(session);
    if (!doc) throw new ApiError(404, 'Expense not found.');
    if (doc.status === 'VOIDED') throw new ApiError(409, 'This expense has already been voided.');

    const account = await Account.findById(doc.paymentAccount).session(session);
    if (!account) throw new ApiError(409, 'The account this expense was paid from no longer exists. Contact an administrator.');

    await postImmediateTransaction(
      {
        account,
        direction: 'IN',
        type: 'REFUND',
        amountCents: doc.amountCents,
        referenceType: 'Expense',
        referenceId: doc._id,
        description: `Void of expense ${doc.expenseNumber}${reason ? ` (${reason})` : ''}`,
        createdBy: req.user,
      },
      session
    );

    doc.status = 'VOIDED';
    doc.voidedAt = new Date();
    doc.voidReason = reason;
    doc.voidedBy = req.user?._id || null;
    await doc.save({ session });
    return doc;
  });

  await logAudit({
    user: req.user,
    action: 'expense.void',
    entityType: 'Expense',
    entityId: expense._id,
    details: { expenseNumber: expense.expenseNumber, reason },
  });

  res.json({ success: true, data: toDTO(expense) });
});
