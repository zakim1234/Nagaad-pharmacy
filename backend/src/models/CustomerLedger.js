import mongoose from 'mongoose';

// The append-only source of truth for every customer balance change.
// Customer.balanceCents is a cached, always-atomically-updated projection
// of this ledger, kept for fast reads - but this collection is what answers
// "where did this debt come from" and must never be edited or deleted.
const customerLedgerSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: {
      type: String,
      enum: ['SALE_CREDIT', 'PAYMENT', 'ADJUSTMENT', 'SALE_VOID', 'SALE_RETURN', 'REFUND'],
      required: true,
    },
    amountCents: { type: Number, required: true }, // signed: +increases debt, -decreases debt
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    description: { type: String, default: '' },
    balanceBeforeCents: { type: Number, required: true },
    balanceAfterCents: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

customerLedgerSchema.index({ customer: 1, createdAt: 1 });
customerLedgerSchema.index({ sale: 1 });

export default mongoose.model('CustomerLedger', customerLedgerSchema);
