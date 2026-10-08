import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import Account from '../models/Account.js';
import PurchasePayment from '../models/PurchasePayment.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { postImmediateTransaction } from '../services/accountService.js';

// Derived, never persisted: Unpaid/Partial/Paid always reflects the
// authoritative paidAmountCents/totalCostCents pair, so it can never drift
// out of sync with them.
export function paymentStatusOf(p) {
  if (p.paidAmountCents <= 0) return 'Unpaid';
  if (p.paidAmountCents >= p.totalCostCents) return 'Paid';
  return 'Partial';
}

function toDTO(p) {
  return {
    id: p._id,
    purchaseNumber: p.purchaseNumber,
    supplierInvoiceNumber: p.supplierInvoiceNumber,
    supplier: p.supplier,
    supplierName: p.supplierName,
    items: p.items.map((i) => ({
      item: i.item,
      name: i.itemName,
      quantity: i.quantity,
      unitCost: fromCents(i.unitCostCents),
      subtotal: fromCents(i.subtotalCents),
    })),
    totalCost: fromCents(p.totalCostCents),
    totalAmount: fromCents(p.totalCostCents),
    paidAmount: fromCents(p.paidAmountCents),
    balance: fromCents(p.balanceCents),
    balanceDue: fromCents(p.balanceCents),
    paymentStatus: paymentStatusOf(p),
    paymentAccount: p.paymentAccount?._id || p.paymentAccount,
    paymentAccountName: p.paymentAccount?.name || '',
    purchaseDate: p.purchaseDate,
    notes: p.notes,
    status: p.status,
    createdAt: p.createdAt,
  };
}

export function paymentToDTO(pay) {
  return {
    id: pay._id,
    paymentNumber: pay.paymentNumber,
    purchase: pay.purchase,
    amount: fromCents(pay.amountCents),
    paymentAccount: pay.paymentAccount?._id || pay.paymentAccount,
    paymentAccountName: pay.paymentAccountName,
    previousBalance: fromCents(pay.previousBalanceCents),
    newBalance: fromCents(pay.newBalanceCents),
    note: pay.note,
    paymentDate: pay.paymentDate || pay.createdAt,
    bulkPayment: pay.bulkPayment || null,
    editedAt: pay.editedAt || null,
    status: pay.status,
    reversedAt: pay.reversedAt,
    reversalReason: pay.reversalReason,
    createdBy: pay.createdBy,
    createdAt: pay.createdAt,
  };
}

async function generatePurchaseNumber(session) {
  const seq = await nextSequence('purchase', session);
  const year = new Date().getFullYear();
  return `PUR-${year}-${String(seq).padStart(6, '0')}`;
}

export async function generatePurchasePaymentNumber(session) {
  const seq = await nextSequence('purchasePayment', session);
  const year = new Date().getFullYear();
  return `PPAY-${year}-${String(seq).padStart(6, '0')}`;
}

// A payment's business date: a YYYY-MM-DD from the form (anchored at local
// noon so it never slips a day), not in the future; defaults to now.
export function parsePaymentDate(value) {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new ApiError(400, 'Enter a valid payment date.');
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Enter a valid payment date.');
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new ApiError(400, 'Payment date cannot be in the future.');
  return date;
}

