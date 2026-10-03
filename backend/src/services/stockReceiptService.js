import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import StockEntry from '../models/StockEntry.js';
import Supplier from '../models/Supplier.js';
import Category from '../models/Category.js';
import { nextSequence } from '../models/Counter.js';
import { ensureLegacyLots } from './batchService.js';
import { calculateWeightedAverageCost } from './costingService.js';
import { ApiError } from '../utils/ApiError.js';
import { toCents } from '../utils/money.js';

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Receives stock (Stock IN) inside the caller's transaction: creates one
// StockEntry, one InventoryLot per row, blends the Weighted Average Cost, and
// creates any item that does not exist yet (matched by exact name,
// case-insensitive). This is the single implementation behind both the Stock
// page and the POS quick-create, so the WAC/lot/serial rules cannot drift.
//
// rows: [{ itemId? | name, quantity, costPrice, sellingPrice, expiryDate?, categoryId? }]
// `categoryId` is only applied when the row creates a brand-new item.
export async function receiveStock(session, { rows, externalSerialNumber = '', supplierId = null, user }) {
  let supplier = null;
  if (supplierId) {
    supplier = await Supplier.findById(supplierId).session(session);
    if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');
  }
  // This shared counter also serializes concurrent inline item creation.
  const seq = await nextSequence('stockEntry', session);
  const stockSerial = `STK-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
  const entry = new StockEntry({ stockSerial, externalSerialNumber: externalSerialNumber.trim(), supplier: supplier?._id || null, createdBy: user._id, rows: [] });
  const touched = [];

  for (const row of rows) {
    const name = String(row.name || '').trim().replace(/\s+/g, ' ');
    let item = row.itemId ? await InventoryItem.findById(row.itemId).session(session) : await InventoryItem.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }).session(session);
    if (!item && row.itemId) throw new ApiError(404, 'Selected item no longer exists.');
    if (!item) {
      let category = null;
      if (row.categoryId) {
        category = (await Category.findById(row.categoryId).session(session))?._id;
        if (!category) throw new ApiError(400, 'Selected category no longer exists.');
      }
      const code = await nextSequence('itemCode', session);
      item = new InventoryItem({ name, itemCode: `ITM-${String(code).padStart(6, '0')}`, quantity: 0, category });
    } else await ensureLegacyLots(item, session);

    const quantity = Number(row.quantity), costPriceCents = toCents(row.costPrice), sellingPriceCents = toCents(row.sellingPrice);
    const expiryDate = row.expiryDate ? new Date(`${row.expiryDate}T23:59:59.999Z`) : null;
    const [batch] = await InventoryLot.create([{ item: item._id, stockEntry: entry._id, stockSerial, supplier: supplier?._id || item.supplier || null, unitCostCents: costPriceCents, sellingPriceCents, expiryDate, originalQuantity: quantity, remainingQuantity: quantity }], { session });
    // WAC recalculated here, inside this transaction, from the item's
    // CURRENT quantity/average -- never from a value read earlier or
    // computed on the frontend. If another request receives stock for the
    // same item concurrently, runInTransaction's session.withTransaction
    // retries this whole callback on write conflict, so this always blends
    // against the latest committed state (no lost update).
    const oldQuantity = item.quantity;
    const oldAverageCostCents = item.costPriceCents;
    const newAverageCostCents = calculateWeightedAverageCost({
      oldQuantity,
      oldAverageCostCents,
      incomingQuantity: quantity,
      incomingUnitCostCents: costPriceCents,
    });
    item.stockEvents.push({
      type: item.quantity === 0 ? 'RESTOCK' : 'RECEIPT',
      reference: stockSerial,
      quantityBefore: item.quantity,
      quantityAfter: item.quantity + quantity,
      averageCostBeforeCents: oldAverageCostCents,
      averageCostAfterCents: newAverageCostCents,
    });
    item.quantity += quantity;
    item.sellingPriceCents = sellingPriceCents;
    item.costPriceCents = newAverageCostCents;
    if (supplier && !item.supplier) item.supplier = supplier._id;
    await item.save({ session });
    entry.rows.push({ item: item._id, itemName: item.name, batch: batch._id, quantity, costPriceCents, sellingPriceCents, expiryDate });
    touched.push(item);
  }
  await entry.save({ session });
  return { entry, items: touched };
}
