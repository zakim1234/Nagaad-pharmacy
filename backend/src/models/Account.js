import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['MOBILE_MONEY', 'BANK', 'MERCHANT', 'OTHER'], default: 'OTHER' },
    accountNumber: { type: String, trim: true, default: '' },
    openingBalanceCents: { type: Number, default: 0 },
    // Reflects only POSTED account transactions. Pending (same-day draft)
    // receipts are never added here -- see AccountTransaction for those.
    currentBalanceCents: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

accountSchema.index({ branch: 1, name: 1 }, { unique: true });
accountSchema.plugin(branchScoped);

export default mongoose.model('Account', accountSchema);
