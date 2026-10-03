import mongoose from 'mongoose';

// A business expense paid out of one of the shop's Accounts. Creating one
// immediately posts an OUT AccountTransaction (same model as a Purchase
// payment -- expenses are not part of the Draft/Close Day workflow). Voiding
// one posts a compensating IN transaction; the expense row itself is kept so
// history is never lost, but VOIDED rows are excluded from every report.
const expenseSchema = new mongoose.Schema(
  {
    expenseNumber: { type: String, required: true, unique: true }, // EXP-YYYY-NNNNNN
    category: { type: String, required: true, trim: true }, // validated against ExpenseCategory
    amountCents: { type: Number, required: true, min: 1 },
    date: { type: Date, required: true },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    paymentAccountName: { type: String, default: '' },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    note: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['POSTED', 'VOIDED'], default: 'POSTED' },
    voidedAt: { type: Date, default: null },
    voidReason: { type: String, default: '' },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

expenseSchema.index({ date: -1 });
expenseSchema.index({ status: 1, date: -1 });
expenseSchema.index({ category: 1, date: -1 });

export default mongoose.model('Expense', expenseSchema);
