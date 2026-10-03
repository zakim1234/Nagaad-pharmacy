import mongoose from 'mongoose';

// The append-only ledger behind every Account.currentBalanceCents. A sale
// paid into an account starts PENDING (the invoice is still a same-day
// Draft and could still be edited/cancelled); Close Day flips it to POSTED,
// which is the only state that actually moves the account balance. A
// cancelled Draft flips its pending transaction to REVERSED instead.
const accountTransactionSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    status: { type: String, enum: ['PENDING', 'POSTED', 'REVERSED'], default: 'POSTED' },
    direction: { type: String, enum: ['IN', 'OUT'], required: true },
    type: {
      type: String,
      enum: [
        'SALE_PAYMENT',
        'CUSTOMER_DEBT_PAYMENT',
        'PURCHASE_PAYMENT',
        'REFUND',
        'DEPOSIT',
        'WITHDRAWAL',
        'ADJUSTMENT',
        'EXPENSE',
        'PARTNER_CONTRIBUTION',
        'PARTNER_WITHDRAWAL',
      ],
      required: true,
    },
    amountCents: { type: Number, required: true, min: 0 },
    referenceType: { type: String, enum: ['Sale', 'Purchase', 'Payment', 'CustomerWalletTransaction', 'DayClose', 'Expense', 'Partner', 'Manual'], default: 'Manual' },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    description: { type: String, default: '' },
    balanceBeforeCents: { type: Number, default: null },
    balanceAfterCents: { type: Number, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    postedAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

accountTransactionSchema.index({ account: 1, createdAt: -1 });
accountTransactionSchema.index({ referenceType: 1, referenceId: 1 });
accountTransactionSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('AccountTransaction', accountTransactionSchema);
