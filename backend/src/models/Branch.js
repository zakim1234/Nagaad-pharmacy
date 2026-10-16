import mongoose from 'mongoose';

// A shop location. Each branch keeps its own items, stock, customers,
// suppliers, accounts, sales, purchases and day closing (see
// services/branchContext.js); only users and the Super Admin span branches.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    address: { type: String, default: '', trim: true, maxlength: 200 },
    phone: { type: String, default: '', trim: true, maxlength: 100 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

schema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export default mongoose.model('Branch', schema);