// POST /api/purchases -- purchase invoices are recorded immediately (there
// is no Draft state for purchases), but payment can now be partial: Amount
// Paid defaults to 0 (Unpaid) and may be anything up to Total Amount. The
// payment account is required only when something is actually being paid
// now. The account is allowed to go negative -- a purchase payment is never
// rejected for insufficient balance, and the full amount always comes from
// the one selected account (never split across accounts or silently pulled
// from another one).
export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, supplierInvoiceNumber = '', amount, amountPaid, purchaseAccountId } = req.body;
  if (typeof supplierInvoiceNumber !== 'string') throw new ApiError(400, 'Supplier invoice number must be text.');
  if (!supplierId) throw new ApiError(400, 'Please select or create a supplier.');
  if (!Number.isFinite(Number(amount)) || toCents(amount) <= 0) throw new ApiError(400, 'Total amount must be greater than zero.');
  const totalCostCents = toCents(amount);
  // amountPaid omitted entirely still means "pay in full now" -- this keeps
  // the existing one-shot-payment call sites (and their tests) working
  // exactly as before; only an explicit amountPaid changes the behavior.
  const paidAmountCents = amountPaid === undefined ? totalCostCents : toCents(amountPaid);
  if (!Number.isFinite(Number(amountPaid ?? 0)) || paidAmountCents < 0) throw new ApiError(400, 'Amount paid cannot be negative.');
  if (paidAmountCents > totalCostCents) throw new ApiError(400, 'Amount paid cannot exceed the total amount.');
  if (req.body.items?.length) throw new ApiError(400, 'Enter physical goods through Stock.');
  const result = await runInTransaction(async (session) => {
    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new ApiError(404, 'Supplier not found.');
    const balanceCents = totalCostCents - paidAmountCents;
    let account = null;
    if (paidAmountCents > 0) {
      if (!purchaseAccountId) throw new ApiError(400, 'Please select the account this purchase is being paid from.');
      account = await Account.findById(purchaseAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
      // Negative balances are allowed for purchase payments: the account is
      // debited for the full amount regardless of its current balance.
    }

    const purchaseNumber = await generatePurchaseNumber(session);

    const [purchase] = await Purchase.create(
      [
        {
          purchaseNumber,
          supplierInvoiceNumber: supplierInvoiceNumber.trim(),
          supplier: supplier._id,
          supplierName: supplier.name,
          items: [],
          totalCostCents,
          paidAmountCents,
          balanceCents,
          paymentAccount: account?._id || null,
          purchaseDate: new Date(),
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    if (account && paidAmountCents > 0) {
      const txn = await postImmediateTransaction(
        {
          account,
          direction: 'OUT',
          type: 'PURCHASE_PAYMENT',
          amountCents: paidAmountCents,
          referenceType: 'Purchase',
          referenceId: purchase._id,
          description: `Purchase invoice ${purchaseNumber} (${supplier.name})`,
          createdBy: req.user,
        },
        session
      );
      purchase.accountTransaction = txn?._id || null;
      await purchase.save({ session });

      const paymentNumber = await generatePurchasePaymentNumber(session);
      await PurchasePayment.create(
        [
          {
            paymentNumber,
            purchase: purchase._id,
            amountCents: paidAmountCents,
            paymentAccount: account._id,
            paymentAccountName: account.name,
            accountTransaction: txn?._id || null,
            previousBalanceCents: totalCostCents,
            newBalanceCents: balanceCents,
            note: 'Initial payment at purchase creation',
            createdBy: req.user?._id,
          },
        ],
        { session }
      );
    }

    supplier.totalSpentCents += totalCostCents;
    await supplier.save({ session });

    return purchase;
  });

  await logAudit({
    user: req.user,
    action: 'purchase.create',
    entityType: 'Purchase',
    entityId: result._id,
    details: { purchaseNumber: result.purchaseNumber, totalCost: fromCents(result.totalCostCents) },
  });

  res.status(201).json({ success: true, data: toDTO(result) });
});

// GET /api/purchases/suppliers-summary -- one line per supplier we have
// bought from: how many invoices, total bought, paid and still owed
// (voided invoices are left out of the money and counted apart).
export const listSupplierSummary = asyncHandler(async (req, res) => {
  const rows = await Purchase.aggregate([
    {
      $group: {
        _id: '$supplier',
        name: { $last: '$supplierName' },
        invoiceCount: { $sum: { $cond: [{ $eq: ['$status', 'voided'] }, 0, 1] } },
        voidedCount: { $sum: { $cond: [{ $eq: ['$status', 'voided'] }, 1, 0] } },
        totalCents: { $sum: { $cond: [{ $eq: ['$status', 'voided'] }, 0, '$totalCostCents'] } },
        paidCents: { $sum: { $cond: [{ $eq: ['$status', 'voided'] }, 0, '$paidAmountCents'] } },
        owedCents: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$balanceCents', 0] } },
        lastPurchaseAt: { $max: '$createdAt' },
      },
    },
    { $sort: { name: 1 } },
  ]);
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r._id,
      name: r.name,
      invoiceCount: r.invoiceCount,
      voidedCount: r.voidedCount,
      total: fromCents(r.totalCents),
      paid: fromCents(r.paidCents),
      owed: fromCents(r.owedCents),
      lastPurchaseAt: r.lastPurchaseAt,
    })),
  });
});

