import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import Sale from '../models/Sale.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';

function toDTO(s) {
  return {
    id: s._id,
    name: s.name,
    phone: s.phone,
    email: s.email,
    address: s.address,
    notes: s.notes,
    totalSpent: fromCents(s.totalSpentCents),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const listSuppliers = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const filter = {};
  if (search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { phone: { $regex: search.trim(), $options: 'i' } },
    ];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Supplier.find(filter)
      .sort({ name: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Supplier.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

export const searchSuppliers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const filter = q ? { name: { $regex: q, $options: 'i' } } : {};
  const suppliers = await Supplier.find(filter).sort({ name: 1 }).limit(10);
  res.json({ success: true, data: suppliers.map(toDTO) });
});

export const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');
  res.json({ success: true, data: toDTO(supplier) });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const { name, phone = '', email = '', address = '', notes = '' } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Supplier name is required.');

  const supplier = await Supplier.create({ name: name.trim(), phone, email, address, notes });

  await logAudit({
    user: req.user,
    action: 'supplier.create',
    entityType: 'Supplier',
    entityId: supplier._id,
    details: { name: supplier.name },
  });

  res.status(201).json({ success: true, data: toDTO(supplier) });
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  const { name, phone, email, address, notes } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Supplier name cannot be empty.');
    supplier.name = name.trim();
  }
  if (phone !== undefined) supplier.phone = phone;
  if (email !== undefined) supplier.email = email;
  if (address !== undefined) supplier.address = address;
  if (notes !== undefined) supplier.notes = notes;

  await supplier.save();

  await logAudit({
    user: req.user,
    action: 'supplier.update',
    entityType: 'Supplier',
    entityId: supplier._id,
    details: req.body,
  });

  res.json({ success: true, data: toDTO(supplier) });
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  const purchaseCount = await Purchase.countDocuments({ supplier: supplier._id });
  const itemCount = await InventoryItem.countDocuments({ supplier: supplier._id });
  if (purchaseCount > 0 || itemCount > 0) {
    throw new ApiError(
      409,
      'This supplier has purchases or inventory items linked to it and cannot be deleted.'
    );
  }

  await supplier.deleteOne();

  await logAudit({
    user: req.user,
    action: 'supplier.delete',
    entityType: 'Supplier',
    entityId: supplier._id,
    details: { name: supplier.name },
  });

  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/suppliers/:id/history
export const getSupplierHistory = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  const purchases = await Purchase.find({ supplier: supplier._id }).sort({ createdAt: -1 });

  res.json({
    success: true,
    data: {
      supplier: toDTO(supplier),
      purchases: purchases.map((p) => ({
        id: p._id,
        purchaseNumber: p.purchaseNumber,
        status: p.status,
        items: p.items.map((i) => ({
          name: i.itemName,
          quantity: i.quantity,
          unitCost: fromCents(i.unitCostCents),
          subtotal: fromCents(i.subtotalCents),
        })),
        totalCost: fromCents(p.totalCostCents),
        paidAmount: fromCents(p.paidAmountCents),
        balance: fromCents(p.balanceCents),
        purchaseDate: p.purchaseDate,
        createdAt: p.createdAt,
      })),
    },
  });
});

