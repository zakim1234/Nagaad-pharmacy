import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import Account from '../models/Account.js';
import VendorPaymentPlan from '../models/VendorPaymentPlan.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { logAudit } from '../services/auditService.js';
import { paySupplier, OUTSTANDING } from '../services/supplierPaymentService.js';
import { parsePaymentDate } from './purchaseController.js';

function planToDTO(plan) {
  if (!plan) return null;
  return {
    id: plan._id,
    planNumber: plan.planNumber,
    status: plan.status,
    note: plan.note,
    rows: plan.rows.map((r) => ({
      supplier: r.supplier,
      supplierName: r.supplierName,
      owed: fromCents(r.owedCents),
      allocation: fromCents(r.allocationCents),
      paid: fromCents(r.paidCents),
      bulkPayment: r.bulkPayment,
      bulkNumber: r.bulkNumber,
    })),
    totalAllocated: fromCents(plan.rows.reduce((s, r) => s + r.allocationCents, 0)),
    totalPaid: fromCents(plan.rows.reduce((s, r) => s + r.paidCents, 0)),
    paymentAccountName: plan.paymentAccountName,
    paymentDate: plan.paymentDate,
    paidAt: plan.paidAt,
    paidByName: plan.paidByName,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

// What each supplier is owed right now (completed invoices with a balance).
async function owedBySupplier(session = null) {
  const rows = await Purchase.aggregate([
    { $match: OUTSTANDING },
    { $group: { _id: '$supplier', name: { $first: '$supplierName' }, owedCents: { $sum: '$balanceCents' }, invoiceCount: { $sum: 1 } } },
    { $sort: { name: 1 } },
  ]).session(session);
  return new Map(rows.map((r) => [String(r._id), r]));
}

// GET /api/purchases/payment-plan -- every supplier that is owed money, plus
// the latest plan (the open one being prepared, or the last one paid).
export const getPaymentPlan = asyncHandler(async (req, res) => {
  const owed = await owedBySupplier();
  const plan = await VendorPaymentPlan.findOne().sort({ createdAt: -1 });
  const balances = [...owed.values()].map((r) => ({ supplierId: r._id, name: r.name, owed: fromCents(r.owedCents), invoiceCount: r.invoiceCount }));
  res.json({
    success: true,
    data: { balances, totalOwed: fromCents([...owed.values()].reduce((s, r) => s + r.owedCents, 0)), plan: planToDTO(plan), asOf: new Date() },
  });
});

// PUT /api/purchases/payment-plan -- saves the allocations being prepared.
// Updates the open plan, or starts a new one when the last was paid.
// An allocation can never be more than the supplier is owed right now.
export const savePaymentPlan = asyncHandler(async (req, res) => {
  const { rows = [], note = '' } = req.body;
  if (!Array.isArray(rows) || rows.length > 2000) throw new ApiError(400, 'Invalid allocations.');
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const owed = await owedBySupplier();
  const seen = new Set();
  const built = [];
  for (const row of rows) {
    const id = String(row.supplierId || '');
    if (!id || seen.has(id)) throw new ApiError(400, 'Each supplier can appear only once.');
    seen.add(id);
    const amount = Number(row.allocation);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, 'Allocations must be 0 or more.');
    const cents = toCents(amount);
    if (cents === 0) continue;
    const current = owed.get(id);
    if (!current) {
      const s = await Supplier.findById(id).select('name');
      throw new ApiError(400, `${s?.name || 'A supplier'} is not owed anything right now.`);
    }
    if (cents > current.owedCents) throw new ApiError(400, `${current.name}: allocation is more than the ${fromCents(current.owedCents).toFixed(2)} owed.`);
    built.push({ supplier: current._id, supplierName: current.name, owedCents: current.owedCents, allocationCents: cents });
  }

  let plan = await VendorPaymentPlan.findOne({ status: 'OPEN' }).sort({ createdAt: -1 });
  if (!plan) {
    const seq = await nextSequence('vendorPaymentPlan');
    plan = new VendorPaymentPlan({ planNumber: `VPLAN-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`, createdBy: req.user?._id || null });
  }
  plan.rows = built;
  plan.note = String(note).trim();
  await plan.save();
  res.json({ success: true, data: planToDTO(plan) });
});

// POST /api/purchases/payment-plan/pay -- admin/manager: pays every
// allocation of the open plan at once from one account, each supplier
// oldest invoice first (same as a Bulk Payment), all-or-nothing. A
// supplier now owed less than allocated is paid what is owed.
export const payPaymentPlan = asyncHandler(async (req, res) => {
  const { paymentAccountId } = req.body;
  if (!paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  const paymentDate = parsePaymentDate(req.body.paymentDate);

  const plan = await runInTransaction(async (session) => {
    const open = await VendorPaymentPlan.findOne({ status: 'OPEN' }).sort({ createdAt: -1 }).session(session);
    if (!open || !open.rows.some((r) => r.allocationCents > 0)) throw new ApiError(400, 'There are no allocations to pay. Enter and save allocations first.');
    const account = await Account.findById(paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    const owed = await owedBySupplier(session);

    for (const row of open.rows) {
      if (row.allocationCents <= 0) continue;
      const current = owed.get(String(row.supplier));
      const amountCents = Math.min(row.allocationCents, current?.owedCents || 0);
      row.owedCents = current?.owedCents || 0;
      if (amountCents <= 0) continue;
      const bulk = await paySupplier(session, {
        supplierId: row.supplier,
        amountCents,
        paymentAccountId: account._id,
        paymentDate,
        note: `Vendor payment plan ${open.planNumber}`,
        user: req.user,
      });
      row.paidCents = amountCents;
      row.bulkPayment = bulk._id;
      row.bulkNumber = bulk.bulkNumber;
    }
    if (!open.rows.some((r) => r.paidCents > 0)) throw new ApiError(409, 'None of these suppliers is owed anything any more -- nothing was paid.');
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
    action: 'purchase.payment.plan',
    entityType: 'VendorPaymentPlan',
    entityId: plan._id,
    details: { planNumber: plan.planNumber, suppliers: plan.rows.filter((r) => r.paidCents > 0).length, total: fromCents(plan.rows.reduce((s, r) => s + r.paidCents, 0)) },
  });
  res.json({ success: true, data: planToDTO(plan) });
});

// GET /api/purchases/payment-plans -- every saved sheet, newest first, for
// the history list.
export const listPaymentPlans = asyncHandler(async (req, res) => {
  const plans = await VendorPaymentPlan.find().sort({ createdAt: -1 }).limit(200);
  res.json({
    success: true,
    data: plans.map((p) => ({
      id: p._id,
      planNumber: p.planNumber,
      status: p.status,
      supplierCount: p.rows.length,
      totalOwed: fromCents(p.rows.reduce((s, r) => s + r.owedCents, 0)),
      totalAllocated: fromCents(p.rows.reduce((s, r) => s + r.allocationCents, 0)),
      totalPaid: fromCents(p.rows.reduce((s, r) => s + r.paidCents, 0)),
      paymentAccountName: p.paymentAccountName,
      paymentDate: p.paymentDate,
      paidByName: p.paidByName,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
});

// GET /api/purchases/payment-plans/:planId -- one saved sheet.
export const getPaymentPlanById = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.planId)) throw new ApiError(404, 'Sheet not found.');
  const plan = await VendorPaymentPlan.findById(req.params.planId);
  if (!plan) throw new ApiError(404, 'Sheet not found.');
  res.json({ success: true, data: planToDTO(plan) });
});