export const listPurchases = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, from, to, range, supplier, status, q, paymentStatus } = req.query;
  const filter = {};
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  // Search by invoice number (ours or the supplier's) or supplier name.
  if (q && String(q).trim()) {
    const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { purchaseNumber: { $regex: escaped, $options: 'i' } },
      { supplierInvoiceNumber: { $regex: escaped, $options: 'i' } },
      { supplierName: { $regex: escaped, $options: 'i' } },
    ];
  }
  if (paymentStatus === 'Unpaid') filter.paidAmountCents = 0;
  else if (paymentStatus === 'Paid') filter.$expr = { $gte: ['$paidAmountCents', '$totalCostCents'] };
  else if (paymentStatus === 'Partial') filter.$and = [{ paidAmountCents: { $gt: 0 } }, { $expr: { $lt: ['$paidAmountCents', '$totalCostCents'] } }];
  if (range || from || to) {
    const { start, end } = resolveDateRange({ range, from, to });
    filter.createdAt = { $gte: start, $lte: end };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Purchase.find(filter)
      .populate('paymentAccount', 'name')
      // sort=supplier keeps each supplier's invoices together.
      .sort(req.query.sort === 'supplier' ? { supplierName: 1, supplier: 1, createdAt: -1 } : { createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Purchase.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

export const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id).populate('paymentAccount', 'name');
  if (!purchase) throw new ApiError(404, 'Purchase not found.');
  res.json({ success: true, data: toDTO(purchase) });
});

// POST /api/purchases/:id/void -- reverses stock increase (does not go below 0)
export const voidPurchase = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    if (purchase.status === 'voided') throw new ApiError(409, 'This purchase has already been voided.');

    const lots = await InventoryLot.find({ purchase: purchase._id }).session(session);
    for (const lot of lots) {
      if (lot.remainingQuantity < lot.originalQuantity || lot.reservedQuantity > 0) {
        throw new ApiError(
          409,
          `Cannot void this purchase: some of its stock has already been sold, so the original batch can no longer be fully reversed.`
        );
      }
    }

    for (const line of purchase.items) {
      const item = await InventoryItem.findById(line.item).session(session);
      if (item) {
        if (item.quantity < line.quantity) {
          throw new ApiError(
            409,
            `Cannot void: "${item.name}" stock (${item.quantity}) is lower than the purchased quantity (${line.quantity}), likely because some of it was already sold.`
          );
        }
        item.quantity -= line.quantity;
        await item.save({ session });
      }
    }

    await InventoryLot.deleteMany({ purchase: purchase._id }).session(session);

    const supplier = await Supplier.findById(purchase.supplier).session(session);
    if (supplier) {
      supplier.totalSpentCents -= purchase.totalCostCents;
      await supplier.save({ session });
    }

    // Refund the money back into the account it was paid from, rather than
    // deleting that account's history.
    if (purchase.paymentAccount && purchase.paidAmountCents > 0) {
      const account = await Account.findById(purchase.paymentAccount).session(session);
      if (account) {
        await postImmediateTransaction(
          {
            account,
            direction: 'IN',
            type: 'REFUND',
            amountCents: purchase.paidAmountCents,
            referenceType: 'Purchase',
            referenceId: purchase._id,
            description: `Refund for voided purchase ${purchase.purchaseNumber}${reason ? ` (${reason})` : ''}`,
            createdBy: req.user,
          },
          session
        );
      }
    }

    // The lump refund above already returns every cent ever paid on this
    // purchase, so no further account movement is needed here -- but mark
    // every payment record as reversed so Payment History never keeps
    // showing POSTED payments against an invoice that no longer exists.
    await PurchasePayment.updateMany(
      { purchase: purchase._id, status: 'POSTED' },
      { $set: { status: 'REVERSED', reversedAt: new Date(), reversalReason: `Purchase voided${reason ? `: ${reason}` : ''}` } },
      { session }
    );

    purchase.status = 'voided';
    purchase.voidedAt = new Date();
    purchase.voidedReason = reason;
    await purchase.save({ session });

    return purchase;
  });

  await logAudit({
    user: req.user,
    action: 'purchase.void',
    entityType: 'Purchase',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

// PUT /api/purchases/:id -- corrects an invoice's supplier, supplier
// invoice number, total, date and notes (admin/manager, enforced at the
// route). Money already paid is never touched: the total cannot go below
// what has been paid, and the balance / payment status follow the new
// total. The supplier's running "total spent" moves with the invoice.
export const updatePurchase = asyncHandler(async (req, res) => {
  const { supplierId, supplierInvoiceNumber = '', notes = '' } = req.body;
  if (typeof supplierInvoiceNumber !== 'string' || supplierInvoiceNumber.length > 100) throw new ApiError(400, 'Supplier invoice number must be text of at most 100 characters.');
  if (String(notes).length > 1000) throw new ApiError(400, 'Notes are too long (1000 characters max).');
  if (!supplierId) throw new ApiError(400, 'Please select a supplier.');
  if (!Number.isFinite(Number(req.body.amount)) || toCents(req.body.amount) <= 0) throw new ApiError(400, 'Total amount must be greater than zero.');
  const totalCostCents = toCents(req.body.amount);
  const purchaseDate = req.body.purchaseDate ? parsePaymentDate(req.body.purchaseDate) : null;

  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    if (purchase.status === 'voided') throw new ApiError(409, 'A voided purchase cannot be edited.');
    if (totalCostCents < purchase.paidAmountCents) {
      throw new ApiError(400, `Total cannot be less than what has already been paid (${fromCents(purchase.paidAmountCents).toFixed(2)}).`);
    }
    const supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new ApiError(404, 'Supplier not found.');

    const before = { supplier: purchase.supplierName, supplierInvoiceNumber: purchase.supplierInvoiceNumber, total: fromCents(purchase.totalCostCents) };
    // Keep each supplier's "total spent" in step with the invoice.
    const oldSupplier = String(purchase.supplier) === String(supplier._id) ? supplier : await Supplier.findById(purchase.supplier).session(session);
    if (oldSupplier) {
      oldSupplier.totalSpentCents -= purchase.totalCostCents;
      if (oldSupplier !== supplier) await oldSupplier.save({ session });
    }
    supplier.totalSpentCents += totalCostCents;
    await supplier.save({ session });

    purchase.supplier = supplier._id;
    purchase.supplierName = supplier.name;
    purchase.supplierInvoiceNumber = supplierInvoiceNumber.trim();
    purchase.totalCostCents = totalCostCents;
    purchase.balanceCents = totalCostCents - purchase.paidAmountCents;
    purchase.notes = String(notes).trim();
    if (purchaseDate) purchase.purchaseDate = purchaseDate;
    await purchase.save({ session });
    return { purchase, before };
  });

  await logAudit({
    user: req.user,
    action: 'purchase.edit',
    entityType: 'Purchase',
    entityId: result.purchase._id,
    details: { purchaseNumber: result.purchase.purchaseNumber, before: result.before, after: { supplier: result.purchase.supplierName, supplierInvoiceNumber: result.purchase.supplierInvoiceNumber, total: fromCents(result.purchase.totalCostCents) } },
  });
  res.json({ success: true, data: toDTO(result.purchase) });
});

