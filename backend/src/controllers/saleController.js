import { createSaleDraft, normalizeSaleNotes, validateSaleItems, resolveLinePricing, debitWallet, restoreWallet } from '../services/saleService.js';
import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import Account from '../models/Account.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { logAudit } from '../services/auditService.js';
import { applyWalletToDebt } from '../services/walletService.js';
import { restoreLotConsumption } from '../services/lotService.js';
import { reserveStock, releaseReservation } from '../services/stockService.js';
import { calculateWeightedAverageCost } from '../services/costingService.js';
import { createPendingTransaction, reverseTransaction, postImmediateTransaction } from '../services/accountService.js';

function toDTO(sale) {
  return {
    id: sale._id,
    receiptNumber: sale.receiptNumber,
    // `customer`/`paymentAccount` are populated (objects) by getSale/getReceipt
    // but plain ObjectIds everywhere else -- always normalize to a bare id
    // string so callers never have to guess the shape.
    customer: sale.customer?._id || sale.customer,
    customerName: sale.customerName,
    items: sale.items.map((i) => ({
      item: i.item,
      name: i.itemName,
      itemCode: i.itemCode,
      serialNumber: i.serialNumber,
      quantity: i.quantity,
      returnedQuantity: i.returnedQuantity || 0,
      unitPrice: fromCents(i.unitPriceCents),
      costPrice: fromCents(i.costPriceCents),
      discount: fromCents(i.discountCents),
      subtotal: fromCents(i.subtotalCents),
      lineTotal: fromCents(i.subtotalCents - (i.discountCents || 0)),
      allocations: i.lotConsumption,
      batchReservations: i.batchReservations,
    })),
    subtotal: fromCents(sale.subtotalCents),
    discount: fromCents(sale.discountCents),
    total: fromCents(sale.totalCents),
    paidAmount: fromCents(sale.paidAmountCents),
    walletAmount: fromCents(sale.walletAmountCents),
    paymentAccount: sale.paymentAccount?._id || sale.paymentAccount,
    notes: sale.notes || '',
    balanceAdded: fromCents(sale.balanceAddedCents),
    outstanding: fromCents(sale.outstandingCents),
    profit: fromCents(sale.profitCents),
    previousBalance: fromCents(sale.previousBalanceCents),
    newBalance: fromCents(sale.previousBalanceCents + sale.balanceAddedCents),
    status: sale.status,
    confirmedAt: sale.confirmedAt,
    cancelledAt: sale.cancelledAt,
    cancelledReason: sale.cancelledReason,
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
    quotation: sale.quotation || null,
    settledPaidAmount: fromCents(sale.status === 'CONFIRMED' ? sale.totalCents - sale.outstandingCents : sale.paidAmountCents),
    returns: (sale.returns || []).map((r, i) => ({
      index: i,
      items: r.items.map((i2) => ({ item: i2.item, name: i2.itemName, quantity: i2.quantity, unitPrice: fromCents(i2.unitPriceCents) })),
      amount: fromCents(r.amountCents),
      debtReduced: fromCents(r.debtReducedCents),
      refund: fromCents(r.refundCents),
      walletRefund: fromCents(r.walletRefundCents || 0),
      reason: r.reason,
      invoiceBalanceAfter: r.invoiceBalanceAfterCents != null ? fromCents(r.invoiceBalanceAfterCents) : null,
      customerBalanceAfter: r.customerBalanceAfterCents != null ? fromCents(r.customerBalanceAfterCents) : null,
      createdAt: r.createdAt,
    })),
  };
}

// POST /api/sales -- always creates a DRAFT/PENDING invoice. Stock is
// reserved (never physically deducted) and any payment is recorded as a
// PENDING account receipt. Nothing here touches customer balance, revenue,
// COGS, or profit -- those are only posted for real when Close Day confirms
// this invoice.
export const createSale = asyncHandler(async (req, res) => {
  const result = await runInTransaction(session => createSaleDraft(req.body, req.user, session));

  await logAudit({
    user: req.user,
    action: 'sale.create_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { receiptNumber: result.receiptNumber, total: fromCents(result.totalCents) },
  });

  res.status(201).json({ success: true, data: toDTO(result) });
});

