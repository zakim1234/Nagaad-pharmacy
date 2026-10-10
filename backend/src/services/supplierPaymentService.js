import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import Account from '../models/Account.js';
import PurchasePayment from '../models/PurchasePayment.js';
import BulkPurchasePayment from '../models/BulkPurchasePayment.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { fromCents } from '../utils/money.js';
import { postImmediateTransaction } from './accountService.js';
import { generatePurchasePaymentNumber } from '../controllers/purchaseController.js';

// Completed invoices that still owe something, oldest first -- the order a
// supplier payment pays them in.
export const OUTSTANDING = { status: 'completed', balanceCents: { $gt: 0 } };
export const OLDEST_FIRST = { purchaseDate: 1, createdAt: 1, _id: 1 };

async function generateBulkNumber(session) {
  const seq = await nextSequence('bulkPurchasePayment', session);
  return `BPAY-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
}

// Pays one supplier `amountCents` from one account, spread over their
// invoices oldest first: the selected `purchaseIds`, or every outstanding
// invoice of theirs when omitted. One account transaction, one
// PurchasePayment per invoice reached, one BulkPurchasePayment receipt.
// Runs inside the caller's transaction; returns the receipt document.
export async function paySupplier(session, { supplierId, purchaseIds = null, amountCents, paymentAccountId, paymentDate, note = '', percentage = null, receiptNo = '', user }) {
  const supplier = await Supplier.findById(supplierId).session(session);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');
  const account = await Account.findById(paymentAccountId).session(session);
  if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

  let purchases;
  if (purchaseIds) {
    const uniqueIds = [...new Set(purchaseIds.map(String))];
    purchases = await Purchase.find({ _id: { $in: uniqueIds } }).sort(OLDEST_FIRST).session(session);
    if (purchases.length !== uniqueIds.length) throw new ApiError(404, 'One of the selected invoices was not found.');
  } else {
    purchases = await Purchase.find({ supplier: supplier._id, ...OUTSTANDING }).sort(OLDEST_FIRST).session(session);
    if (purchases.length === 0) throw new ApiError(409, `${supplier.name} has no unpaid invoices.`);
  }
  for (const p of purchases) {
    if (String(p.supplier) !== String(supplier._id)) throw new ApiError(400, `${p.purchaseNumber} belongs to a different supplier.`);
    if (p.status === 'voided') throw new ApiError(409, `${p.purchaseNumber} is voided and cannot be paid.`);
    if (p.balanceCents <= 0) throw new ApiError(409, `${p.purchaseNumber} is already fully paid.`);
  }
  const selectedOwedCents = purchases.reduce((s, p) => s + p.balanceCents, 0);
  if (amountCents > selectedOwedCents) {
    throw new ApiError(400, `Amount exceeds what the selected invoices owe (${fromCents(selectedOwedCents).toFixed(2)}).`);
  }

  const bulkNumber = await generateBulkNumber(session);
  const txn = await postImmediateTransaction(
    {
      account,
      direction: 'OUT',
      type: 'PURCHASE_PAYMENT',
      amountCents,
      referenceType: 'Purchase',
      referenceId: purchases[0]._id,
      description: `Bulk payment ${bulkNumber} to ${supplier.name}`,
      createdBy: user,
    },
    session
  );

  const [bulk] = await BulkPurchasePayment.create(
    [
      {
        bulkNumber,
        supplier: supplier._id,
        supplierName: supplier.name,
        amountCents,
        selectedOwedCents,
        percentage,
        paymentAccount: account._id,
        paymentAccountName: account.name,
        accountTransaction: txn?._id || null,
        paymentDate,
        note: String(note).trim(),
        receiptNo: String(receiptNo || '').trim(),
        allocations: [],
        createdBy: user?._id || null,
        createdByName: user?.name || '',
      },
    ],
    { session }
  );

  let remaining = amountCents;
  for (const purchase of purchases) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, purchase.balanceCents);
    const previousBalanceCents = purchase.balanceCents;
    purchase.paidAmountCents += take;
    purchase.balanceCents -= take;
    purchase.paymentAccount = account._id;
    await purchase.save({ session });

    const [payment] = await PurchasePayment.create(
      [
        {
          paymentNumber: await generatePurchasePaymentNumber(session),
          purchase: purchase._id,
          amountCents: take,
          paymentAccount: account._id,
          paymentAccountName: account.name,
          accountTransaction: txn?._id || null,
          previousBalanceCents,
          newBalanceCents: purchase.balanceCents,
          note: `Part of bulk payment ${bulkNumber}${bulk.note ? ` — ${bulk.note}` : ''}`,
          paymentDate,
          receiptNo: bulk.receiptNo,
          bulkPayment: bulk._id,
          createdBy: user?._id,
        },
      ],
      { session }
    );
    bulk.allocations.push({
      purchase: purchase._id,
      purchaseNumber: purchase.purchaseNumber,
      payment: payment._id,
      amountCents: take,
      previousBalanceCents,
      newBalanceCents: purchase.balanceCents,
    });
    remaining -= take;
  }
  await bulk.save({ session });
  return bulk;
}

// Cancels one supplier payment: the money goes back to the account it came
// from (as its own REFUND transaction, so the account history stays
// exact) and the supplier is owed that much again. Already-cancelled
// payments are left alone. Runs inside the caller's transaction.
export async function reversePayment(session, payment, { reason = '', user, purchase = null }) {
  if (payment.status !== 'POSTED') return null;
  const invoice = purchase || (await Purchase.findById(payment.purchase).session(session));
  const account = await Account.findById(payment.paymentAccount).session(session);
  if (!account) throw new ApiError(409, `The account payment ${payment.paymentNumber} was made from no longer exists. Contact an administrator.`);
  await postImmediateTransaction(
    {
      account,
      direction: 'IN',
      type: 'REFUND',
      amountCents: payment.amountCents,
      referenceType: 'Purchase',
      referenceId: payment.purchase,
      description: `Reversal of payment ${payment.paymentNumber}${invoice ? ` on purchase ${invoice.purchaseNumber}` : ''}${reason ? ` (${reason})` : ''}`,
      createdBy: user,
    },
    session
  );
  if (invoice) {
    invoice.paidAmountCents -= payment.amountCents;
    invoice.balanceCents += payment.amountCents;
    await invoice.save({ session });
  }
  payment.status = 'REVERSED';
  payment.reversedAt = new Date();
  payment.reversalReason = reason;
  await payment.save({ session });
  return payment;
}

// Cancels a whole supplier payment receipt (BPAY): every part of it still
// standing is reversed and its money returned to the account.
export async function cancelBulkPayment(session, bulkId, { reason = '', user }) {
  const bulk = await BulkPurchasePayment.findById(bulkId).session(session);
  if (!bulk) throw new ApiError(404, 'Payment not found.');
  if (bulk.status === 'CANCELLED') throw new ApiError(409, `${bulk.bulkNumber} is already cancelled.`);
  const payments = await PurchasePayment.find({ bulkPayment: bulk._id, status: 'POSTED' }).session(session);
  let refundedCents = 0;
  for (const p of payments) {
    await reversePayment(session, p, { reason: reason || `${bulk.bulkNumber} cancelled`, user });
    refundedCents += p.amountCents;
  }
  bulk.status = 'CANCELLED';
  bulk.cancelledAt = new Date();
  bulk.cancelReason = String(reason || '').trim();
  bulk.cancelledByName = user?.name || '';
  await bulk.save({ session });
  return { bulk, refundedCents };
}
