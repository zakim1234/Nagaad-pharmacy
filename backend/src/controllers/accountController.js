import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import DayClose from '../models/DayClose.js';
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

// Only the admin sees what the accounts really hold. Everyone else sees the
// money that came in and went out since the last Close Day -- what they took
// today -- which is back to 0 once the day is closed.
const seesBalances = (user) => user?.role === 'admin' || !!user?.isSuperAdmin;

async function lastCloseAt() {
  const last = await DayClose.findOne({ reopened: { $ne: true } }).sort({ closedAt: -1 }).select('closedAt').lean();
  return last?.closedAt || new Date(0);
}

// Net POSTED cents per account since `since`.
async function postedSince(since, accountId = null) {
  const match = { status: 'POSTED', postedAt: { $gte: since } };
  if (accountId) match.account = accountId;
  const rows = await AccountTransaction.aggregate([
    { $match: match },
    { $group: { _id: '$account', cents: { $sum: { $cond: [{ $eq: ['$direction', 'IN'] }, '$amountCents', { $multiply: ['$amountCents', -1] }] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.cents]));
}

// The balance a user is shown for an account, and the opening they see.
async function balancesFor(user, accounts) {
  if (seesBalances(user)) {
    return { scope: 'all', since: null, balanceOf: (a) => a.currentBalanceCents, openingOf: (a) => a.openingBalanceCents };
  }
  const since = await lastCloseAt();
  const net = await postedSince(since);
  return { scope: 'sinceClose', since, balanceOf: (a) => net.get(String(a._id)) || 0, openingOf: () => 0 };
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

  const view = await balancesFor(req.user, accounts);
  const totalBalanceCents = accounts.reduce((sum, a) => sum + view.balanceOf(a), 0);

  res.json({
    success: true,
    data: {
      scope: view.scope,
      since: view.since,
      totalBalance: fromCents(totalBalanceCents),
      accounts: accounts.map((a) => {
        const pending = pendingByAccount.get(String(a._id)) || { inCents: 0, outCents: 0 };
        const pendingNetCents = pending.inCents - pending.outCents;
        return {
          ...toDTO(a),
          openingBalance: fromCents(view.openingOf(a)),
          currentBalance: fromCents(view.balanceOf(a)),
          pendingToday: fromCents(pendingNetCents),
          expectedAfterClose: fromCents(view.balanceOf(a) + pendingNetCents),
        };
      }),
    },
  });
});

export const getAccount = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Account not found.');
  const view = await balancesFor(req.user, [account]);
  res.json({ success: true, data: { ...toDTO(account), openingBalance: fromCents(view.openingOf(account)), currentBalance: fromCents(view.balanceOf(account)), scope: view.scope } });
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
  const staff = !seesBalances(req.user);
  if (staff) filter.createdAt = { $gte: await lastCloseAt() };
  const view = await balancesFor(req.user, [account]);

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
      account: { ...toDTO(account), openingBalance: fromCents(view.openingOf(account)), currentBalance: fromCents(view.balanceOf(account)) },
      scope: view.scope,
      transactions: items.map((t) => ({
        id: t._id,
        status: t.status,
        direction: t.direction,
        type: t.type,
        amount: fromCents(t.amountCents),
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        description: t.description,
        balanceBefore: !staff && t.balanceBeforeCents !== null ? fromCents(t.balanceBeforeCents) : null,
        balanceAfter: !staff && t.balanceAfterCents !== null ? fromCents(t.balanceAfterCents) : null,
        createdAt: t.createdAt,
        postedAt: t.postedAt,
      })),
    },
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/accounts/report -- money in/out by account for a date range
export const accountsReport = asyncHandler(async (req, res) => {
  const range = resolveDateRange(req.query);
  const accounts = await Account.find().sort({ createdAt: 1 });
  const view = await balancesFor(req.user, accounts);
  // Staff never see further back than the last Close Day.
  const start = view.since && view.since > range.start ? view.since : range.start;
  const end = range.end;

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
      scope: view.scope,
      since: view.since,
      range: { from: start, to: end },
      accounts: accounts.map((a) => {
        const entry = byAccount.get(String(a._id)) || { inCents: 0, outCents: 0 };
        return {
          id: a._id,
          name: a.name,
          openingBalance: fromCents(view.openingOf(a)),
          moneyIn: fromCents(entry.inCents),
          moneyOut: fromCents(entry.outCents),
          currentBalance: fromCents(view.balanceOf(a)),
        };
      }),
    },
  });
});

export { toDTO as accountToDTO };

// GET /api/accounts/:id/statement?range|from&to -- one account's money in and
// out over a period, oldest first: what each amount was (type), why (its
// description: invoice, expense, refund and the number, reason...), who did
// it, and the balance after -- opening and closing balance around it.
export const getAccountStatement = asyncHandler(async (req, res) => {
  const account = await Account.findById(req.params.id);
  if (!account) throw new ApiError(404, 'Account not found.');
  const range = resolveDateRange(req.query);
  const staff = !seesBalances(req.user);
  const since = staff ? await lastCloseAt() : null;
  const start = since && since > range.start ? since : range.start;
  const end = range.end;

  const [before] = staff ? [null] : await AccountTransaction.aggregate([
    { $match: { account: account._id, status: 'POSTED', postedAt: { $lt: start } } },
    { $group: { _id: null, cents: { $sum: { $cond: [{ $eq: ['$direction', 'IN'] }, '$amountCents', { $multiply: ['$amountCents', -1] }] } } } },
  ]);
  const openingCents = staff ? 0 : (account.openingBalanceCents || 0) + (before?.cents || 0);

  const items = await AccountTransaction.find({ account: account._id, status: 'POSTED', postedAt: { $gte: start, $lte: end } })
    .sort({ postedAt: 1, _id: 1 })
    .limit(5000)
    .populate('createdBy', 'name')
    .lean();

  let running = openingCents;
  let inCents = 0;
  let outCents = 0;
  const rows = items.map((t) => {
    const delta = t.direction === 'IN' ? t.amountCents : -t.amountCents;
    running += delta;
    if (t.direction === 'IN') inCents += t.amountCents;
    else outCents += t.amountCents;
    return {
      id: t._id,
      date: t.postedAt,
      direction: t.direction,
      type: t.type,
      amount: fromCents(t.amountCents),
      description: t.description || '',
      referenceType: t.referenceType,
      referenceId: t.referenceId,
      byName: t.createdBy?.name || '',
      balanceAfter: fromCents(running),
    };
  });

  res.json({
    success: true,
    data: {
      account: { ...toDTO(account), openingBalance: staff ? 0 : fromCents(account.openingBalanceCents), currentBalance: staff ? null : fromCents(account.currentBalanceCents) },
      scope: staff ? 'sinceClose' : 'all',
      range: { from: start, to: end },
      opening: fromCents(openingCents),
      moneyIn: fromCents(inCents),
      moneyOut: fromCents(outCents),
      closing: fromCents(openingCents + inCents - outCents),
      rows,
    },
  });
});