// DELETE /api/purchases/:id -- permanently removes an invoice
// (admin/manager). Only allowed when no money and no stock depend on it:
// any active payment must be deleted first (that refunds its account), or
// the invoice voided instead. Deleted payment records left on it are
// removed with it; the audit log keeps what was deleted.
export const deletePurchase = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    const activePayments = await PurchasePayment.countDocuments({ purchase: purchase._id, status: 'POSTED' }).session(session);
    if (activePayments > 0) {
      throw new ApiError(409, `This invoice has ${activePayments} payment(s). Delete them in its Payment History first (the money goes back to the account), or Void the invoice instead.`);
    }
    if (await InventoryLot.exists({ purchase: purchase._id }).session(session)) {
      throw new ApiError(409, 'Stock was received on this invoice, so it cannot be deleted. Void it instead.');
    }
    if (purchase.status !== 'voided') {
      const supplier = await Supplier.findById(purchase.supplier).session(session);
      if (supplier) {
        supplier.totalSpentCents -= purchase.totalCostCents;
        await supplier.save({ session });
      }
    }
    await PurchasePayment.deleteMany({ purchase: purchase._id }, { session });
    await purchase.deleteOne({ session });
    return purchase;
  });

  await logAudit({
    user: req.user,
    action: 'purchase.delete',
    entityType: 'Purchase',
    entityId: result._id,
    details: { purchaseNumber: result.purchaseNumber, supplier: result.supplierName, supplierInvoiceNumber: result.supplierInvoiceNumber, total: fromCents(result.totalCostCents), status: result.status },
  });
  res.json({ success: true, data: { id: result._id } });
});

