import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
  },
  { timestamps: true }
);

categorySchema.index({ name: 'text' });

export default mongoose.model('Category', categorySchema);