// PUT /api/sales/:id -- same-day edit of a DRAFT invoice: items, quantities,
// discount, paid amount and payment account can all change. Reservations
// and the pending account receipt are recomputed from scratch each time.
export const updateSale = asyncHandler(async (req, res) => {
  const { items, discount = 0, paidAmount = 0, walletAmount = 0, paymentAccountId } = req.body;
  const notes = req.body.notes === undefined ? undefined : normalizeSaleNotes(req.body.notes);
  validateSaleItems({ items, discount, paidAmount });
  if (!Number.isFinite(Number(walletAmount)) || !Number.isSafeInteger(toCents(walletAmount)) || Number(walletAmount) < 0) {
    throw new ApiError(400, 'Wallet amount cannot be negative.');
  }

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.quotation) throw new ApiError(409, 'Quotation invoices retain their accepted prices and items. Cancel the draft if it is no longer required.');
    if (sale.status !== 'DRAFT') {
      throw new ApiError(409, 'Only pending (Draft) invoices can be edited. This invoice has already been closed.');
    }

    let account = null;
    if (paymentAccountId) {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    }
    // Validated before anything is mutated: runInTransaction falls back to no
    // session at all on a standalone (non-replica-set) MongoDB, so a
    // mid-function throw would NOT roll back reservations already touched.
    if (toCents(paidAmount) > 0 && !account) {
      throw new ApiError(400, 'Please select a payment account for the amount being paid.');
    }

    // Release every existing reservation for this draft before re-reserving
    // against the new line items, so a removed/reduced line frees stock.
    for (const line of sale.items) {
      await releaseReservation(line.item, line.quantity, session, line.batchReservations);
    }
    if (sale.accountTransaction) {
      await reverseTransaction(sale.accountTransaction, session);
      sale.accountTransaction = null;
    }

    // Restore any previously-applied wallet credit before re-validating and
    // re-applying the (possibly different) new amount below.
    const customer = await Customer.findById(sale.customer).session(session);
    if (customer && sale.walletAmountCents > 0) {
      await restoreWallet(customer, sale.walletAmountCents, sale, session, req.user);
    }

    const saleItems = [];
    let subtotalCents = 0;
    let lineDiscountTotalCents = 0;
    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);
      const qty = Math.round(Number(line.quantity));
      const batchReservations = await reserveStock(item._id, qty, session);

      const { unitPriceCents, costPriceCents, discountCents: lineDiscountCents, subtotalCents: subtotalLineCents } = resolveLinePricing(line, item);
      saleItems.push({
        item: item._id,
        itemName: item.name,
        itemCode: item.itemCode,
        serialNumber: item.serialNumber,
        quantity: qty,
        unitPriceCents,
        costPriceCents,
        discountCents: lineDiscountCents,
        subtotalCents: subtotalLineCents,
        lotConsumption: [],
        batchReservations,
      });
      subtotalCents += subtotalLineCents;
      lineDiscountTotalCents += lineDiscountCents;
    }

    const discountCents = Math.min(toCents(discount) + lineDiscountTotalCents, subtotalCents);
    const totalCents = subtotalCents - discountCents;
    let paidAmountCents = toCents(paidAmount);
    const walletAmountCents = toCents(walletAmount);
    if (paidAmountCents + walletAmountCents > totalCents) {
      throw new ApiError(400, 'Amount paid plus wallet amount cannot exceed the invoice total.');
    }
    if (customer && walletAmountCents > customer.walletBalanceCents) {
      throw new ApiError(400, `Wallet balance (${(customer.walletBalanceCents / 100).toFixed(2)}) is less than the requested wallet payment.`);
    }

    sale.items = saleItems;
    if (notes !== undefined) sale.notes = notes;
    sale.subtotalCents = subtotalCents;
    sale.discountCents = discountCents;
    sale.totalCents = totalCents;
    sale.paidAmountCents = paidAmountCents;
    sale.walletAmountCents = walletAmountCents;
    sale.paymentAccount = account?._id || null;
    sale.balanceAddedCents = totalCents - paidAmountCents - walletAmountCents;

    if (customer && walletAmountCents > 0) {
      await debitWallet(customer, walletAmountCents, sale, session, req.user);
    }

    if (paidAmountCents > 0 && account) {
      const txn = await createPendingTransaction(
        {
          account,
          direction: 'IN',
          type: 'SALE_PAYMENT',
          amountCents: paidAmountCents,
          referenceType: 'Sale',
          referenceId: sale._id,
          description: `Draft sale ${sale.receiptNumber} (edited, pending Close Day)`,
          createdBy: req.user,
        },
        session
      );
      sale.accountTransaction = txn?._id || null;
    }

    await sale.save({ session });
    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.edit_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { receiptNumber: result.receiptNumber },
  });

  res.json({ success: true, data: toDTO(result) });
});

