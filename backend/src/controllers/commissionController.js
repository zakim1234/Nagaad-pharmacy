import CommissionPayment from '../models/CommissionPayment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { previewCommission, payCommission, cancelCommission } from '../services/commissionService.js';

function toDTO(c) {
  return {
    id: c._id,
    commissionNumber: c.commissionNumber,
    periodType: c.periodType,
    periodKey: c.periodKey,
    baseProfit: fromCents(c.baseProfitCents),
    accountName: c.accountName,
    date: c.date,
    note: c.note,
    total: fromCents(c.totalCents),
    status: c.status,
    cancelledAt: c.cancelledAt,
    cancelledByName: c.cancelledByName,
    cancelReason: c.cancelReason,
    createdByName: c.createdByName,
    createdAt: c.createdAt,
    lines: c.lines.map((l) => ({ user: l.user, name: l.name, role: l.role, percent: l.percent, amount: fromCents(l.amountCents) })),
  };
}

// GET /api/commissions/preview?type=month|year&key=2026-10|2026
export const commissionPreview = asyncHandler(async (req, res) => {
  const r = await previewCommission({ type: req.query.type, key: req.query.key });
  res.json({
    success: true,
    data: {
      type: r.type,
      key: r.key,
      baseProfit: fromCents(r.baseProfitCents),
      staff: r.staff.map((u) => ({ id: u._id, name: u.name, username: u.username, role: u.role })),
      earlier: r.earlier.map(toDTO),
    },
  });
});

// GET /api/commissions -- every commission payment, newest first.
export const listCommissions = asyncHandler(async (req, res) => {
  const filter = req.query.type ? { periodType: req.query.type } : {};
  const docs = await CommissionPayment.find(filter).sort({ periodKey: -1, createdAt: -1 });
  res.json({ success: true, data: docs.map(toDTO) });
});

export const getCommission = asyncHandler(async (req, res) => {
  const doc = await CommissionPayment.findById(req.params.id);
  if (!doc) throw new ApiError(404, 'Commission payment not found.');
  res.json({ success: true, data: toDTO(doc) });
});

// POST /api/commissions -- pay commission for one month or year.
export const createCommission = asyncHandler(async (req, res) => {
  const doc = await payCommission({ ...req.body, user: req.user });
  await logAudit({ user: req.user, action: 'commission.pay', entityType: 'CommissionPayment', entityId: doc._id, details: { period: doc.periodKey, total: fromCents(doc.totalCents) } });
  res.status(201).json({ success: true, data: toDTO(doc) });
});

// POST /api/commissions/:id/cancel -- voids its expenses (money back).
export const cancelCommissionHandler = asyncHandler(async (req, res) => {
  const doc = await cancelCommission({ id: req.params.id, reason: req.body.reason, user: req.user });
  await logAudit({ user: req.user, action: 'commission.cancel', entityType: 'CommissionPayment', entityId: doc._id, details: { reason: doc.cancelReason } });
  res.json({ success: true, data: toDTO(doc) });
});
