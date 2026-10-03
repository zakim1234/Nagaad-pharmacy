import mongoose from 'mongoose';

// A durable, non-trade asset (computer, shelving, furniture, ...) recorded
// for the Balance Sheet's Fixed Assets section. Not inventory -- these are
// never sold and never touch Stock/WAC.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    valueCents: { type: Number, required: true, min: 0 },
    dateAdded: { type: Date, required: true },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    removedAt: { type: Date, default: null },
    removedReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ isActive: 1, dateAdded: -1 });

export default mongoose.model('FixedAsset', schema);
