import mongoose from 'mongoose';

// One manually-entered row of a supplier's paper invoice: item name (free
// text -- not required to match a canonical InventoryItem), quantity, cost,
// and the line total. No selling price -- this is a purchase-facing archive,
// never a sale.
const rowSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    costCents: { type: Number, required: true, min: 0 },
    totalCents: { type: Number, required: true, min: 0 }, // quantity * costCents, historical
  },
  { _id: false }
);

// Pure archive/reference record of a supplier's invoice as received. This
// intentionally never touches Stock or InventoryItem -- see
// supplierInvoiceArchiveController.createArchive. Distinct from the
// Stock-derived Supplier Invoice view (built from StockEntry) and from
// Purchase (the accounting/payment record); this exists purely so a
// supplier's paper invoice can be searched and reproduced exactly as
// originally entered, unaffected by later Stock/Inventory changes.
const schema = new mongoose.Schema(
  {
    archiveNumber: { type: String, required: true, unique: true }, // SINV-YYYY-NNNNNN, our own reference
    serialNumber: { type: String, required: true, trim: true }, // the supplier/shop's own invoice number -- primary search key
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplierName: { type: String, default: '' },
    rows: { type: [rowSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
    grandTotalCents: { type: Number, required: true, min: 0 },
    notes: { type: String, default: '', maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  // autoIndex is disabled here on purpose, same reasoning as
  // InventoryItem's itemCode/serialNumber: the serialNumber unique index
  // must only be built AFTER confirming no pre-existing archives already
  // share a serial (see utils/runMigrateSupplierArchive.js) -- otherwise
  // the index build itself would fail outright on a database that already
  // has duplicates. Run that migration once before relying on this
  // uniqueness being enforced.
  { timestamps: true, autoIndex: false }
);

schema.index({ serialNumber: 1 }, { unique: true });
schema.index({ supplier: 1, createdAt: -1 });

export default mongoose.model('SupplierInvoiceArchive', schema);
