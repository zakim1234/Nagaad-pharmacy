import mongoose from 'mongoose';
import SalarySheet from '../models/SalarySheet.js';
import User from '../models/User.js';
import Account from '../models/Account.js';
import Expense from '../models/Expense.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { logAudit } from '../services/auditService.js';
import { postExpense, voidExpenseDoc } from '../services/expenseService.js';
import { resolveExpenseCategory } from '../services/expenseCategoryService.js';
import { parseExpenseDate } from './expenseController.js';
import { currentBranch } from '../services/branchContext.js';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function sheetToDTO(s) {
  if (!s) return null;
  return {
    id: s._id,
    sheetNumber: s.sheetNumber,
    period: s.period,
    status: s.status,
    note: s.note,
    rows: s.rows.map((r) => ({
      user: r.user,
      name: r.name,
      role: r.role,
      amount: fromCents(r.amountCents),
      expense: r.expense,
      expenseNumber: r.expenseNumber,
    })),
    total: fromCents(s.rows.reduce((t, r) => t + r.amountCents, 0)),
    paymentAccountName: s.paymentAccountName,
    paymentDate: s.paymentDate,
    paidAt: s.paidAt,
    paidByName: s.paidByName,
    cancelledAt: s.cancelledAt,
    cancelReason: s.cancelReason,
    cancelledByName: s.cancelledByName,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// GET /api/salaries/sheet -- everyone who works here (active users), the
// sheet being prepared (if any) and the last paid sheet, whose amounts
// pre-fill a new month.
export const getSalarySheet = asyncHandler(async (req, res) => {
  const [users, open, lastPaid] = await Promise.all([
    User.find({ active: { $ne: false }, ...(currentBranch() ? { branch: currentBranch() } : {}) }).select('name username role').sort({ name: 1 }),
    SalarySheet.findOne({ status: 'OPEN' }).sort({ createdAt: -1 }),
    SalarySheet.findOne({ status: 'PAID' }).sort({ paidAt: -1 }),
  ]);
  res.json({
    success: true,
    data: {
      people: users.map((u) => ({ userId: u._id, name: u.name, username: u.username, role: u.role })),
      open: sheetToDTO(open),
      lastPaid: sheetToDTO(lastPaid),
    },
  });
});

// PUT /api/salaries/sheet -- saves the open sheet (period, amount per person).
export const saveSalarySheet = asyncHandler(async (req, res) => {
  const { period, rows = [], note = '' } = req.body;
  if (!PERIOD.test(String(period || ''))) throw new ApiError(400, 'Choose the month these salaries are for.');
  if (!Array.isArray(rows) || rows.length > 1000) throw new ApiError(400, 'Invalid salary lines.');
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const ids = rows.map((r) => String(r.userId || ''));
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'Each person can appear only once.');
  const users = new Map((await User.find({ _id: { $in: ids.filter((id) => mongoose.isValidObjectId(id)) } }).select('name role')).map((u) => [String(u._id), u]));
  const built = [];
  for (const r of rows) {
    const u = users.get(String(r.userId));
    if (!u) throw new ApiError(400, 'One of the people on the sheet no longer exists.');
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, `${u.name}: enter a valid salary.`);
    if (toCents(amount) === 0) continue;
    built.push({ user: u._id, name: u.name, role: u.role, amountCents: toCents(amount) });
  }
  let sheet = await SalarySheet.findOne({ status: 'OPEN' }).sort({ createdAt: -1 });
  if (!sheet) {
    const seq = await nextSequence('salarySheet');
    sheet = new SalarySheet({ sheetNumber: `SAL-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`, createdBy: req.user?._id || null });
  }
  sheet.period = period;
  sheet.rows = built;
  sheet.note = String(note).trim();
  await sheet.save();
  res.json({ success: true, data: sheetToDTO(sheet) });
});

// POST /api/salaries/sheet/pay -- pays every line of the open sheet from one
// account, each as a "Salaries" expense, all-or-nothing.
export const paySalarySheet = asyncHandler(async (req, res) => {
  const { paymentAccountId } = req.body;
  if (!paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  const paymentDate = parseExpenseDate(req.body.paymentDate);
  if (paymentDate > new Date(Date.now() + 12 * 3600 * 1000)) throw new ApiError(400, 'The payment date cannot be in the future.');
  const category = await resolveExpenseCategory('Salaries');

  const sheet = await runInTransaction(async (session) => {
    const open = await SalarySheet.findOne({ status: 'OPEN' }).sort({ createdAt: -1 }).session(session);
    if (!open || !open.rows.some((r) => r.amountCents > 0)) throw new ApiError(400, 'There are no salaries to pay. Enter and save the amounts first.');
    const account = await Account.findById(paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    for (const row of open.rows) {
      if (row.amountCents <= 0) continue;
      const expense = await postExpense(session, {
        category,
        amountCents: row.amountCents,
        date: paymentDate,
        account,
        note: `Salary ${open.period} — ${row.name} (${open.sheetNumber})`,
        user: req.user,
      });
      row.expense = expense._id;
      row.expenseNumber = expense.expenseNumber;
    }
    open.status = 'PAID';
    open.paymentAccount = account._id;
    open.paymentAccountName = account.name;
    open.paymentDate = paymentDate;
    open.paidAt = new Date();
    open.paidByName = req.user?.name || '';
    await open.save({ session });
    return open;
  });

  await logAudit({
    user: req.user,
    action: 'salary.pay',
    entityType: 'SalarySheet',
    entityId: sheet._id,
    details: { sheetNumber: sheet.sheetNumber, period: sheet.period, people: sheet.rows.length, total: fromCents(sheet.rows.reduce((t, r) => t + r.amountCents, 0)) },
  });
  res.json({ success: true, data: sheetToDTO(sheet) });
});

// GET /api/salaries/sheets -- every sheet, newest first.
export const listSalarySheets = asyncHandler(async (req, res) => {
  const sheets = await SalarySheet.find().sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, data: sheets.map(sheetToDTO) });
});

