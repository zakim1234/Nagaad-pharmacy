import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import CustomerWalletTransaction from '../models/CustomerWalletTransaction.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';

// Debits the customer's wallet immediately (Draft creation/edit), recording
// a SALE_PAYMENT wallet transaction. Never touches any Account -- that cash
// already arrived at deposit time. Throws if it would go negative.
export async function debitWallet(customer, amountCents, sale, session, createdBy) {
  if (amountCents <= 0) return;
  if (amountCents > customer.walletBalanceCents) {
    throw new ApiError(400, `Wallet balance (${(customer.walletBalanceCents / 100).toFixed(2)}) is less than the requested wallet payment.`);
  }
  const balanceBeforeCents = customer.walletBalanceCents;
  customer.walletBalanceCents -= amountCents;
  await customer.save({ session });
  await CustomerWalletTransaction.create(
    [
      {
        customer: customer._id,
        type: 'SALE_PAYMENT',
        amountCents: -amountCents,
        sale: sale._id,
        note: `Applied to sale ${sale.receiptNumber}`,
        balanceBeforeCents,
        balanceAfterCents: customer.walletBalanceCents,
        createdBy: createdBy?._id || createdBy || null,
      },
    ],
    { session }
  );
}

// Restores a previously-debited wallet amount -- used when a Draft sale
// that used wallet credit is edited (before re-debiting the new amount) or
// cancelled outright.
export async function restoreWallet(customer, amountCents, sale, session, createdBy) {
  if (amountCents <= 0) return;
  const balanceBeforeCents = customer.walletBalanceCents;
  customer.walletBalanceCents += amountCents;
  await customer.save({ session });
  await CustomerWalletTransaction.create(
    [
      {
        customer: customer._id,
        type: 'REFUND',
        amountCents,
        sale: sale._id,
        note: `Restored from sale ${sale.receiptNumber}`,
        balanceBeforeCents,
        balanceAfterCents: customer.walletBalanceCents,
        createdBy: createdBy?._id || createdBy || null,
      },
    ],
    { session }
  );
}

async function generatePaymentReceiptNumber(session) {
  const seq = await nextSequence('payment', session);
  const year = new Date().getFullYear();
  return `PAY-${year}-${String(seq).padStart(6, '0')}`;
}

// Pays a customer's confirmed, still-unpaid invoices (oldest first) out of
// their wallet credit, so a customer never carries debt while money sits
// in their wallet. Recorded exactly like a wallet deposit's automatic debt
// clearing (customerController.depositToWallet): one debt_payment Payment
// with per-invoice allocations + a CustomerLedger PAYMENT entry, plus the
// matching wallet debit. No Account transaction -- the cash already
// entered an Account when it was deposited into the wallet.
//
// Mutates and saves `customer`. Call it after any step that creates debt
// (Close Day confirming a credit sale) or credits the wallet (restoring a
// cancelled/reversed sale's wallet amount). Returns the cents applied.
export async function applyWalletToDebt(customer, session, createdBy) {
  if (customer.walletBalanceCents <= 0 || customer.balanceCents <= 0) return 0;

  const outstandingInvoices = await Sale.find({ customer: customer._id, status: 'CONFIRMED', outstandingCents: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .session(session);
  const totalOutstandingCents = outstandingInvoices.reduce((sum, s) => sum + s.outstandingCents, 0);
  let toAllocate = Math.min(customer.walletBalanceCents, customer.balanceCents, totalOutstandingCents);
  if (toAllocate <= 0) return 0;

  const allocations = [];
  for (const sale of outstandingInvoices) {
    if (toAllocate <= 0) break;
    const take = Math.min(sale.outstandingCents, toAllocate);
    sale.outstandingCents -= take;
    await sale.save({ session });
    allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: take });
    toAllocate -= take;
  }
  const appliedCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  const invoiceList = allocations.map((a) => a.receiptNumber).join(', ');
  const createdById = createdBy?._id || createdBy || null;

  const previousBalanceCents = customer.balanceCents;
  const previousWalletBalanceCents = customer.walletBalanceCents;
  customer.balanceCents -= appliedCents;
  customer.totalPaidCents += appliedCents;
  customer.walletBalanceCents -= appliedCents;
  await customer.save({ session });

  const receiptNumber = await generatePaymentReceiptNumber(session);
  const [payment] = await Payment.create(
    [
      {
        receiptNumber,
        customer: customer._id,
        amountCents: appliedCents,
        type: 'debt_payment',
        paymentAccountName: 'Customer Wallet',
        allocations,
        previousBalanceCents,
        newBalanceCents: customer.balanceCents,
        notes: 'Paid automatically from wallet balance',
        createdBy: createdById,
      },
    ],
    { session }
  );

  await CustomerLedger.create(
    [
      {
        customer: customer._id,
        type: 'PAYMENT',
        amountCents: -appliedCents,
        payment: payment._id,
        description: `Debt payment ${receiptNumber} (${invoiceList}) -- paid automatically from wallet`,
        balanceBeforeCents: previousBalanceCents,
        balanceAfterCents: customer.balanceCents,
        createdBy: createdById,
      },
    ],
    { session }
  );

  await CustomerWalletTransaction.create(
    [
      {
        customer: customer._id,
        type: 'SALE_PAYMENT',
        amountCents: -appliedCents,
        sale: allocations[0].sale,
        note: `Paid debt automatically: ${invoiceList}`,
        balanceBeforeCents: previousWalletBalanceCents,
        balanceAfterCents: customer.walletBalanceCents,
        createdBy: createdById,
      },
    ],
    { session }
  );

  return appliedCents;
}
