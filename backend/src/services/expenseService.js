import Expense from '../models/Expense.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { postImmediateTransaction } from './accountService.js';
import { ApiError } from '../utils/ApiError.js';

export async function generateExpenseNumber(session) {
  const seq = await nextSequence('expense', session);
  return `EXP-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
}

// Records one expense paid from `account` (one OUT account transaction).
// Runs inside the caller's transaction; returns the Expense document.
export async function postExpense(session, { category, amountCents, date, account, note = '', user }) {
  const expenseNumber = await generateExpenseNumber(session);
  const txn = await postImmediateTransaction(
    {
      account,
      direction: 'OUT',
      type: 'EXPENSE',
      amountCents,
      referenceType: 'Expense',
      referenceId: null, // filled below once the expense _id exists
      description: `Expense ${expenseNumber} - ${category}${note ? `: ${note}` : ''}`,
      createdBy: user,
    },
    session
  );
  const [created] = await Expense.create(
    [
      {
        expenseNumber,
        category,
        amountCents,
        date,
        paymentAccount: account._id,
        paymentAccountName: account.name,
        accountTransaction: txn._id,
        note: String(note).trim(),
        createdBy: user?._id || null,
        createdByName: user?.name || '',
      },
    ],
    { session }
  );
  txn.referenceId = created._id;
  await txn.save({ session });
  return created;
}

// Voids an expense: its money goes back to the account it was paid from.
export async function voidExpenseDoc(session, doc, { reason = '', user }) {
  if (doc.status === 'VOIDED') throw new ApiError(409, 'This expense has already been voided.');
  const account = await Account.findById(doc.paymentAccount).session(session);
  if (!account) throw new ApiError(409, 'The account this expense was paid from no longer exists. Contact an administrator.');
  await postImmediateTransaction(
    {
      account,
      direction: 'IN',
      type: 'REFUND',
      amountCents: doc.amountCents,
      referenceType: 'Expense',
      referenceId: doc._id,
      description: `Void of expense ${doc.expenseNumber}${reason ? ` (${reason})` : ''}`,
      createdBy: user,
    },
    session
  );
  doc.status = 'VOIDED';
  doc.voidedAt = new Date();
  doc.voidReason = reason;
  doc.voidedBy = user?._id || null;
  await doc.save({ session });
  return doc;
}