// GET /api/salaries/sheets/:id
export const getSalarySheetById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Salary sheet not found.');
  const sheet = await SalarySheet.findById(req.params.id);
  if (!sheet) throw new ApiError(404, 'Salary sheet not found.');
  res.json({ success: true, data: sheetToDTO(sheet) });
});

// POST /api/salaries/sheets/:id/cancel -- voids every salary expense of a
// paid sheet; the money goes back to the account. The sheet is kept,
// marked Cancelled.
export const cancelSalarySheet = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Salary sheet not found.');
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  const { sheet, refundedCents } = await runInTransaction(async (session) => {
    const s = await SalarySheet.findById(req.params.id).session(session);
    if (!s) throw new ApiError(404, 'Salary sheet not found.');
    if (s.status !== 'PAID') throw new ApiError(409, s.status === 'CANCELLED' ? 'This sheet is already cancelled.' : 'This sheet has not been paid yet.');
    let refunded = 0;
    for (const row of s.rows) {
      if (!row.expense) continue;
      const exp = await Expense.findById(row.expense).session(session);
      if (!exp || exp.status === 'VOIDED') continue;
      await voidExpenseDoc(session, exp, { reason: reason || `${s.sheetNumber} cancelled`, user: req.user });
      refunded += exp.amountCents;
    }
    s.status = 'CANCELLED';
    s.cancelledAt = new Date();
    s.cancelReason = reason;
    s.cancelledByName = req.user?.name || '';
    await s.save({ session });
    return { sheet: s, refundedCents: refunded };
  });
  await logAudit({ user: req.user, action: 'salary.cancel', entityType: 'SalarySheet', entityId: sheet._id, details: { sheetNumber: sheet.sheetNumber, refunded: fromCents(refundedCents), reason } });
  res.json({ success: true, data: { ...sheetToDTO(sheet), refunded: fromCents(refundedCents) } });
});

// GET /api/salaries/statement?userId=&from=YYYY-MM-DD&to=YYYY-MM-DD -- every
// salary actually paid (paid sheets only; cancelled ones are left out), for
// everyone or one person, oldest first, with totals per person.
export const getSalaryStatement = asyncHandler(async (req, res) => {
  const { userId } = req.query;
  if (userId && !mongoose.isValidObjectId(userId)) throw new ApiError(400, 'Unknown person.');
  const filter = { status: 'PAID' };
  if (req.query.from || req.query.to) {
    filter.paymentDate = {};
    if (req.query.from) filter.paymentDate.$gte = parseExpenseDate(req.query.from);
    if (req.query.to) filter.paymentDate.$lte = new Date(parseExpenseDate(req.query.to).getTime() + 12 * 3600 * 1000);
  }
  if (userId) filter['rows.user'] = userId;
  const sheets = await SalarySheet.find(filter).sort({ paymentDate: 1, createdAt: 1 });

  const lines = [];
  for (const s of sheets) {
    for (const r of s.rows) {
      if (userId && String(r.user) !== String(userId)) continue;
      lines.push({
        user: r.user,
        name: r.name,
        role: r.role,
        period: s.period,
        paymentDate: s.paymentDate,
        sheetId: s._id,
        sheetNumber: s.sheetNumber,
        expenseNumber: r.expenseNumber,
        account: s.paymentAccountName,
        amount: fromCents(r.amountCents),
      });
    }
  }
  const byPerson = new Map();
  for (const l of lines) {
    const k = String(l.user);
    const p = byPerson.get(k) || { user: l.user, name: l.name, role: l.role, payments: 0, totalCents: 0 };
    p.payments += 1;
    p.totalCents += Math.round(l.amount * 100);
    byPerson.set(k, p);
  }
  const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)).map(({ totalCents, ...p }) => ({ ...p, total: fromCents(totalCents) }));
  res.json({
    success: true,
    data: {
      lines,
      people,
      total: fromCents(lines.reduce((t, l) => t + Math.round(l.amount * 100), 0)),
      range: { from: req.query.from || null, to: req.query.to || null },
    },
  });
});
