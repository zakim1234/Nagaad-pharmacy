import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

function normalize(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    openingBalanceCents: { type: Number, default: 0 },
    balanceCents: { type: Number, default: 0 }, // positive = customer owes us (debt)
    // Prepaid store credit -- entirely separate from balanceCents (debt).
    // Increases on Add Deposit, decreases when applied to a sale. Never
    // negative.
    walletBalanceCents: { type: Number, default: 0, min: 0 },
    // When true, wallet money pays this customer's debt automatically (on
    // deposit, at Close Day, after a reversal). Off by default: the money
    // stays in the wallet until someone chooses to use it on the debt.
    walletAutoPay: { type: Boolean, default: false },
    totalPurchasedCents: { type: Number, default: 0 },
    totalPaidCents: { type: Number, default: 0 },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

customerSchema.pre('validate', function setNormalizedName(next) {
  this.normalizedName = normalize(this.name);
  next();
});

customerSchema.index({ normalizedName: 1 });
customerSchema.index({ phone: 1 });
customerSchema.index({ name: 'text', phone: 'text' });

customerSchema.statics.normalize = normalize;

customerSchema.plugin(branchScoped);

export default mongoose.model('Customer', customerSchema);
