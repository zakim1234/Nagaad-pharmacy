import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// The list of categories an expense can be filed under (and therefore the
// expense rows of the Profit & Loss report). Admins/managers can add more;
// nothing is ever deleted, so historical expenses always resolve.
const expenseCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

expenseCategorySchema.index({ branch: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

expenseCategorySchema.plugin(branchScoped);

export default mongoose.model('ExpenseCategory', expenseCategorySchema);
