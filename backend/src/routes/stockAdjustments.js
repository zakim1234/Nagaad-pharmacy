import { Router } from 'express';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { fromCents } from '../utils/money.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import StockAdjustment from '../models/StockAdjustment.js';
import { createStockAdjustment } from '../services/stockAdjustmentService.js';
import { escapeRegex } from '../services/stockReceiptService.js';
import { logAudit } from '../services/auditService.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('stock'));

function toDTO(a) {
  return {
    id: a._id,
    adjustmentNumber: a.adjustmentNumber,
    item: a.item,
    itemName: a.itemName,
    itemCode: a.itemCode,
    unit: a.unit,
    direction: a.direction,
    quantity: a.quantity,
    reason: a.reason,
    note: a.note,
    quantityBefore: a.quantityBefore,
    quantityAfter: a.quantityAfter,
    unitCost: fromCents(a.unitCostCents),
    value: fromCents(a.valueCents),
    lots: a.lots.map((l) => ({ lot: l.lot, stockSerial: l.stockSerial, expiryDate: l.expiryDate, quantity: l.quantity })),
    createdByName: a.createdByName,
    createdAt: a.createdAt,
  };
}

// GET /api/stock-adjustments?q=&direction=&reason=&from=&to=&page=
router.get('/', asyncHandler(async (req, res) => {
  const filter = {};
  const q = escapeRegex(String(req.query.q || '').trim());
  if (q) filter.$or = [{ itemName: { $regex: q, $options: 'i' } }, { itemCode: { $regex: q, $options: 'i' } }, { adjustmentNumber: { $regex: q, $options: 'i' } }];
  if (['DECREASE', 'INCREASE'].includes(req.query.direction)) filter.direction = req.query.direction;
  if (req.query.reason) filter.reason = String(req.query.reason);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00`);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999`);
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 50;
  const [items, total, sums] = await Promise.all([
    StockAdjustment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    StockAdjustment.countDocuments(filter),
    StockAdjustment.aggregate([{ $match: filter }, { $group: { _id: '$direction', cents: { $sum: '$valueCents' }, count: { $sum: 1 } } }]),
  ]);
  const sum = (dir) => sums.find((s) => s._id === dir) || { cents: 0, count: 0 };
  res.json({
    success: true,
    data: items.map(toDTO),
    summary: {
      decreaseValue: fromCents(sum('DECREASE').cents),
      decreaseCount: sum('DECREASE').count,
      increaseValue: fromCents(sum('INCREASE').cents),
      increaseCount: sum('INCREASE').count,
      netLoss: fromCents(sum('DECREASE').cents - sum('INCREASE').cents),
    },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

// GET /api/stock-adjustments/item/:id -- the item and its batches that still
// hold stock, for choosing which batch a decrease is taken from.
router.get('/item/:id', asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Product not found.');
  const lots = await InventoryLot.find({ item: item._id, remainingQuantity: { $gt: 0 } }).sort({ expiryDate: 1, createdAt: 1 });
  const tracked = lots.reduce((s, l) => s + l.remainingQuantity, 0);
  res.json({
    success: true,
    data: {
      item: {
        id: item._id,
        name: item.name,
        itemCode: item.itemCode,
        unit: item.unit,
        quantity: item.quantity,
        reservedQuantity: item.reservedQuantity || 0,
        unitCost: fromCents(item.costPriceCents),
      },
      lots: lots.map((l) => ({
        id: l._id,
        stockSerial: l.stockSerial || (l.isLegacy ? 'Opening stock' : ''),
        expiryDate: l.expiryDate,
        remaining: l.remainingQuantity,
        reserved: l.reservedQuantity || 0,
        expired: !!(l.expiryDate && l.expiryDate < new Date()),
      })),
      // Stock from before batch tracking that no batch covers yet.
      untrackedQuantity: Math.max(0, item.quantity - tracked),
    },
  });
}));

// POST /api/stock-adjustments -- admin/manager only: it changes stock value.
router.post('/', requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
  const { itemId, direction, quantity, reason, note, lotId, expiryDate } = req.body;
  if (!itemId) throw new ApiError(400, 'Select an item to adjust.');
  const adjustment = await runInTransaction((session) =>
    createStockAdjustment(session, { itemId, direction, quantity, reason, note, lotId, expiryDate, user: req.user })
  );
  await logAudit({
    user: req.user,
    action: 'stock.adjust',
    entityType: 'InventoryItem',
    entityId: adjustment.item,
    details: { adjustmentNumber: adjustment.adjustmentNumber, direction, quantity: adjustment.quantity, reason },
  });
  res.status(201).json({ success: true, data: toDTO(adjustment) });
}));

export default router;
