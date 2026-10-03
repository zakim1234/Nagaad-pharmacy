import Account from '../models/Account.js';
import AccountTransaction from '../models/AccountTransaction.js';
import { ApiError } from '../utils/ApiError.js';

// Creates a PENDING receipt for a Draft sale's payment. Does NOT touch the
// account's currentBalanceCents -- a Draft can still be edited/cancelled
// same-day, and finalized account history must never be corrupted by that.
export async function createPendingTransaction(
  { account, direction, type, amountCents, referenceType, referenceId, description, createdBy },
  session
) {
  if (amountCents <= 0) return null;
  const [txn] = await AccountTransaction.create(
    [
      {
        account: account._id || account,
        status: 'PENDING',
        direction,
        type,
        amountCents,
        referenceType,
        referenceId,
        description,
        createdBy: createdBy?._id || createdBy || null,
      },
    ],
    { session }
  );
  return txn;
}

// Flips a PENDING transaction to POSTED and actually moves the account
// balance. Used by Close Day when a Draft sale is confirmed.
export async function postTransaction(transactionId, session) {
  if (!transactionId) return null;
  const txn = await AccountTransaction.findById(transactionId).session(session);
  if (!txn || txn.status !== 'PENDING') return txn;

  const account = await Account.findById(txn.account).session(session);
  if (!account) throw new ApiError(404, 'Payment account for this transaction no longer exists.');

  const balanceBeforeCents = account.currentBalanceCents;
  const delta = txn.direction === 'IN' ? txn.amountCents : -txn.amountCents;
  account.currentBalanceCents = balanceBeforeCents + delta;
  await account.save({ session });

  txn.status = 'POSTED';
  txn.balanceBeforeCents = balanceBeforeCents;
  txn.balanceAfterCents = account.currentBalanceCents;
  txn.postedAt = new Date();
  await txn.save({ session });

  return txn;
}

// Cancels a PENDING transaction without ever touching the account balance
// (it was never posted). Used when a Draft sale is edited/cancelled.
export async function reverseTransaction(transactionId, session) {
  if (!transactionId) return null;
  const txn = await AccountTransaction.findById(transactionId).session(session);
  if (!txn || txn.status !== 'PENDING') return txn;
  txn.status = 'REVERSED';
  txn.reversedAt = new Date();
  await txn.save({ session });
  return txn;
}

// Posts money immediately (used for Purchase Invoice payments, which are
// not part of the Draft/Close Day workflow).
export async function postImmediateTransaction(
  { account, direction, type, amountCents, referenceType, referenceId, description, createdBy },
  session
) {
  if (amountCents <= 0) return null;
  const balanceBeforeCents = account.currentBalanceCents;
  const delta = direction === 'IN' ? amountCents : -amountCents;
  account.currentBalanceCents = balanceBeforeCents + delta;
  await account.save({ session });

  const [txn] = await AccountTransaction.create(
    [
      {
        account: account._id,
        status: 'POSTED',
        direction,
        type,
        amountCents,
        referenceType,
        referenceId,
        description,
        balanceBeforeCents,
        balanceAfterCents: account.currentBalanceCents,
        postedAt: new Date(),
        createdBy: createdBy?._id || createdBy || null,
      },
    ],
    { session }
  );
  return txn;
}
