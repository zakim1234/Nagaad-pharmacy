import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import Account from '../models/Account.js';
import PurchasePayment from '../models/PurchasePayment.js';
import BulkPurchasePayment from '../models/BulkPurchasePayment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { logAudit } from '../services/auditService.js';
import { postImmediateTransaction } from '../services/accountService.js';
import { purchaseToDTO, paymentToDTO, paymentStatusOf, parsePaymentDate } from './purchaseController.js';
import { paySupplier, cancelBulkPayment, OUTSTANDING, OLDEST_FIRST } from '../services/supplierPaymentService.js';


function bulkToDTO(b, paymentsById = new Map()) {
  return {
    id: b._id,
    bulkNumber: b.bulkNumber,
    supplier: b.supplier,
    supplierName: b.supplierName,
    amount: fromCents(b.amountCents),
    selectedOwed: fromCents(b.selectedOwedCents),
    percentage: b.percentage,
    paymentAccount: b.paymentAccount,
    paymentAccountName: b.paymentAccountName,
    paymentDate: b.paymentDate,
    note: b.note,
    receiptNo: b.receiptNo || '',
    allocations: b.allocations.map((a) => {
      const pay = paymentsById.get(String(a.payment));
      return {
        purchase: a.purchase,
        purchaseNumber: a.purchaseNumber,
        payment: a.payment,
        amount: fromCents(a.amountCents),
        previousBalance: fromCents(a.previousBalanceCents),
        newBalance: fromCents(a.newBalanceCents),
        status: a.newBalanceCents <= 0 ? 'Paid' : 'Partial',
        // Edited or deleted later from the invoice's Payment History.
        currentAmount: pay ? fromCents(pay.amountCents) : null,
        paymentStatus: pay?.status || null,
      };
    }),
    createdByName: b.createdByName,
    createdAt: b.createdAt,
    status: b.status || 'POSTED',
    cancelledAt: b.cancelledAt || null,
    cancelReason: b.cancelReason || '',
    cancelledByName: b.cancelledByName || '',
  };
}

// GET /api/purchases/bulk-payments/suppliers -- suppliers that are owed
// money, with how much and on how many invoices.
export const listOwedSuppliers = asyncHandler(async (req, res) => {
  const rows = await Purchase.aggregate([
    { $match: OUTSTANDING },
    { $group: { _id: '$supplier', name: { $first: '$supplierName' }, owedCents: { $sum: '$balanceCents' }, invoiceCount: { $sum: 1 } } },
    { $sort: { name: 1 } },
  ]);
  res.json({ success: true, data: rows.map((r) => ({ id: r._id, name: r.name, owed: fromCents(r.owedCents), invoiceCount: r.invoiceCount })) });
});

// GET /api/purchases/bulk-payments/outstanding?supplierId= -- that
// supplier's unpaid/partly paid invoices, oldest first, plus any voided
// ones (shown, but never selectable).
export const listSupplierOutstanding = asyncHandler(async (req, res) => {
  const { supplierId } = req.query;
  if (!supplierId || !mongoose.isValidObjectId(supplierId)) throw new ApiError(400, 'Select a supplier.');
  const [open, voided] = await Promise.all([
    Purchase.find({ supplier: supplierId, ...OUTSTANDING }).sort(OLDEST_FIRST),
    Purchase.find({ supplier: supplierId, status: 'voided' }).sort(OLDEST_FIRST).select('purchaseNumber totalCostCents'),
  ]);
  res.json({
    success: true,
    data: {
      invoices: open.map(purchaseToDTO),
      voided: voided.map((p) => ({ id: p._id, purchaseNumber: p.purchaseNumber, totalAmount: fromCents(p.totalCostCents) })),
    },
  });
});

// POST /api/purchases/bulk-payments -- pays one supplier across several of
// their invoices at once. The amount (often a % of what the selected
// invoices owe) is applied oldest invoice first; it leaves the account as
// ONE transaction and produces ONE receipt.
export const createBulkPayment = asyncHandler(async (req, res) => {
  const { supplierId, purchaseIds, paymentAccountId, note = '', receiptNo = '' } = req.body;
  const amount = Number(req.body.amount);
  if (!supplierId) throw new ApiError(400, 'Select a supplier.');
  if (!Array.isArray(purchaseIds) || purchaseIds.length === 0) throw new ApiError(400, 'Select at least one invoice to pay.');
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, 'Amount to pay must be greater than zero.');
  if (!paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  if (String(receiptNo).length > 60) throw new ApiError(400, 'Receipt number is too long (60 characters max).');
  const percentage = req.body.percentage == null || req.body.percentage === '' ? null : Number(req.body.percentage);
  if (percentage !== null && (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100)) throw new ApiError(400, 'Percentage must be between 0 and 100.');
  const paymentDate = parsePaymentDate(req.body.paymentDate);
  const amountCents = toCents(amount);

  const result = await runInTransaction(async (session) => {
    return paySupplier(session, { supplierId, purchaseIds, amountCents, paymentAccountId, paymentDate, note, percentage, receiptNo, user: req.user });
  });

  await logAudit({
    user: req.user,
    action: 'purchase.payment.bulk',
    entityType: 'Supplier',
    entityId: result.supplier,
    details: { bulkNumber: result.bulkNumber, amount, invoices: result.allocations.map((a) => a.purchaseNumber) },
  });

  res.status(201).json({ success: true, data: bulkToDTO(result) });
});

