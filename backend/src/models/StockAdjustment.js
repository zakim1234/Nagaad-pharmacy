import mongoose from 'mongoose';

export const DECREASE_REASONS = ['DAMAGED', 'EXPIRED', 'LOST', 'THEFT', 'COUNT_CORRECTION', 'OTHER'];
export const INCREASE_REASONS = ['COUNT_CORRECTION', 'FOUND', 'OTHER'];

// One stock adjusting entry: a manual correction of an item's on-hand
// quantity outside of purchases and sales (damaged/expired/lost goods,
// physical count differences). Append-only -- a mistaken adjustment is
// corrected by a second, opposite adjustment, never by editing this one.
const stockAdjustmentSchema = new mongoose.Schema(
  {
    adjustmentNumber: { type: String, required: true, unique: true }, // ADJ-YYYY-NNNNNN
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    itemCode: { type: String, default: '' },
    unit: { type: String, default: 'pcs' },
    direction: { type: String, enum: ['DECREASE', 'INCREASE'], required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String, enum: [...new Set([...DECREASE_REASONS, ...INCREASE_REASONS])], required: true },
    note: { type: String, default: '', maxlength: 500 },
    quantityBefore: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },
    // Weighted Average Cost at the moment of the adjustment -- the value of
    // the stock written off (DECREASE) or added back (INCREASE).
    unitCostCents: { type: Number, required: true, min: 0 },
    valueCents: { type: Number, required: true, min: 0 },
    // Which batches (lots) the units were taken from or added to, so batch
    // traceability stays exact.
    lots: [
      {
        lot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot' },
        stockSerial: { type: String, default: '' },
        expiryDate: { type: Date, default: null },
        quantity: { type: Number, required: true },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
    // Set when this adjustment was one line of a whole-stock count (BADJ-YYYY-NNNNNN).
    countNumber: { type: String, default: '' },
  },
  { timestamps: true }
);

stockAdjustmentSchema.index({ createdAt: -1 });
stockAdjustmentSchema.index({ item: 1, createdAt: -1 });
stockAdjustmentSchema.index({ countNumber: 1 });

export default mongoose.model('StockAdjustment', stockAdjustmentSchema);