// POST /api/purchases/:id/payments -- records an additional payment toward
// an Unpaid/Partial purchase's balance. Money leaves the selected Account
// exactly like the initial payment does.
export const addPurchasePayment = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, 'Amount to pay must be greater than zero.');
  if (!req.body.paymentAccountId) throw new ApiError(400, 'Please select a payment account.');
  const amountCents = toCents(amount);

  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    if (purchase.status === 'voided') throw new ApiError(409, 'This purchase has been voided and can no longer receive payments.');
    if (purchase.balanceCents <= 0) throw new ApiError(409, 'This purchase is already fully paid.');
    if (amountCents > purchase.balanceCents) {
      throw new ApiError(400, `Lacagtu waa ka badan tahay inta hadhay. (Amount exceeds the remaining balance of ${fromCents(purchase.balanceCents).toFixed(2)}.)`);
    }

    const account = await Account.findById(req.body.paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

    const previousBalanceCents = purchase.balanceCents;
    purchase.paidAmountCents += amountCents;
    purchase.balanceCents -= amountCents;
    // The invoice's "paid from" account only ever reflects the most recent
    // payment account for display purposes; Payment History (per-payment)
    // is the authoritative record of which account paid what.
    purchase.paymentAccount = account._id;
    await purchase.save({ session });

    const txn = await postImmediateTransaction(
      {
        account,
        direction: 'OUT',
        type: 'PURCHASE_PAYMENT',
        amountCents,
        referenceType: 'Purchase',
        referenceId: purchase._id,
        description: `Payment toward purchase invoice ${purchase.purchaseNumber} (${purchase.supplierName})`,
        createdBy: req.user,
      },
      session
    );

    const paymentNumber = await generatePurchasePaymentNumber(session);
    const [payment] = await PurchasePayment.create(
      [
        {
          paymentNumber,
          purchase: purchase._id,
          amountCents,
          paymentAccount: account._id,
          paymentAccountName: account.name,
          accountTransaction: txn?._id || null,
          previousBalanceCents,
          newBalanceCents: purchase.balanceCents,
          note: req.body.note || '',
          paymentDate: parsePaymentDate(req.body.paymentDate),
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    return { purchase, payment };
  });

  await logAudit({
    user: req.user,
    action: 'purchase.payment.add',
    entityType: 'Purchase',
    entityId: result.purchase._id,
    details: { amount, paymentNumber: result.payment.paymentNumber },
  });

  res.status(201).json({ success: true, data: { purchase: toDTO(result.purchase), payment: paymentToDTO(result.payment) } });
});

export const listPurchasePayments = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id);
  if (!purchase) throw new ApiError(404, 'Purchase not found.');
  const payments = await PurchasePayment.find({ purchase: purchase._id }).sort({ createdAt: -1 });
  res.json({ success: true, data: payments.map(paymentToDTO) });
});

// POST /api/purchases/:id/payments/:paymentId/reverse -- reverses ONE
// payment: refunds the account it came from and recalculates the
// purchase's paid/balance/status. Financial data, so this is admin/manager
// only (enforced at the route) and requires the payment still be POSTED.
export const reversePurchasePayment = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;
  const result = await runInTransaction(async (session) => {
    const purchase = await Purchase.findById(req.params.id).session(session);
    if (!purchase) throw new ApiError(404, 'Purchase not found.');
    const payment = await PurchasePayment.findOne({ _id: req.params.paymentId, purchase: purchase._id }).session(session);
    if (!payment) throw new ApiError(404, 'Payment not found.');
    if (payment.status !== 'POSTED') throw new ApiError(409, 'This payment has already been reversed.');

    const account = await Account.findById(payment.paymentAccount).session(session);
    if (!account) throw new ApiError(409, 'The account this payment was made from no longer exists. Contact an administrator.');

    await postImmediateTransaction(
      {
        account,
        direction: 'IN',
        type: 'REFUND',
        amountCents: payment.amountCents,
        referenceType: 'Purchase',
        referenceId: purchase._id,
        description: `Reversal of payment ${payment.paymentNumber} on purchase ${purchase.purchaseNumber}${reason ? ` (${reason})` : ''}`,
        createdBy: req.user,
      },
      session
    );

    purchase.paidAmountCents -= payment.amountCents;
    purchase.balanceCents += payment.amountCents;
    await purchase.save({ session });

    payment.status = 'REVERSED';
    payment.reversedAt = new Date();
    payment.reversalReason = reason;
    await payment.save({ session });

    return { purchase, payment };
  });

  await logAudit({
    user: req.user,
    action: 'purchase.payment.reverse',
    entityType: 'Purchase',
    entityId: result.purchase._id,
    details: { paymentNumber: result.payment.paymentNumber, reason },
  });

  res.json({ success: true, data: { purchase: toDTO(result.purchase), payment: paymentToDTO(result.payment) } });
});

export { toDTO as purchaseToDTO };