// GET /api/purchases/bulk-payments/:bulkId -- the bulk payment receipt.
export const getBulkPayment = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.bulkId)) throw new ApiError(404, 'Bulk payment not found.');
  const bulk = await BulkPurchasePayment.findById(req.params.bulkId);
  if (!bulk) throw new ApiError(404, 'Bulk payment not found.');
  const payments = await PurchasePayment.find({ _id: { $in: bulk.allocations.map((a) => a.payment) } });
  res.json({ success: true, data: bulkToDTO(bulk, new Map(payments.map((p) => [String(p._id), p]))) });
});

// PUT /api/purchases/:id/payments/:paymentId -- corrects a payment's amount,
// account, date or note. Money already moved is never rewritten: when the
// amount or account changes, the old amount is refunded to the old account
// and the new amount is taken from the new one, each as its own
// transaction, so every account keeps an exact history. The invoice's paid
// amount, balance and status follow the new amount.
export const updatePurchasePayment = asyncHandler(async (req, res) => {
  const { paymentAccountId } = req.body;
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, 'Amount must be greater than zero.');
  if (!paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  if (req.body.note != null && String(req.body.note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  const newAmountCents = toCents(amount);
  const paymentDate = parsePaymentDate(req.body.paymentDate);

  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    if (purchase.status === 'voided') throw new ApiError(409, 'This purchase has been voided; its payments can no longer be changed.');
    const payment = await PurchasePayment.findOne({ _id: req.params.paymentId, purchase: purchase._id }).session(session);
    if (!payment) throw new ApiError(404, 'Payment not found.');
    if (payment.status !== 'POSTED') throw new ApiError(409, 'This payment has been deleted and cannot be edited.');

    const maxCents = purchase.balanceCents + payment.amountCents;
    if (newAmountCents > maxCents) {
      throw new ApiError(400, `Lacagtu waa ka badan tahay inta hadhay. (Amount cannot exceed ${fromCents(maxCents).toFixed(2)} for this invoice.)`);
    }

    const accountChanged = String(payment.paymentAccount) !== String(paymentAccountId);
    const amountChanged = newAmountCents !== payment.amountCents;
    const newAccount = accountChanged ? await Account.findById(paymentAccountId).session(session) : await Account.findById(payment.paymentAccount).session(session);
    if (!newAccount || (accountChanged && !newAccount.isActive)) throw new ApiError(400, 'Selected payment account is not available.');

    if (accountChanged || amountChanged) {
      const oldAccount = accountChanged ? await Account.findById(payment.paymentAccount).session(session) : newAccount;
      if (!oldAccount) throw new ApiError(409, 'The account this payment was made from no longer exists. Contact an administrator.');
      const label = `payment ${payment.paymentNumber} on purchase ${purchase.purchaseNumber}`;
      await postImmediateTransaction(
        { account: oldAccount, direction: 'IN', type: 'REFUND', amountCents: payment.amountCents, referenceType: 'Purchase', referenceId: purchase._id, description: `Correction: undo ${label}`, createdBy: req.user },
        session
      );
      const txn = await postImmediateTransaction(
        { account: newAccount, direction: 'OUT', type: 'PURCHASE_PAYMENT', amountCents: newAmountCents, referenceType: 'Purchase', referenceId: purchase._id, description: `Correction: corrected ${label}`, createdBy: req.user },
        session
      );
      purchase.paidAmountCents += newAmountCents - payment.amountCents;
      purchase.balanceCents -= newAmountCents - payment.amountCents;
      await purchase.save({ session });
      payment.accountTransaction = txn?._id || payment.accountTransaction;
    }

    const before = { amount: fromCents(payment.amountCents), account: payment.paymentAccountName, date: payment.paymentDate || payment.createdAt, note: payment.note };
    payment.amountCents = newAmountCents;
    payment.paymentAccount = newAccount._id;
    payment.paymentAccountName = newAccount.name;
    payment.newBalanceCents = payment.previousBalanceCents - newAmountCents;
    payment.paymentDate = paymentDate;
    if (req.body.note != null) payment.note = String(req.body.note).trim();
    if (req.body.receiptNo != null) payment.receiptNo = String(req.body.receiptNo).trim().slice(0, 60);
    payment.editedAt = new Date();
    await payment.save({ session });
    return { purchase, payment, before };
  });

  await logAudit({
    user: req.user,
    action: 'purchase.payment.edit',
    entityType: 'Purchase',
    entityId: result.purchase._id,
    details: { paymentNumber: result.payment.paymentNumber, before: result.before, after: { amount, account: result.payment.paymentAccountName } },
  });

  res.json({ success: true, data: { purchase: purchaseToDTO(result.purchase), payment: paymentToDTO(result.payment), paymentStatus: paymentStatusOf(result.purchase) } });
});

// POST /api/purchases/bulk-payments/:bulkId/cancel -- admin/manager:
// cancels a whole payment receipt; its money goes back to the account and
// the supplier is owed that much again.
export const cancelBulk = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.bulkId)) throw new ApiError(404, 'Payment not found.');
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  const { bulk, refundedCents } = await runInTransaction((session) => cancelBulkPayment(session, req.params.bulkId, { reason, user: req.user }));
  await logAudit({
    user: req.user,
    action: 'purchase.payment.bulk.cancel',
    entityType: 'Supplier',
    entityId: bulk.supplier,
    details: { bulkNumber: bulk.bulkNumber, refunded: fromCents(refundedCents), reason },
  });
  res.json({ success: true, data: { ...bulkToDTO(bulk), refunded: fromCents(refundedCents) } });
});
