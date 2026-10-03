import mongoose from 'mongoose';

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
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

export default mongoose.model('Account', accountSchema);
