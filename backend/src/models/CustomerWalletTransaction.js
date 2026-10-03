import mongoose from 'mongoose';

// The append-only ledger behind Customer.walletBalanceCents, mirroring how
// CustomerLedger backs balanceCents (debt). Kept entirely separate from
// that collection because a wallet deposit/use is never a debt event: a
// deposit is prepaid store credit (money already in an Account), and using
// it on a sale consumes that credit rather than creating or paying debt.
const schema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: { type: String, enum: ['DEPOSIT', 'SALE_PAYMENT', 'ADJUSTMENT', 'REFUND'], required: true },
    amountCents: { type: Number, required: true }, // signed: +increases wallet, -decreases wallet
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null }, // set for DEPOSIT: which Account received the cash
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null }, // set for SALE_PAYMENT: which invoice consumed the credit
    note: { type: String, default: '', maxlength: 500 },
    balanceBeforeCents: { type: Number, required: true },
    balanceAfterCents: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ customer: 1, createdAt: -1 });
schema.index({ sale: 1 });

export default mongoose.model('CustomerWalletTransaction', schema);