// POST /api/sales/:id/cancel -- cancels an entire DRAFT invoice. The
// document is kept (never deleted) so the audit trail is preserved; only
// its reservation and pending payment are released.
export const cancelSale = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status !== 'DRAFT') {
      throw new ApiError(409, 'Only pending (Draft) invoices can be cancelled directly. Use a return/reversal for a confirmed sale.');
    }

    for (const line of sale.items) {
      await releaseReservation(line.item, line.quantity, session, line.batchReservations);
    }
    if (sale.accountTransaction) {
      await reverseTransaction(sale.accountTransaction, session);
    }
    if (sale.walletAmountCents > 0) {
      const customer = await Customer.findById(sale.customer).session(session);
      if (customer) {
        await restoreWallet(customer, sale.walletAmountCents, sale, session, req.user);
        // The returned credit pays any debt the customer already owes.
        await applyWalletToDebt(customer, session, req.user);
      }
    }

    sale.status = 'CANCELLED';
    sale.cancelledAt = new Date();
    sale.cancelledReason = reason;
    await sale.save({ session });
    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.cancel_draft',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

// GET /api/sales/drafts/today -- convenient Seller access to today's pending invoices
export const listTodayDrafts = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange({ range: 'today' });
  const drafts = await Sale.find({ status: 'DRAFT', createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 });
  res.json({ success: true, data: drafts.map(toDTO) });
});

