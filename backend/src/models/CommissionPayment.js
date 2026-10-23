import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// Commission paid for one month or one year: each person gets the
// percentage typed in for them, of that period's profit before commissions.
// Every line is posted as a "Commission" expense, so the profit the partners
// share afterwards is already net of commission. Cancelling voids those
// expenses (money back to the account) and keeps this record.
const lineSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for someone who is not a user
    name: { type: String, required: true },
    role: { type: String, default: '' },
    percent: { type: Number, required: true },
    amountCents: { type: Number, required: true },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    commissionNumber: { type: String, required: true }, // CM-2026-0001
    periodType: { type: String, enum: ['month', 'year'], required: true },
    periodKey: { type: String, required: true }, // "2026-10" or "2026"
    baseProfitCents: { type: Number, required: true }, // profit before commissions when paid
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    accountName: { type: String, default: '' },
    date: { type: Date, required: true }, // the expense date, inside the period
    note: { type: String, default: '', maxlength: 500 },
    lines: { type: [lineSchema], default: [] },
    totalCents: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledAt: { type: Date, default: null },
    cancelledByName: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

schema.index({ periodType: 1, periodKey: 1, status: 1 });

schema.plugin(branchScoped);

export default mongoose.model('CommissionPayment', schema);
