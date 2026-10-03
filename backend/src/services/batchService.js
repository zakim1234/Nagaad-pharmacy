import Sale from '../models/Sale.js';
import InventoryLot from '../models/InventoryLot.js';
import { ApiError } from '../utils/ApiError.js';

export function compareBatches(a, b) {
  return (a.expiryDate ? +new Date(a.expiryDate) : Infinity) - (b.expiryDate ? +new Date(b.expiryDate) : Infinity) || +new Date(a.receivedAt || a.createdAt) - +new Date(b.receivedAt || b.createdAt) || String(a._id).localeCompare(String(b._id));
}
export function allocateBatches(lots, quantity, now = new Date()) {
  let needed = quantity;
  const allocations = [];
  for (const lot of [...lots].filter(b => !b.expiryDate || new Date(b.expiryDate) >= now).sort(compareBatches)) {
    const take = Math.min(needed, Math.max(0, lot.remainingQuantity - (lot.reservedQuantity || 0)));
    if (take > 0) allocations.push({ lot: lot._id, stockSerial: lot.stockSerial || '', supplier: lot.supplier, purchase: lot.purchase, quantity: take, unitCostCents: lot.unitCostCents });
    needed -= take;
    if (!needed) break;
  }
  if (needed) throw new ApiError(409, 'Insufficient sellable batch stock. Expired and reserved stock cannot be sold.');
  return allocations;
}
// Cover only genuine pre-batch physical stock; never fabricate sellable stock
// to compensate for expired or reserved batches.
export async function ensureLegacyLots(item, session) {
  const lots = await InventoryLot.find({ item: item._id }).session(session);
  const tracked = lots.reduce((s, l) => s + l.remainingQuantity, 0);
  const missing = item.quantity - tracked;
  if (missing > 0) {
    const [lot] = await InventoryLot.create([{ item: item._id, supplier: item.supplier, originalQuantity: missing, remainingQuantity: missing, unitCostCents: item.costPriceCents, sellingPriceCents: item.sellingPriceCents, expiryDate: item.expiryDate, receivedAt: item.createdAt, isLegacy: true }], { session });
    lots.push(lot);
  }
  return lots;
}
export async function reserveBatches(item, quantity, session) {
  const lots = await ensureLegacyLots(item, session);
  const allocations = allocateBatches(lots, quantity);
  for (const a of allocations) await InventoryLot.updateOne({ _id: a.lot }, { $inc: { reservedQuantity: a.quantity } }, { session });
  return allocations;
}
export async function releaseBatches(allocations, session) {
  for (const a of allocations || []) {
    const result = await InventoryLot.updateOne({ _id: a.lot, reservedQuantity: { $gte: a.quantity } }, { $inc: { reservedQuantity: -a.quantity } }, { session });
    if (result.modifiedCount !== 1) throw new ApiError(409, 'Batch reservation is inconsistent.');
  }
}
export async function consumeReservedBatches(allocations, session) {
  for (const a of allocations) {
    const result = await InventoryLot.updateOne({ _id: a.lot, reservedQuantity: { $gte: a.quantity }, remainingQuantity: { $gte: a.quantity }, $or: [{ expiryDate: null }, { expiryDate: { $gte: new Date() } }] }, { $inc: { reservedQuantity: -a.quantity, remainingQuantity: -a.quantity } }, { session });
    if (result.modifiedCount !== 1) throw new ApiError(409, 'Reserved batch expired or is unavailable. Edit or cancel this draft before Close Day.');
  }
  const total = allocations.reduce((s, a) => s + a.quantity * a.unitCostCents, 0);
  const quantity = allocations.reduce((s, a) => s + a.quantity, 0);
  return { breakdown: allocations, weightedUnitCostCents: Math.round(total / quantity), totalCostCents: total };
}
// NOTE on costing: `realizedProfitCents`/`costCents` below are a batch/lot
// traceability view (how much did THIS SPECIFIC purchase batch yield),
// deliberately still based on each lot's own original unitCostCents -- they
// are NOT the authoritative accounting Profit Report, which uses the
// Weighted Average Cost snapshot frozen on the sale line instead (see
// reportController.js / dayCloseService.js). Costing method and physical
// lot/supplier traceability are intentionally separate concerns.
export async function batchSummary(item, includeActivity = true) {
  const batches = await InventoryLot.find({ item: item._id }).populate('supplier', 'name').populate('purchase', 'purchaseNumber').sort({ createdAt: -1 }).lean();
  const tracked = batches.reduce((s, b) => s + b.remainingQuantity, 0);
  const legacy = Math.max(0, item.quantity - tracked);
  const expired = batches.reduce((s, b) => s + (b.expiryDate && new Date(b.expiryDate) < new Date() ? b.remainingQuantity : 0), 0) + (item.expiryDate && item.expiryDate < new Date() ? legacy : 0);
  const sales = includeActivity ? await Sale.find({ 'items.item': item._id, status: 'CONFIRMED' }).select('receiptNumber items totalCents subtotalCents confirmedAt').lean() : [];
  const activity = [];
  for (const sale of sales) for (const line of sale.items.filter(l => String(l.item) === String(item._id))) {
    for (const allocation of line.lotConsumption || []) {
      const batch = batches.find(b => String(b._id) === String(allocation.lot));
      const revenue = line.unitPriceCents * allocation.quantity * (sale.subtotalCents ? sale.totalCents / sale.subtotalCents : 1);
      if (batch) { batch.realizedProfitCents = (batch.realizedProfitCents || 0) + revenue - allocation.quantity * allocation.unitCostCents; }
      activity.push({ receiptNumber: sale.receiptNumber, date: sale.confirmedAt, stockSerial: allocation.stockSerial || batch?.stockSerial || '', quantity: allocation.quantity, costCents: allocation.quantity * allocation.unitCostCents });
    }
  }
  return { activity, batches, expiryStatus: expired > 0 ? 'expired' : batches.some(b => b.remainingQuantity > 0 && b.expiryDate && new Date(b.expiryDate) <= new Date(Date.now() + 30 * 86400000)) ? 'near_expiry' : 'none', expiredQuantity: expired, availableQuantity: Math.max(0, item.quantity - expired - (item.reservedQuantity || 0)), timesStocked: new Set(batches.map(b => String(b.stockEntry || b.purchase?._id || b._id))).size, totalReceived: batches.reduce((s, b) => s + b.originalQuantity, 0) + legacy };
}
