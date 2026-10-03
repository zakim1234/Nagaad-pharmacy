import mongoose from 'mongoose';

// A shareholder/investor in the business. currentEquityCents is a cached,
// atomically-updated projection (contributions minus withdrawals) kept for
// fast reads, mirroring Account.currentBalanceCents and
// Customer.balanceCents -- PartnerCapitalTransaction is the append-only
// source of truth behind it.
const partnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' },
    totalContributedCents: { type: Number, default: 0 },
    totalWithdrawnCents: { type: Number, default: 0 },
    currentEquityCents: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

partnerSchema.index({ name: 1 });

export default mongoose.model('Partner', partnerSchema);
