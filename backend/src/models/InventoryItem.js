import mongoose from 'mongoose';

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const inventoryItemSchema = new mongoose.Schema(
  {
    // averageCostBeforeCents/averageCostAfterCents are only populated for
    // events that actually move the Weighted Average Cost (Stock IN,
    // customer return, full sale reversal) -- undefined/null on events that
    // only change quantity (a normal sale never changes WAC, see Phase 12).
    stockEvents: [{ at: { type: Date, default: Date.now }, type: { type: String }, reference: String, quantityBefore: Number, quantityAfter: Number, averageCostBeforeCents: { type: Number, default: null }, averageCostAfterCents: { type: Number, default: null } }],
    itemCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    serialNumber: { type: String, trim: true, default: '' },
    genericName: { type: String, trim: true, default: '' },
    manufacturer: { type: String, trim: true, default: '' },
    // Item-level reference batch label. Real per-receipt batches are tracked
    // separately on InventoryLot (stockSerial); this is the manufacturer's own
    // batch/lot code printed on the product.
    batchNumber: { type: String, trim: true, default: '' },
    // Legacy fields kept so historical records are never lost. No longer
    // collected from the UI (see itemCode/serialNumber above).
    sku: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, default: '' },
    quantity: { type: Number, required: true, default: 0, min: 0 }, // physical on-hand stock
    // Held by DRAFT sales so two draft invoices can never both promise the
    // same unit. Physical `quantity` is only ever decremented when a draft
    // is CONFIRMED (Close Day) -- never at draft creation time.
    reservedQuantity: { type: Number, required: true, default: 0, min: 0 },
    unit: { type: String, default: 'pcs' },
    // Weighted Average Cost (WAC) of the quantity currently in stock -- the
    // canonical, continuously-blended acquisition cost per unit. Updated by
    // costingService.calculateWeightedAverageCost() on every event that adds
    // stock (Stock IN receipt, customer return, full sale reversal). A
    // normal sale/stock-out never changes it (removing units at the current
    // average leaves the average itself unchanged). Admins may still
    // directly correct it via the Inventory edit form for data-entry fixes;
    // that manual path is unrelated to the automatic receipt-time blend.
    costPriceCents: { type: Number, required: true, default: 0, min: 0 },
    sellingPriceCents: { type: Number, required: true, default: 0, min: 0 },
    // "Minimum Stock" in the UI: at or below this quantity the item is flagged
    // Low Stock (Dashboard alert + Low Stock report). Defaults centrally.
    lowStockThreshold: { type: Number, default: DEFAULT_LOW_STOCK_THRESHOLD, min: 0 },
    expiryDate: { type: Date, default: null },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  // autoIndex is disabled here on purpose: the itemCode/serialNumber unique
  // indexes must only be built AFTER migrateInventorySchema() has backfilled
  // every legacy document, otherwise multiple docs sharing an absent
  // itemCode would collide on the unique index build. server.js calls
  // InventoryItem.syncIndexes() itself once migration has run.
  { timestamps: true, autoIndex: false }
);

inventoryItemSchema.index({ name: 'text', itemCode: 'text', serialNumber: 'text', sku: 'text', barcode: 'text' });
inventoryItemSchema.index({ barcode: 1 });
inventoryItemSchema.index({ itemCode: 1 }, { unique: true });
// $ne isn't supported in a partial index filter; $gt: '' is an equivalent
// "non-empty string" test since all non-empty strings sort after ''.
inventoryItemSchema.index({ serialNumber: 1 }, { unique: true, partialFilterExpression: { serialNumber: { $type: 'string', $gt: '' } } });
inventoryItemSchema.index({ category: 1 });
inventoryItemSchema.index({ expiryDate: 1 });

inventoryItemSchema.virtual('availableQuantity').get(function computeAvailable() {
  return Math.max(0, this.quantity - (this.reservedQuantity || 0));
});

inventoryItemSchema.virtual('stockStatus').get(function computeStockStatus() {
  if (this.quantity <= 0) return 'out_of_stock';
  if (this.quantity <= this.lowStockThreshold) return 'low_stock';
  return 'in_stock';
});

inventoryItemSchema.virtual('expiryStatus').get(function computeExpiryStatus() {
  if (!this.expiryDate) return 'none';
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.ceil((this.expiryDate.getTime() - now.getTime()) / msPerDay);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'near_expiry';
  return 'ok';
});

inventoryItemSchema.set('toJSON', { virtuals: true });
inventoryItemSchema.set('toObject', { virtuals: true });

export { DEFAULT_LOW_STOCK_THRESHOLD };
export default mongoose.model('InventoryItem', inventoryItemSchema);
