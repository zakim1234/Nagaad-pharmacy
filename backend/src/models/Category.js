import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

categorySchema.index({ name: 'text' });

categorySchema.index({ branch: 1, name: 1 }, { unique: true });
categorySchema.plugin(branchScoped);

export default mongoose.model('Category', categorySchema);
