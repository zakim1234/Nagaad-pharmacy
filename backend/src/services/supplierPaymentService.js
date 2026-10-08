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
export async function paySupplier(session, { supplierId, purchaseIds = null, amountCents, paymentAccountId, paymentDate, note = '', percentage = null, user }) {
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