export const listSales = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, from, to, range, customer, status } = req.query;
  const filter = {};
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  const literal = value => String(value).slice(0, 150).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (req.query.id) filter.receiptNumber = new RegExp(literal(req.query.id), 'i');
  const nameFilters = [req.query.title, req.query.customerName].filter(Boolean);
  if (nameFilters.length) filter.$and = nameFilters.map(value => ({ customerName: new RegExp(literal(value), 'i') }));
  if (range || from || to) {
    const { start, end } = resolveDateRange({ range, from, to });
    filter.createdAt = { $gte: start, $lte: end };
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Sale.find(filter)
      .sort({ [req.query.sortBy === 'updatedAt' ? 'updatedAt' : 'createdAt']: req.query.sortDir === 'asc' ? 1 : -1, _id: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Sale.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

export const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone').populate('paymentAccount', 'name');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({ success: true, data: { ...toDTO(sale), customerPhone: sale.customer?.phone || '', paymentAccountName: sale.paymentAccount?.name || '' } });
});

// GET /api/sales/:id/receipt -- data shaped for the printable A5 invoice
export const getReceipt = asyncHandler(async (req, res) => {
  const sale = await Sale.findById(req.params.id).populate('customer', 'name phone').populate('paymentAccount', 'name');
  if (!sale) throw new ApiError(404, 'Sale not found.');
  res.json({
    success: true,
    data: {
      ...toDTO(sale),
      customerPhone: sale.customer?.phone || '',
      paymentAccountName: sale.paymentAccount?.name || '',
    },
  });
});

// POST /api/sales/:id/reverse -- for a CONFIRMED sale only (admin/manager).
// This is the authorized "return/reversal" path Close-Day-confirmed history
// requires instead of ever silently rewriting it: it reopens stock/lots,
// reverses the customer ledger, and posts an OUT account transaction if a
// payment had already been posted for this sale.
export const reverseSale = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status === 'DRAFT') throw new ApiError(409, 'This is still a Draft invoice -- cancel it instead of reversing it.');
    if (sale.status === 'CANCELLED') throw new ApiError(409, 'This sale has already been cancelled/reversed.');
    if (sale.balanceAddedCents > 0 && sale.outstandingCents !== sale.balanceAddedCents) {
      throw new ApiError(
        409,
        'Cannot reverse this sale: a debt payment has already been applied to it. Reverse or reallocate that payment first.'
      );
    }

    // Only the portion not already restored by a prior partial return (see
    // returnSale) is restored here -- lotConsumption entries are decremented
    // as returns consume them, so this always reflects what remains. This is
    // an incoming inventory movement at the line's own historical WAC
    // snapshot (never today's cost), blended into whatever the item's
    // average cost is right now -- same treatment as a partial return.
    for (const line of sale.items) {
      const stillConsumed = line.quantity - (line.returnedQuantity || 0);
      if (stillConsumed <= 0) continue;
      const itemDoc = await InventoryItem.findById(line.item).session(session);
      const oldQuantity = itemDoc.quantity;
      const oldAverageCostCents = itemDoc.costPriceCents;
      const newAverageCostCents = calculateWeightedAverageCost({
        oldQuantity,
        oldAverageCostCents,
        incomingQuantity: stillConsumed,
        incomingUnitCostCents: line.costPriceCents,
      });
      itemDoc.stockEvents.push({
        type: 'SALE_REVERSAL',
        reference: sale.receiptNumber,
        quantityBefore: oldQuantity,
        quantityAfter: oldQuantity + stillConsumed,
        averageCostBeforeCents: oldAverageCostCents,
        averageCostAfterCents: newAverageCostCents,
      });
      itemDoc.quantity = oldQuantity + stillConsumed;
      itemDoc.costPriceCents = newAverageCostCents;
      await itemDoc.save({ session });
      await restoreLotConsumption(line.lotConsumption, session);
    }

    const customer = await Customer.findById(sale.customer).session(session);
    if (customer) {
      const previousBalanceCents = customer.balanceCents;
      customer.balanceCents -= sale.balanceAddedCents;
      customer.totalPurchasedCents -= sale.totalCents;
      customer.totalPaidCents -= sale.paidAmountCents;
      await customer.save({ session });

      if (sale.balanceAddedCents > 0) {
        await CustomerLedger.create(
          [
            {
              customer: customer._id,
              type: 'SALE_VOID',
              amountCents: -sale.balanceAddedCents,
              sale: sale._id,
              description: `Reversed sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: previousBalanceCents - sale.balanceAddedCents,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );
      }
    }

    // The original payment was already POSTED at Close Day -- refund it out
    // of the same account rather than silently deleting that history.
    if (sale.paymentAccount && sale.paidAmountCents > 0) {
      const account = await Account.findById(sale.paymentAccount).session(session);
      if (account) {
        await postImmediateTransaction(
          {
            account,
            direction: 'OUT',
            type: 'REFUND',
            amountCents: sale.paidAmountCents,
            referenceType: 'Sale',
            referenceId: sale._id,
            description: `Refund for reversed sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
            createdBy: req.user,
          },
          session
        );
      }
    }

    // The sale is being fully undone -- give back whatever wallet credit it
    // consumed, exactly as a Draft cancellation already does.
    if (sale.walletAmountCents > 0 && customer) {
      await restoreWallet(customer, sale.walletAmountCents, sale, session, req.user);
    }

    sale.status = 'CANCELLED';
    sale.cancelledAt = new Date();
    sale.cancelledReason = reason || 'Reversed after confirmation';
    sale.outstandingCents = 0;
    await sale.save({ session });

    // Wallet credit given back above pays any other debt the customer owes
    // (run after this sale is CANCELLED so it is never paid itself).
    if (sale.walletAmountCents > 0 && customer) await applyWalletToDebt(customer, session, req.user);

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.reverse',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

// POST /api/sales/:id/return -- partial return for a CONFIRMED sale
// (admin/manager). Unlike reverseSale (which voids the whole invoice), this
// returns a chosen quantity of specific lines: it restores stock into the
// exact lots those units were consumed from (preserving batch traceability
// and historical cost -- never today's cost), reduces this invoice's
// subtotal/discount/total by the returned value, and reconciles the
// difference by first relieving this invoice's still-unpaid balance, then
// refunding any remainder that was already paid out of the account the sale
// was paid into. Blocked if a debt payment has already been allocated
// against this invoice, same as reverseSale, since that would make the
// refund destination ambiguous.
export const returnSale = asyncHandler(async (req, res) => {
  const { items: returnItems, reason = '' } = req.body;
  if (!Array.isArray(returnItems) || !returnItems.length) throw new ApiError(400, 'Select at least one item to return.');

  const result = await runInTransaction(async (session) => {
    const sale = await Sale.findById(req.params.id).session(session);
    if (!sale) throw new ApiError(404, 'Sale not found.');
    if (sale.status !== 'CONFIRMED') throw new ApiError(409, 'Only confirmed invoices can have items returned. Cancel a Draft instead.');
    if (sale.balanceAddedCents > 0 && sale.outstandingCents !== sale.balanceAddedCents) {
      throw new ApiError(409, 'Cannot return items: a debt payment has already been applied to this invoice. Reverse or reallocate that payment first.');
    }

    const indexByItem = new Map(sale.items.map((line, index) => [String(line.item), index]));
    const seen = new Set();
    let deltaSubtotalCents = 0;
    let deltaCogsCents = 0;
    const returnedLines = [];
    for (const line0 of returnItems) {
      const index = indexByItem.get(String(line0.itemId));
      if (index === undefined || seen.has(index)) throw new ApiError(400, 'Select valid, distinct items from this invoice.');
      seen.add(index);
      const line = sale.items[index];
      const qty = Math.round(Number(line0.quantity));
      if (!Number.isSafeInteger(qty) || qty <= 0) throw new ApiError(400, `Return quantity for "${line.itemName}" must be a positive whole number.`);
      const returnable = line.quantity - (line.returnedQuantity || 0);
      if (qty > returnable) throw new ApiError(409, `Cannot return ${qty} of "${line.itemName}": only ${returnable} remain returnable.`);
      deltaSubtotalCents += qty * line.unitPriceCents;
      deltaCogsCents += qty * line.costPriceCents;
      returnedLines.push({ index, qty, line });
    }

    const newSubtotalCents = sale.subtotalCents - deltaSubtotalCents;
    const newDiscountCents = Math.min(sale.discountCents, newSubtotalCents);
    const newTotalCents = newSubtotalCents - newDiscountCents;
    const deltaCents = sale.totalCents - newTotalCents;
    const reduceFromOutstanding = Math.min(deltaCents, sale.outstandingCents);
    // The already-paid portion goes back the way it was paid: wallet credit
    // first (back into the wallet), then cash out of the payment account.
    const paidBackCents = deltaCents - reduceFromOutstanding;
    const walletRefundCents = Math.min(paidBackCents, sale.walletAmountCents || 0);
    const refundCents = paidBackCents - walletRefundCents;

    // Validated before any lot/stock mutation: an invoice with no payment
    // account on file cannot refund an already-paid cash portion.
    if (refundCents > 0 && !sale.paymentAccount) {
      throw new ApiError(409, 'This invoice has no payment account on file to refund the already-paid portion. Contact an administrator.');
    }
    let account = null;
    if (refundCents > 0) {
      account = await Account.findById(sale.paymentAccount).session(session);
      if (!account) throw new ApiError(409, 'The payment account for this invoice no longer exists. Contact an administrator.');
    }

    // Restore stock into the exact lots each line consumed, most-recently
    // consumed lot first, so batch cost/traceability is never fabricated.
    // Each lotConsumption entry's quantity is decremented as it is restored
    // (rather than left untouched), so a later full reverseSale on this same
    // invoice only restores what these returns have not already restored.
    //
    // Costing: a customer return is an incoming inventory movement at the
    // HISTORICAL cost snapshot assigned when those units were originally
    // sold (line.costPriceCents) -- never today's selling price and never
    // blindly today's WAC. It is blended into the item's current average
    // exactly like a Stock IN receipt (same zero-stock rule applies if the
    // item has since sold out completely).
    for (const { index, qty, line } of returnedLines) {
      let remaining = qty;
      for (let i = line.lotConsumption.length - 1; i >= 0 && remaining > 0; i--) {
        const entry = line.lotConsumption[i];
        if (entry.quantity <= 0) continue;
        const take = Math.min(entry.quantity, remaining);
        await InventoryLot.findByIdAndUpdate(entry.lot, { $inc: { remainingQuantity: take } }, { session });
        entry.quantity -= take;
        remaining -= take;
      }
      const itemDoc = await InventoryItem.findById(line.item).session(session);
      const oldQuantity = itemDoc.quantity;
      const oldAverageCostCents = itemDoc.costPriceCents;
      const newAverageCostCents = calculateWeightedAverageCost({
        oldQuantity,
        oldAverageCostCents,
        incomingQuantity: qty,
        incomingUnitCostCents: line.costPriceCents,
      });
      itemDoc.stockEvents.push({
        type: 'CUSTOMER_RETURN',
        reference: sale.receiptNumber,
        quantityBefore: oldQuantity,
        quantityAfter: oldQuantity + qty,
        averageCostBeforeCents: oldAverageCostCents,
        averageCostAfterCents: newAverageCostCents,
      });
      itemDoc.quantity = oldQuantity + qty;
      itemDoc.costPriceCents = newAverageCostCents;
      await itemDoc.save({ session });
      sale.items[index].returnedQuantity = (line.returnedQuantity || 0) + qty;
    }

    sale.subtotalCents = newSubtotalCents;
    sale.discountCents = newDiscountCents;
    sale.totalCents = newTotalCents;
    sale.costOfGoodsCents -= deltaCogsCents;
    sale.profitCents = sale.totalCents - sale.costOfGoodsCents;
    sale.balanceAddedCents -= reduceFromOutstanding;
    sale.outstandingCents -= reduceFromOutstanding;
    sale.paidAmountCents -= refundCents;
    sale.walletAmountCents -= walletRefundCents;

    // Resolved before the return entry is pushed so the Return Receipt can
    // show the balances exactly as they stood right after this return, even
    // if the invoice/customer changes again later.
    const customer = await Customer.findById(sale.customer).session(session);
    const customerBalanceAfterCents = customer ? customer.balanceCents - reduceFromOutstanding : null;

    sale.returns.push({
      items: returnedLines.map(({ qty, line }) => ({ item: line.item, itemName: line.itemName, quantity: qty, unitPriceCents: line.unitPriceCents })),
      amountCents: deltaCents,
      debtReducedCents: reduceFromOutstanding,
      refundCents,
      walletRefundCents,
      reason,
      invoiceBalanceAfterCents: sale.outstandingCents,
      customerBalanceAfterCents,
      createdBy: req.user?._id,
    });
    await sale.save({ session });

    if (customer) {
      const previousBalanceCents = customer.balanceCents;
      customer.balanceCents -= reduceFromOutstanding;
      customer.totalPurchasedCents -= deltaCents;
      customer.totalPaidCents -= refundCents;
      await customer.save({ session });

      if (reduceFromOutstanding > 0) {
        await CustomerLedger.create(
          [
            {
              customer: customer._id,
              type: 'SALE_RETURN',
              amountCents: -reduceFromOutstanding,
              sale: sale._id,
              description: `Return on sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: previousBalanceCents - reduceFromOutstanding,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );
      }

      if (walletRefundCents > 0) {
        await restoreWallet(customer, walletRefundCents, sale, session, req.user);
        // Credit given back to the wallet pays any other debt the customer owes.
        await applyWalletToDebt(customer, session, req.user);
      }
    }

    if (account && refundCents > 0) {
      await postImmediateTransaction(
        {
          account,
          direction: 'OUT',
          type: 'REFUND',
          amountCents: refundCents,
          referenceType: 'Sale',
          referenceId: sale._id,
          description: `Refund for return on sale ${sale.receiptNumber}${reason ? ` (${reason})` : ''}`,
          createdBy: req.user,
        },
        session
      );
    }

    return sale;
  });

  await logAudit({
    user: req.user,
    action: 'sale.return_items',
    entityType: 'Sale',
    entityId: result._id,
    details: { reason },
  });

  res.json({ success: true, data: toDTO(result) });
});

export { toDTO as saleToDTO };