// GET /api/suppliers/:id/analysis -- one-click purchased/sold/remaining/profit
// breakdown per item, computed from actual FIFO lot consumption so unsold
// stock is never mistaken for a loss.
export const getSupplierAnalysis = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');
  const supplierId = supplier._id;

  const [purchasedAgg, soldAgg, purchaseCount] = await Promise.all([
    InventoryLot.aggregate([
      { $match: { supplier: supplierId } },
      {
        $group: {
          _id: '$item',
          purchasedQty: { $sum: '$originalQuantity' },
          remainingQty: { $sum: '$remainingQuantity' },
          purchaseCostCents: { $sum: { $multiply: ['$originalQuantity', '$unitCostCents'] } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { status: 'completed' } },
      { $unwind: '$items' },
      { $unwind: '$items.lotConsumption' },
      { $match: { 'items.lotConsumption.supplier': supplierId } },
      {
        $group: {
          _id: '$items.item',
          quantitySold: { $sum: '$items.lotConsumption.quantity' },
          cogsCents: { $sum: { $multiply: ['$items.lotConsumption.quantity', '$items.lotConsumption.unitCostCents'] } },
          revenueCents: { $sum: { $multiply: ['$items.lotConsumption.quantity', '$items.unitPriceCents'] } },
        },
      },
    ]),
    Purchase.countDocuments({ supplier: supplierId }),
  ]);

  const purchasedByItem = new Map(purchasedAgg.map((p) => [String(p._id), p]));
  const soldByItem = new Map(soldAgg.map((s) => [String(s._id), s]));
  const itemIds = new Set([...purchasedByItem.keys(), ...soldByItem.keys()]);

  const items = await InventoryItem.find({ _id: { $in: [...itemIds] } }).select('name sku quantity sellingPriceCents');
  const itemInfo = new Map(items.map((i) => [String(i._id), i]));

  const itemRows = [...itemIds].map((id) => {
    const p = purchasedByItem.get(id) || { purchasedQty: 0, remainingQty: 0, purchaseCostCents: 0 };
    const s = soldByItem.get(id) || { quantitySold: 0, cogsCents: 0, revenueCents: 0 };
    const info = itemInfo.get(id);
    const profitCents = s.revenueCents - s.cogsCents;
    const avgUnitCostCents = p.purchasedQty > 0 ? p.purchaseCostCents / p.purchasedQty : 0;
    return {
      itemId: id,
      name: info?.name || 'Unknown item',
      sku: info?.sku || '',
      purchasedQty: p.purchasedQty,
      soldQty: s.quantitySold,
      remainingQty: p.remainingQty,
      purchaseCost: fromCents(p.purchaseCostCents),
      revenue: fromCents(s.revenueCents),
      cogs: fromCents(s.cogsCents),
      profit: fromCents(profitCents),
      marginPct: s.revenueCents > 0 ? Math.round((profitCents / s.revenueCents) * 1000) / 10 : 0,
      remainingStockValue: fromCents(Math.round(p.remainingQty * avgUnitCostCents)),
    };
  });

  itemRows.sort((a, b) => b.profit - a.profit);

  const totals = itemRows.reduce(
    (acc, r) => ({
      purchaseCost: acc.purchaseCost + r.purchaseCost,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
      purchasedQty: acc.purchasedQty + r.purchasedQty,
      soldQty: acc.soldQty + r.soldQty,
      remainingQty: acc.remainingQty + r.remainingQty,
      remainingStockValue: acc.remainingStockValue + r.remainingStockValue,
    }),
    { purchaseCost: 0, revenue: 0, cogs: 0, profit: 0, purchasedQty: 0, soldQty: 0, remainingQty: 0, remainingStockValue: 0 }
  );

  const bestItem = itemRows[0] || null;
  const worstItem = itemRows.length > 1 ? itemRows[itemRows.length - 1] : null;
  const overallMarginPct = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 1000) / 10 : 0;

  const insights = [];
  if (bestItem && bestItem.profit > 0) {
    insights.push(`${bestItem.name} generated $${bestItem.profit.toFixed(2)} gross profit, the most of any item from this supplier.`);
  }
  if (totals.purchasedQty > 0) {
    const unsoldPct = Math.round((totals.remainingQty / totals.purchasedQty) * 1000) / 10;
    insights.push(`${unsoldPct}% of units purchased from ${supplier.name} are still unsold (${totals.remainingQty} of ${totals.purchasedQty} units).`);
  }
  if (totals.revenue > 0) {
    insights.push(`Sold inventory from ${supplier.name} has generated a ${overallMarginPct}% gross margin.`);
  }
  if (worstItem && worstItem.soldQty > 0 && worstItem.profit < bestItem?.profit) {
    insights.push(`${worstItem.name} is the lowest-performing item from this supplier, with $${worstItem.profit.toFixed(2)} gross profit.`);
  }

  res.json({
    success: true,
    data: {
      supplier: toDTO(supplier),
      purchaseCount,
      itemCount: itemRows.length,
      totals,
      overallMarginPct,
      bestItem,
      worstItem,
      items: itemRows,
      insights,
    },
  });
});

export { toDTO as supplierToDTO };
