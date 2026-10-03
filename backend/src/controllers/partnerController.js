import Partner from '../models/Partner.js';
import PartnerCapitalTransaction from '../models/PartnerCapitalTransaction.js';
import Account from '../models/Account.js';
import { postImmediateTransaction } from '../services/accountService.js';
import { logAudit } from '../services/auditService.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';

function toDTO(p) {
  return {
    id: p._id,
    name: p.name,
    phone: p.phone,
    notes: p.notes,
    totalContributed: fromCents(p.totalContributedCents),
    totalWithdrawn: fromCents(p.totalWithdrawnCents),
    currentEquity: fromCents(p.currentEquityCents),
    isActive: p.isActive,
    createdAt: p.createdAt,
  };
}

function txnToDTO(t) {
  return {
    id: t._id,
    partner: t.partner,
    partnerName: t.partnerName,
    type: t.type,
    amount: fromCents(t.amountCents),
    account: t.account,
    accountName: t.accountName,
    date: t.date,
    note: t.note,
    equityBefore: fromCents(t.equityBeforeCents),
    equityAfter: fromCents(t.equityAfterCents),
    createdAt: t.createdAt,
  };
}

// Capital dates are calendar days, not instants -- anchored at local noon so
// they land on the right day for any report's from/to range regardless of
// the server's timezone.
function parseCapitalDate(value) {
  if (!value) return new Date();
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError(400, 'Enter a valid date.');
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Enter a valid date.');
  return date;
}

// GET /api/partners
export const listPartners = asyncHandler(async (req, res) => {
  const partners = await Partner.find({ isActive: true }).sort({ createdAt: 1 });
  const totalEquityCents = partners.reduce((sum, p) => sum + p.currentEquityCents, 0);
  res.json({ success: true, data: { totalEquity: fromCents(totalEquityCents), partners: partners.map(toDTO) } });
});

// POST /api/partners -- admin/manager only (enforced at the route)
export const createPartner = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'Partner name is required.');
  const existing = await Partner.findOne({ name, isActive: true }).collation({ locale: 'en', strength: 2 });
  if (existing) throw new ApiError(409, `A partner named "${existing.name}" already exists.`);

  const partner = await Partner.create({ name, phone: String(req.body.phone || '').trim(), notes: String(req.body.notes || '').trim() });
  await logAudit({ user: req.user, action: 'partner.create', entityType: 'Partner', entityId: partner._id, details: { name } });
  res.status(201).json({ success: true, data: toDTO(partner) });
});

// PUT /api/partners/:id -- admin/manager only. Only the partner's own
// details (name/phone/notes) can be changed here -- totalContributed/
// totalWithdrawn/currentEquity are derived from the capital ledger and are
// never editable directly; correcting a mistaken amount means correcting
// the specific Contribution/Withdrawal it came from, not the running total.
export const updatePartner = asyncHandler(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner || !partner.isActive) throw new ApiError(404, 'Partner not found.');

  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'Partner name is required.');
  const existing = await Partner.findOne({ _id: { $ne: partner._id }, name, isActive: true }).collation({ locale: 'en', strength: 2 });
  if (existing) throw new ApiError(409, `A partner named "${existing.name}" already exists.`);

  partner.name = name;
  if (req.body.phone !== undefined) partner.phone = String(req.body.phone || '').trim();
  if (req.body.notes !== undefined) partner.notes = String(req.body.notes || '').trim();
  await partner.save();

  await logAudit({ user: req.user, action: 'partner.update', entityType: 'Partner', entityId: partner._id, details: { name } });
  res.json({ success: true, data: toDTO(partner) });
});

function validateAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(toCents(n)) || toCents(n) <= 0) {
    throw new ApiError(400, 'Amount must be greater than zero.');
  }
  return toCents(n);
}

