import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { toCents } from '../utils/money.js';
import { reserveStock } from './stockService.js';
import { createPendingTransaction } from './accountService.js';
import { getBusinessDayStatus } from './dayCloseService.js';
import { debitWallet } from './walletService.js';

// Wallet debit/restore live in walletService (Close Day needs them too);
// re-exported here for existing callers.
export { debitWallet, restoreWallet } from './walletService.js';

async function generateReceiptNumber(session) {
  const seq = await nextSequence('sale', session);
  const year = new Date().getFullYear();
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

export function validateSaleItems({ items, discount, paidAmount }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'Add at least one product to the sale.');
  }
  for (const line of items) {
    if (!line.itemId) throw new ApiError(400, 'Each sale line must reference a product.');
    if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0) {
      throw new ApiError(400, 'Quantity must be greater than zero for every product.');
    }
    if (line.unitPrice != null && (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)) {
      throw new ApiError(400, 'Rate cannot be negative.');
    }
    if (line.costPrice != null && (!Number.isFinite(Number(line.costPrice)) || Number(line.costPrice) < 0)) {
      throw new ApiError(400, 'Cost price cannot be negative.');
    }
    if (line.discount != null && (!Number.isFinite(Number(line.discount)) || Number(line.discount) < 0)) {
      throw new ApiError(400, 'Line discount cannot be negative.');
    }
  }
  if (!Number.isFinite(Number(discount)) || !Number.isSafeInteger(toCents(discount)) || Number(discount) < 0) throw new ApiError(400, 'Discount cannot be negative.');
  if (!Number.isFinite(Number(paidAmount)) || !Number.isSafeInteger(toCents(paidAmount)) || Number(paidAmount) < 0) throw new ApiError(400, 'Paid amount cannot be negative.');
}

// Resolves one sale line's cashier-editable pricing (rate, cost estimate,
// line discount) against its product, validating none of them are invalid.
// `quotedUnitPriceCents`, when provided (quotation conversion), always wins
// over any rate the request body supplies -- an accepted quotation's price
// is never re-editable through this path.
export function resolveLinePricing(line, item, quotedUnitPriceCents) {
  const qty = Math.round(Number(line.quantity));
  const unitPriceCents = quotedUnitPriceCents != null ? quotedUnitPriceCents : line.unitPrice != null ? toCents(line.unitPrice) : item.sellingPriceCents;
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new ApiError(400, `Invalid rate for "${item.name}".`);
  const costPriceCents = line.costPrice != null ? toCents(line.costPrice) : item.costPriceCents;
  if (!Number.isSafeInteger(costPriceCents) || costPriceCents < 0) throw new ApiError(400, `Invalid cost price for "${item.name}".`);
  const grossCents = unitPriceCents * qty;
  const discountCents = line.discount != null ? toCents(line.discount) : 0;
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) throw new ApiError(400, `Invalid discount for "${item.name}".`);
  if (discountCents > grossCents) throw new ApiError(400, `Discount for "${item.name}" cannot exceed its line total.`);
  return { unitPriceCents, costPriceCents, discountCents, subtotalCents: grossCents };
}


export function normalizeSaleNotes(value) {
  const notes = String(value ?? '').trim();
  if (notes.length > 500) throw new ApiError(400, 'Notes are too long (500 characters max).');
  return notes;
}

// Once Close Day runs, Seller/POS is locked for everyone -- admins too --
// until the day is opened again: no new sale, no quotation conversion, no
// editing a pending invoice. Enforced here, not just in the UI, so a direct
// API call cannot get around it.
export async function assertBusinessDayOpen() {
  const businessDay = await getBusinessDayStatus();
  if (businessDay.status === 'CLOSED') {
    throw new ApiError(403, 'Maalintu waa xiran tahay. Waxba lama iibin karo ilaa maalinta la furo. (The day is closed: nothing can be sold until it is opened.)');
  }
}

// Authoritative draft creation, shared by POS and quotation conversion.
export async function createSaleDraft(payload, user, session, { quotedPrices, quotationId } = {}) {
  await assertBusinessDayOpen();

  const { customerId, items, discount = 0, paidAmount = 0, walletAmount = 0, paymentAccountId } = payload;
  const notes = normalizeSaleNotes(payload.notes);
  if (!customerId) throw new ApiError(400, 'Please select or create a customer before completing the sale.');
  validateSaleItems({ items, discount, paidAmount });
  if (!Number.isFinite(Number(walletAmount)) || !Number.isSafeInteger(toCents(walletAmount)) || Number(walletAmount) < 0) {
    throw new ApiError(400, 'Wallet amount cannot be negative.');
  }


    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found. Please select a valid customer.');

    let account = null;
    if (paymentAccountId) {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');
    }
    // Validate the receiving account before reserving stock.
    if (toCents(paidAmount) > 0 && !account) {
      throw new ApiError(400, 'Please select a payment account for the amount being paid.');
    }

    const saleItems = [];
    let subtotalCents = 0;
    let lineDiscountTotalCents = 0;

    for (const line of items) {
      const item = await InventoryItem.findById(line.itemId).session(session);
      if (!item) throw new ApiError(404, `Product not found (id: ${line.itemId}).`);
      if (item.status !== 'active') throw new ApiError(409, `Product ${item.name} is not active.`);

      const qty = Math.round(Number(line.quantity));
      const batchReservations = await reserveStock(item._id, qty, session);

      const quotedUnitPriceCents = quotedPrices ? quotedPrices.get(String(item._id)) : null;
      const { unitPriceCents, costPriceCents, discountCents: lineDiscountCents, subtotalCents: subtotalLineCents } = resolveLinePricing(line, item, quotedUnitPriceCents);

      saleItems.push({
        item: item._id,
        itemName: item.name,
        itemCode: item.itemCode,
        serialNumber: item.serialNumber,
        quantity: qty,
        unitPriceCents,
        costPriceCents, // estimate; finalized at Close Day
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
    let walletAmountCents = toCents(walletAmount);
    if (paidAmountCents + walletAmountCents > totalCents) {
      throw new ApiError(400, 'Amount paid plus wallet amount cannot exceed the invoice total.');
    }
    if (walletAmountCents > customer.walletBalanceCents) {
      throw new ApiError(400, `Wallet balance (${(customer.walletBalanceCents / 100).toFixed(2)}) is less than the requested wallet payment.`);
    }

    const receiptNumber = await generateReceiptNumber(session);

    const [sale] = await Sale.create(
      [
        {
          receiptNumber,
          quotation: quotationId || undefined,
          customer: customer._id,
          customerName: customer.name,
          items: saleItems,
          notes,
          subtotalCents,
          discountCents,
          totalCents,
          paidAmountCents,
          walletAmountCents,
          paymentAccount: account?._id || null,
          balanceAddedCents: totalCents - paidAmountCents - walletAmountCents,
          outstandingCents: 0, // not posted until CONFIRMED
          costOfGoodsCents: 0,
          profitCents: 0,
          previousBalanceCents: customer.balanceCents, // snapshot for display only
          status: 'DRAFT',
          createdBy: user?._id,
        },
      ],
      { session }
    );

    if (walletAmountCents > 0) {
      await debitWallet(customer, walletAmountCents, sale, session, user);
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
          description: `Draft sale ${receiptNumber} (pending Close Day)`,
          createdBy: user,
        },
        session
      );
      sale.accountTransaction = txn?._id || null;
      await sale.save({ session });
    }

    return sale;
}
