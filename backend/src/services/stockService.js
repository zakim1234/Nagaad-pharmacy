import { reserveBatches, releaseBatches } from './batchService.js';
import InventoryItem from '../models/InventoryItem.js';
import { ApiError } from '../utils/ApiError.js';

// Reserves `quantity` units of an item for a Draft sale. Never touches
// physical `quantity` -- only shrinks what is still available to sell.
export async function reserveStock(itemId, quantity, session) {
  const item = await InventoryItem.findById(itemId).session(session);
  if (!item) throw new ApiError(404, `Product not found (id: ${itemId}).`);
  const available = item.quantity - item.reservedQuantity;
  if (available < quantity) {
    throw new ApiError(
      409,
      `Not enough available stock for "${item.name}". Available: ${available}, requested: ${quantity}.`
    );
  }
  const allocations = await reserveBatches(item, quantity, session);
  item.reservedQuantity += quantity;
  await item.save({ session });
  return allocations;
}

// Releases a previously reserved quantity (Draft edited down, or cancelled).
export async function releaseReservation(itemId, quantity, session, allocations = []) {
  if (quantity <= 0) return;
  await releaseBatches(allocations, session);
  await InventoryItem.findByIdAndUpdate(
    itemId,
    [{ $set: { reservedQuantity: { $max: [0, { $subtract: ['$reservedQuantity', quantity] }] } } }],
    { session }
  );
}

// Close Day: converts a reservation into a permanent stock deduction.
export async function confirmReservation(itemId, quantity, session, reference = '') {
  const item = await InventoryItem.findById(itemId).session(session);
  if (!item) throw new ApiError(404, `Product not found (id: ${itemId}).`);
  if (item.reservedQuantity < quantity || item.quantity < quantity) throw new ApiError(409, 'Stock reservation is inconsistent.');
  item.reservedQuantity -= quantity;
  item.stockEvents.push({ type: item.quantity === quantity ? 'OUT_OF_STOCK' : 'SALE', reference, quantityBefore: item.quantity, quantityAfter: item.quantity - quantity });
  item.quantity -= quantity;
  await item.save({ session });
  return item;
}
