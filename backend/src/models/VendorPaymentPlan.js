import mongoose from 'mongoose';

// The Vendor Balance Summary sheet: what each supplier is owed and how much
// the owner allocates to pay each of them this round. Saved while OPEN so
// it can be edited and printed over several sittings; "Pay allocations"
// turns every allocation into a real supplier payment at once and marks
// the plan PAID (kept as the printed record with each row marked OK).
const rowSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    owedCents: { type: Number, required: true, min: 0 }, // balance when the row was last saved / paid
    allocationCents: { type: Number, required: true, min: 0 },
    receiptNo: { type: String, default: '', maxlength: 60, trim: true }, // supplier's receipt serial
    paidCents: { type: Number, default: 0 },
    bulkPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkPurchasePayment', default: null },
    bulkNumber: { type: String, default: '' },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    planNumber: { type: String, required: true, unique: true }, // VPLAN-YYYY-NNNNNN
    // CANCELLED: it was paid, then every payment on it was cancelled and refunded.
    status: { type: String, enum: ['OPEN', 'PAID', 'CANCELLED'], default: 'OPEN' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    cancelledByName: { type: String, default: '' },
    rows: { type: [rowSchema], default: [] },
    note: { type: String, default: '', maxlength: 500 },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentAccountName: { type: String, default: '' },
    paymentDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paidByName: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ status: 1, createdAt: -1 });

export default mongoose.model('VendorPaymentPlan', schema);
