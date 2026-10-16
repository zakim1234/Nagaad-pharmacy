import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

const allocationSchema = new mongoose.Schema(
  {
    sale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    receiptNumber: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentAccountName: { type: String, default: '' },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    requestKey: { type: String },
    requestFingerprint: { type: String },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    amountCents: { type: Number, required: true },
    type: { type: String, enum: ['sale', 'debt_payment', 'refund'], default: 'debt_payment' },
    relatedSale: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null }, // used for type: 'sale' (payment collected at sale time)
    allocations: { type: [allocationSchema], default: [] }, // used for type: 'debt_payment' — which invoices this payment settled
    previousBalanceCents: { type: Number, default: 0 },
    newBalanceCents: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    // CANCELLED: the debt was put back on its invoices and the money went to
    // the customer's wallet or back out of the account (refundedTo).
    status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
    cancelledByName: { type: String, default: '' },
    refundedTo: { type: String, enum: ['', 'WALLET', 'ACCOUNT'], default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ createdBy: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });


paymentSchema.plugin(branchScoped);

export default mongoose.model('Payment', paymentSchema);
