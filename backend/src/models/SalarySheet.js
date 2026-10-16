import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// One person's line on a salary sheet: who, how much, and (once paid) the
// expense that paid it.
const rowSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    role: { type: String, default: '' },
    amountCents: { type: Number, required: true, min: 0 },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
    expenseNumber: { type: String, default: '' },
  },
  { _id: false }
);

// The payroll sheet, like the Vendor Balance Summary: every user with the
// salary to give them this period. Saved while OPEN; "Pay salaries" pays
// every line at once from one account (each as a "Salaries" expense) and
// marks it PAID; a paid sheet can be CANCELLED, voiding those expenses so the
// money goes back to the account.
const schema = new mongoose.Schema(
  {
    sheetNumber: { type: String, required: true, unique: true }, // SAL-YYYY-NNNNNN
    period: { type: String, required: true }, // YYYY-MM
    status: { type: String, enum: ['OPEN', 'PAID', 'CANCELLED'], default: 'OPEN' },
    rows: { type: [rowSchema], default: [] },
    note: { type: String, default: '', maxlength: 500 },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentAccountName: { type: String, default: '' },
    paymentDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paidByName: { type: String, default: '' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    cancelledByName: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ status: 1, createdAt: -1 });

schema.plugin(branchScoped);

export default mongoose.model('SalarySheet', schema);
