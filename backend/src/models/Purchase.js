import mongoose from 'mongoose';

const purchaseItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCostCents: { type: Number, required: true, min: 0 },
    subtotalCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const purchaseSchema = new mongoose.Schema(
  {
    purchaseNumber: { type: String, required: true, unique: true }, // our own internal serial, e.g. PINV-2026-000001
    supplierInvoiceNumber: { type: String, trim: true, default: '' }, // the supplier's own invoice/serial number
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    items: { type: [purchaseItemSchema], default: [] },
    totalCostCents: { type: Number, required: true, default: 0 },
    paidAmountCents: { type: Number, required: true, default: 0 },
    balanceCents: { type: Number, required: true, default: 0 }, // owed to supplier
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    purchaseDate: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['completed', 'voided'], default: 'completed' },
    voidedAt: { type: Date, default: null },
    voidedReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

purchaseSchema.index({ supplier: 1, createdAt: -1 });
purchaseSchema.index({ createdAt: -1 });

export default mongoose.model('Purchase', purchaseSchema);
