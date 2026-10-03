import mongoose from 'mongoose';

// A purchase batch of stock at a specific cost from a specific supplier.
// Sales consume lots oldest-first (FIFO) so that COGS/profit can always be
// traced back to the exact purchase (and therefore supplier) that produced
// it, even when the same item has been bought at different costs over time.
const inventoryLotSchema = new mongoose.Schema(
  {
    stockEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'StockEntry', default: null },
    stockSerial: { type: String, default: '' },
    sellingPriceCents: { type: Number, min: 0, default: null },
    expiryDate: { type: Date, default: null },
    receivedAt: { type: Date, default: Date.now },
    reservedQuantity: { type: Number, min: 0, default: 0 },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    unitCostCents: { type: Number, required: true, min: 0 },
    originalQuantity: { type: Number, required: true, min: 0 },
    remainingQuantity: { type: Number, required: true, min: 0 },
    // A synthetic lot created lazily to cover stock that existed before lot
    // tracking (or was entered without a purchase). Consumed first so real,
    // traceable purchases are preferred for reporting as soon as possible.
    isLegacy: { type: Boolean, default: false },
  },
  { timestamps: true }
);

inventoryLotSchema.index({ item: 1, remainingQuantity: 1, createdAt: 1 });
inventoryLotSchema.index({ supplier: 1 });
inventoryLotSchema.index({ purchase: 1 });

export default mongoose.model('InventoryLot', inventoryLotSchema);
