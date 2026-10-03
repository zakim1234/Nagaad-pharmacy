import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';

function toDTO(a) {
  return {
    id: a._id,
    name: a.name,
    type: a.type,
    accountNumber: a.accountNumber,
    openingBalance: fromCents(a.openingBalanceCents),
    currentBalance: fromCents(a.currentBalanceCents),
    isActive: a.isActive,
    createdAt: a.createdAt,
  };
}

// GET /api/accounts -- cards for the Accounts page: posted balance plus
// today's still-pending (Draft) receipts, so the page stays transparent
// about money that hasn't actually landed yet.
export const listAccounts = asyncHandler(async (req, res) => {
  const accounts = await Account.find().sort({ createdAt: 1 });
  const { start, end } = resolveDateRange({ range: 'today' });

  const pendingAgg = await AccountTransaction.aggregate([
    { $match: { status: 'PENDING', createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: { account: '$account', direction: '$direction' }, amount: { $sum: '$amountCents' } } },
  ]);
  const pendingByAccount = new Map();
  for (const row of pendingAgg) {
    const key = String(row._id.account);
    const entry = pendingByAccount.get(key) || { inCents: 0, outCents: 0 };
    if (row._id.direction === 'IN') entry.inCents += row.amount;
    else entry.outCents += row.amount;
    pendingByAccount.set(key, entry);
  }

  const totalBalanceCents = accounts.reduce((sum, a) => sum + a.currentBalanceCents, 0);

  res.json({
    success: true,
    data: {
      totalBalance: fromCents(totalBalanceCents),
      accounts: accounts.map((a) => {
        const pending = pendingByAccount.get(String(a._id)) || { inCents: 0, outCents: 0 };
        const pendingNetCents = pending.inCents - pending.outCents;
        return {
          ...toDTO(a),
          pendingToday: fromCents(pendingNetCents),
          expectedAfterClose: fromCents(a.currentBalanceCents + pendingNetCents),
        };
      }),
    },
  });
});

export const getAccount = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Account not found.');
  res.json({ success: true, data: toDTO(account) });
});

export const createAccount = asyncHandler(async (req, res) => {
  const { name, type = 'OTHER', accountNumber = '', openingBalance = 0 } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Account name is required.');

  const openingBalanceCents = toCents(openingBalance);
  const account = await Account.create({
    name: name.trim(),
    type,
    accountNumber: accountNumber.trim(),
    openingBalanceCents,
    currentBalanceCents: openingBalanceCents,
  });

  await logAudit({ user: req.user, action: 'account.create', entityType: 'Account', entityId: account._id, details: { name: account.name } });
  res.status(201).json({ success: true, data: toDTO(account) });
});

export const updateAccount = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Account not found.');

  const { name, type, accountNumber, isActive } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Account name cannot be empty.');
    account.name = name.trim();
  }
  if (type !== undefined) account.type = type;
  if (accountNumber !== undefined) account.accountNumber = accountNumber.trim();
  // Accounts with financial history should be deactivated, not deleted --
  // this is the only way isActive can be flipped.
  if (isActive !== undefined) account.isActive = !!isActive;

  await account.save();
  await logAudit({ user: req.user, action: 'account.update', entityType: 'Account', entityId: account._id, details: req.body });
  res.json({ success: true, data: toDTO(account) });
});

// GET /api/accounts/:id/transactions -- the ledger behind this account's balance
export const getAccountTransactions = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Account not found.');

  const { page = 1, limit = 30, status } = req.query;
  const filter = { account: account._id };
  if (status) filter.status = status;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 30));

  const [items, total] = await Promise.all([
    AccountTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    AccountTransaction.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      account: toDTO(account),
      transactions: items.map((t) => ({
        id: t._id,
        status: t.status,
        direction: t.direction,
        type: t.type,
        amount: fromCents(t.amountCents),
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        description: t.description,
        balanceBefore: t.balanceBeforeCents !== null ? fromCents(t.balanceBeforeCents) : null,
        balanceAfter: t.balanceAfterCents !== null ? fromCents(t.balanceAfterCents) : null,
        createdAt: t.createdAt,
        postedAt: t.postedAt,
      })),
    },
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/accounts/report -- money in/out by account for a date range
export const accountsReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const accounts = await Account.find().sort({ createdAt: 1 });

  const agg = await AccountTransaction.aggregate([
    { $match: { status: 'POSTED', postedAt: { $gte: start, $lte: end } } },
    { $group: { _id: { account: '$account', direction: '$direction' }, amount: { $sum: '$amountCents' } } },
  ]);
  const byAccount = new Map();
  for (const row of agg) {
    const key = String(row._id.account);
    const entry = byAccount.get(key) || { inCents: 0, outCents: 0 };
    if (row._id.direction === 'IN') entry.inCents += row.amount;
    else entry.outCents += row.amount;
    byAccount.set(key, entry);
  }

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      accounts: accounts.map((a) => {
        const entry = byAccount.get(String(a._id)) || { inCents: 0, outCents: 0 };
        return {
          id: a._id,
          name: a.name,
          openingBalance: fromCents(a.openingBalanceCents),
          moneyIn: fromCents(entry.inCents),
          moneyOut: fromCents(entry.outCents),
          currentBalance: fromCents(a.currentBalanceCents),
        };
      }),
    },
  });
});

export { toDTO as accountToDTO };