// POST /api/partners/:id/contribute -- admin/manager only. Money enters an
// Account exactly like any other cash receipt (postImmediateTransaction),
// and the partner's equity grows by the same amount in one transaction.
export const contributeCapital = asyncHandler(async (req, res) => {
  const amountCents = validateAmount(req.body.amount);
  if (!req.body.paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  if (String(req.body.note || '').length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const date = parseCapitalDate(req.body.date);

  const result = await runInTransaction(async (session) => {
    const partner = await Partner.findById(req.params.id).session(session);
    if (!partner || !partner.isActive) throw new ApiError(404, 'Partner not found.');
    const account = await Account.findById(req.body.paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

    const txn = await postImmediateTransaction(
      {
        account,
        direction: 'IN',
        type: 'PARTNER_CONTRIBUTION',
        amountCents,
        referenceType: 'Partner',
        referenceId: partner._id,
        description: `Capital contribution by ${partner.name}`,
        createdBy: req.user,
      },
      session
    );

    const equityBeforeCents = partner.currentEquityCents;
    partner.totalContributedCents += amountCents;
    partner.currentEquityCents += amountCents;
    await partner.save({ session });

    const [capitalTxn] = await PartnerCapitalTransaction.create(
      [
        {
          partner: partner._id,
          partnerName: partner.name,
          type: 'CONTRIBUTION',
          amountCents,
          account: account._id,
          accountName: account.name,
          accountTransaction: txn?._id || null,
          date,
          note: String(req.body.note || '').trim(),
          equityBeforeCents,
          equityAfterCents: partner.currentEquityCents,
          createdBy: req.user?._id || null,
        },
      ],
      { session }
    );
    return { partner, capitalTxn };
  });

  await logAudit({
    user: req.user,
    action: 'partner.contribute',
    entityType: 'Partner',
    entityId: result.partner._id,
    details: { amount: fromCents(amountCents), account: result.capitalTxn.accountName },
  });

  res.status(201).json({ success: true, data: { partner: toDTO(result.partner), transaction: txnToDTO(result.capitalTxn) } });
});

// POST /api/partners/:id/withdraw -- admin/manager only. Cannot exceed the
// partner's current equity, nor the chosen account's balance.
export const withdrawCapital = asyncHandler(async (req, res) => {
  const amountCents = validateAmount(req.body.amount);
  if (!req.body.paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  if (String(req.body.note || '').length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const date = parseCapitalDate(req.body.date);

  const result = await runInTransaction(async (session) => {
    const partner = await Partner.findById(req.params.id).session(session);
    if (!partner || !partner.isActive) throw new ApiError(404, 'Partner not found.');
    if (amountCents > partner.currentEquityCents) {
      throw new ApiError(400, `Amount exceeds this partner's current equity of ${fromCents(partner.currentEquityCents).toFixed(2)}.`);
    }
    const account = await Account.findById(req.body.paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    if (amountCents > account.currentBalanceCents) {
      throw new ApiError(400, `Amount exceeds the selected account's balance of ${fromCents(account.currentBalanceCents).toFixed(2)}.`);
    }

    const txn = await postImmediateTransaction(
      {
        account,
        direction: 'OUT',
        type: 'PARTNER_WITHDRAWAL',
        amountCents,
        referenceType: 'Partner',
        referenceId: partner._id,
        description: `Capital withdrawal by ${partner.name}`,
        createdBy: req.user,
      },
      session
    );

    const equityBeforeCents = partner.currentEquityCents;
    partner.totalWithdrawnCents += amountCents;
    partner.currentEquityCents -= amountCents;
    await partner.save({ session });

    const [capitalTxn] = await PartnerCapitalTransaction.create(
      [
        {
          partner: partner._id,
          partnerName: partner.name,
          type: 'WITHDRAWAL',
          amountCents,
          account: account._id,
          accountName: account.name,
          accountTransaction: txn?._id || null,
          date,
          note: String(req.body.note || '').trim(),
          equityBeforeCents,
          equityAfterCents: partner.currentEquityCents,
          createdBy: req.user?._id || null,
        },
      ],
      { session }
    );
    return { partner, capitalTxn };
  });

  await logAudit({
    user: req.user,
    action: 'partner.withdraw',
    entityType: 'Partner',
    entityId: result.partner._id,
    details: { amount: fromCents(amountCents), account: result.capitalTxn.accountName },
  });

  res.json({ success: true, data: { partner: toDTO(result.partner), transaction: txnToDTO(result.capitalTxn) } });
});

// GET /api/partners/:id/transactions
export const listPartnerTransactions = asyncHandler(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner) throw new ApiError(404, 'Partner not found.');
  const transactions = await PartnerCapitalTransaction.find({ partner: partner._id }).sort({ date: -1, createdAt: -1 });
  res.json({ success: true, data: transactions.map(txnToDTO) });
});

// Total current equity across all active partners, in cents -- used by the
// Balance Sheet and Zakat calculators. Not an HTTP handler.
export async function getTotalPartnerEquityCents() {
  const [agg] = await Partner.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, total: { $sum: '$currentEquityCents' } } }]);
  return agg?.total || 0;
}

// Each active partner's share of total equity as a percentage (0-100), used
// to split Zakat proportionally. Not an HTTP handler.
export async function getPartnerEquityBreakdown() {
  const partners = await Partner.find({ isActive: true }).sort({ createdAt: 1 });
  const totalCents = partners.reduce((sum, p) => sum + p.currentEquityCents, 0);
  return partners.map((p) => ({
    partnerId: p._id,
    name: p.name,
    equityCents: p.currentEquityCents,
    equityPct: totalCents > 0 ? Math.round((p.currentEquityCents / totalCents) * 10000) / 100 : 0,
  }));
}
