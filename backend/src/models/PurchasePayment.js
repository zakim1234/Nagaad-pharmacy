import mongoose from 'mongoose';

// One payment made toward a Purchase invoice's balance -- there can be many
// of these over time as a supplier is paid in installments. Distinct from
// the customer-facing Payment model (that one requires a `customer` and
// allocates against Sales; this one belongs to a Purchase/supplier instead).
const schema = new mongoose.Schema(
  {
    paymentNumber: { type: String, required: true, unique: true }, // PPAY-YYYY-NNNNNN
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', required: true },
    amountCents: { type: Number, required: true, min: 0 },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    paymentAccountName: { type: String, default: '' },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    previousBalanceCents: { type: Number, required: true }, // Purchase.balanceCents immediately before this payment
    newBalanceCents: { type: Number, required: true },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['POSTED', 'REVERSED'], default: 'POSTED' },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ purchase: 1, createdAt: -1 });

export default mongoose.model('PurchasePayment', schema);
