import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import StockAdjustment, { DECREASE_REASONS, INCREASE_REASONS } from '../models/StockAdjustment.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { compareBatches, ensureLegacyLots } from './batchService.js';

async function generateAdjustmentNumber(session) {
  const seq = await nextSequence('stockAdjustment', session);
  return `ADJ-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
}

function parseExpiry(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApiError(400, 'Expiry date is invalid.');
  return new Date(value);
}

// Records one stock adjusting entry and applies it to the item and its
// batches, inside the caller's transaction.
//
// DECREASE removes units from batches: the batch the user picked, or
// otherwise nearest-expiry first (so expired stock is written off before
// good stock). Units held by Draft sales can never be adjusted away.
// The item's Weighted Average Cost is unchanged -- removing units at the
// average leaves the average itself the same.
//
// INCREASE adds the units back as a new batch at the item's current
// average cost (so the average is unchanged), optionally with an expiry.
export async function createStockAdjustment(session, { itemId, direction, quantity, reason, note = '', lotId = null, expiryDate = null, user }) {
  if (!['DECREASE', 'INCREASE'].includes(direction)) throw new ApiError(400, 'Choose whether stock is decreasing or increasing.');
  const qty = Number(quantity);
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new ApiError(400, 'Quantity must be a positive whole number.');
  const allowed = direction === 'DECREASE' ? DECREASE_REASONS : INCREASE_REASONS;
  if (!allowed.includes(reason)) throw new ApiError(400, 'Choose a valid reason for this adjustment.');
  const cleanNote = String(note ?? '').trim();
  if (cleanNote.length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');
  if (reason === 'OTHER' && !cleanNote) throw new ApiError(400, 'Please write a note explaining the adjustment.');

  const item = await InventoryItem.findById(itemId).session(session);
  if (!item) throw new ApiError(404, 'Product not found.');

  const adjustmentNumber = await generateAdjustmentNumber(session);
  const quantityBefore = item.quantity;
  const lotMoves = [];

  if (direction === 'DECREASE') {
    const free = item.quantity - (item.reservedQuantity || 0);
    if (qty > free) {
      throw new ApiError(409, `Only ${free} ${item.unit} of "${item.name}" can be adjusted${item.reservedQuantity ? ` (${item.reservedQuantity} are held by pending invoices)` : ''}.`);
    }
    const lots = await ensureLegacyLots(item, session);
    let candidates = lots.filter((l) => l.remainingQuantity - (l.reservedQuantity || 0) > 0).sort(compareBatches);
    if (lotId) {
      candidates = candidates.filter((l) => String(l._id) === String(lotId));
      if (!candidates.length) throw new ApiError(400, 'The selected batch has no stock that can be adjusted.');
    }
    let needed = qty;
    for (const lot of candidates) {
      if (needed <= 0) break;
      const take = Math.min(needed, lot.remainingQuantity - (lot.reservedQuantity || 0));
      const result = await InventoryLot.updateOne({ _id: lot._id, remainingQuantity: { $gte: take } }, { $inc: { remainingQuantity: -take } }, { session });
      if (result.modifiedCount !== 1) throw new ApiError(409, 'Batch stock changed while adjusting. Please try again.');
      lotMoves.push({ lot: lot._id, stockSerial: lot.stockSerial || '', expiryDate: lot.expiryDate || null, quantity: -take });
      needed -= take;
    }
    if (needed > 0) throw new ApiError(409, `The selected batch only has ${qty - needed} ${item.unit} that can be adjusted.`);
    item.quantity -= qty;
  } else {
    if (lotId) throw new ApiError(400, 'A batch is only chosen when decreasing stock.');
    const expiry = parseExpiry(expiryDate);
    // Make sure pre-batch stock is covered by a legacy lot before adding a
    // new one, so tracked batches keep matching the item's quantity.
    await ensureLegacyLots(item, session);
    const [lot] = await InventoryLot.create(
      [
        {
          item: item._id,
          stockSerial: adjustmentNumber,
          supplier: null,
          unitCostCents: item.costPriceCents,
          sellingPriceCents: item.sellingPriceCents,
          originalQuantity: qty,
          remainingQuantity: qty,
          expiryDate: expiry,
          receivedAt: new Date(),
        },
      ],
      { session }
    );
    lotMoves.push({ lot: lot._id, stockSerial: adjustmentNumber, expiryDate: expiry, quantity: qty });
    item.quantity += qty;
  }

  item.stockEvents.push({
    type: direction === 'DECREASE' ? (item.quantity === 0 ? 'OUT_OF_STOCK' : 'ADJUSTMENT_OUT') : 'ADJUSTMENT_IN',
    reference: adjustmentNumber,
    quantityBefore,
    quantityAfter: item.quantity,
  });
  await item.save({ session });

  const [adjustment] = await StockAdjustment.create(
    [
      {
        adjustmentNumber,
        item: item._id,
        itemName: item.name,
        itemCode: item.itemCode,
        unit: item.unit,
        direction,
        quantity: qty,
        reason,
        note: cleanNote,
        quantityBefore,
        quantityAfter: item.quantity,
        unitCostCents: item.costPriceCents,
        valueCents: qty * item.costPriceCents,
        lots: lotMoves,
        createdBy: user?._id || null,
        createdByName: user?.name || '',
      },
    ],
    { session }
  );
  return adjustment;
}

// Net value of stock adjustments in a period: write-offs (DECREASE) minus
// stock found (INCREASE). Positive = a loss that reduces profit.
export async function netAdjustmentValueCents({ start, end }) {
  const rows = await StockAdjustment.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$direction', cents: { $sum: '$valueCents' } } },
  ]);
  const decrease = rows.find((r) => r._id === 'DECREASE')?.cents || 0;
  const increase = rows.find((r) => r._id === 'INCREASE')?.cents || 0;
  return decrease - increase;
}
