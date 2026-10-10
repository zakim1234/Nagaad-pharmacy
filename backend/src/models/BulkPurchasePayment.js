import mongoose from 'mongoose';

// One payment made to a supplier that is spread across several of their
// purchase invoices (oldest first). The money leaves the account as ONE
// transaction; each invoice it reached still gets its own PurchasePayment
// (linked back here) so its Payment History and balance stay correct.
// This document is the single receipt for the whole payment.
const schema = new mongoose.Schema(
  {
    bulkNumber: { type: String, required: true, unique: true }, // BPAY-YYYY-NNNNNN
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 1 },
    // Total still owed on the invoices that were selected, before paying.
    selectedOwedCents: { type: Number, required: true, min: 0 },
    percentage: { type: Number, default: null }, // the % picked, when the amount came from one
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    paymentAccountName: { type: String, default: '' },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    paymentDate: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 500 },
    // Serial number on the supplier's own (often handwritten) payment receipt.
    receiptNo: { type: String, default: '', maxlength: 60, trim: true },
    allocations: [
      {
        purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', required: true },
        purchaseNumber: { type: String, required: true },
        payment: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchasePayment', default: null },
        amountCents: { type: Number, required: true, min: 0 },
        previousBalanceCents: { type: Number, required: true },
        newBalanceCents: { type: Number, required: true },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    // CANCELLED: every part was reversed and the money returned to the account.
    status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '', maxlength: 500 },
    cancelledByName: { type: String, default: '' },
  },
  { timestamps: true }
);

schema.index({ supplier: 1, createdAt: -1 });

export default mongoose.model('BulkPurchasePayment', schema);
