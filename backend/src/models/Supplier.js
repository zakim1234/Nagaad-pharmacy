import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    notes: { type: String, default: '' },
    totalSpentCents: { type: Number, default: 0 },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 'text', phone: 'text' });

export default mongoose.model('Supplier', supplierSchema);
