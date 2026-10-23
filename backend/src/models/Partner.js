import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

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
    totalProfitCents: { type: Number, default: 0 }, // year-end profit shares received (paid out or added to capital)
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

partnerSchema.index({ name: 1 });

partnerSchema.plugin(branchScoped);

export default mongoose.model('Partner', partnerSchema);
