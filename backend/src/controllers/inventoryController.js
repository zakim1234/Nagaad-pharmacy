import InventoryLot from '../models/InventoryLot.js';
import { batchSummary } from '../services/batchService.js';
import InventoryItem from '../models/InventoryItem.js';
import Category from '../models/Category.js';
import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';

function toDTO(item) {
  const obj = item.toObject ? item.toObject({ virtuals: true }) : item;
  const category =
    obj.category && typeof obj.category === 'object' && obj.category.name
      ? { id: obj.category._id, name: obj.category.name }
      : obj.category
      ? { id: obj.category, name: null }
      : null;

  return {
    id: obj._id,
    itemCode: obj.itemCode,
    name: obj.name,
    serialNumber: obj.serialNumber || '',
    genericName: obj.genericName || '',
    manufacturer: obj.manufacturer || '',
    batchNumber: obj.batchNumber || '',
    barcode: obj.barcode || '',
    category,
    quantity: obj.quantity,
    reservedQuantity: obj.reservedQuantity || 0,
    availableQuantity: obj.availableQuantity,
    unit: obj.unit,
    costPrice: fromCents(obj.costPriceCents),
    sellingPrice: fromCents(obj.sellingPriceCents),
    lowStockThreshold: obj.lowStockThreshold,
    expiryDate: obj.expiryDate,
    supplier: obj.supplier,
    status: obj.status,
    stockStatus: obj.stockStatus,
    expiryStatus: obj.expiryStatus,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    stockEvents: obj.stockEvents || [],
  };
}

const NEAR_EXPIRY_DAYS = 30;

async function generateItemCode() {
  const seq = await nextSequence('itemCode');
  return `ITM-${String(seq).padStart(6, '0')}`;
}

async function buildFilter(query) {
  const { search, category, supplier, stockFilter, expiryFilter } = query;
  const filter = {};

  if (search && search.trim()) {
    filter.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { itemCode: { $regex: search.trim(), $options: 'i' } },
      { serialNumber: { $regex: search.trim(), $options: 'i' } },
      { barcode: { $regex: search.trim(), $options: 'i' } },
      { genericName: { $regex: search.trim(), $options: 'i' } },
    ];
  }
  if (category) filter.category = category;
  if (supplier) filter.supplier = supplier;

  if (stockFilter === 'low_stock') {
    filter.$expr = { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] };
  } else if (stockFilter === 'out_of_stock') {
    filter.quantity = { $lte: 0 };
  } else if (stockFilter === 'in_stock') {
    filter.$expr = { $gt: ['$quantity', '$lowStockThreshold'] };
  }

  if (expiryFilter === 'expired' || expiryFilter === 'near_expiry') {
    const dateFilter = expiryFilter === 'expired' ? { $ne: null, $lt: new Date() } : { $ne: null, $gte: new Date(), $lte: new Date(Date.now() + NEAR_EXPIRY_DAYS * 86400000) };
    const ids = await InventoryLot.distinct('item', { remainingQuantity: { $gt: 0 }, expiryDate: dateFilter });
    filter.$and = [{ $or: [{ _id: { $in: ids } }, { expiryDate: dateFilter }] }];
  }

  return filter;
}

// GET /api/inventory
export const listInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc' } = req.query;
  const filter = await buildFilter(req.query);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
  const sort = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    InventoryItem.find(filter)
      .populate('supplier', 'name')
      .populate('category', 'name')
      .sort(sort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    InventoryItem.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: await Promise.all(items.map(async item => ({ ...toDTO(item), ...await batchSummary(item, false) }))),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/inventory/search?q= -- used by the Seller/POS row item picker and
// by inventory serial-number search
export const searchInventory = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const items = await InventoryItem.find({
    status: 'active',
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { itemCode: { $regex: q, $options: 'i' } },
      { serialNumber: { $regex: q, $options: 'i' } },
      { barcode: { $regex: q, $options: 'i' } },
      { genericName: { $regex: q, $options: 'i' } },
    ],
  })
    .populate('category', 'name')
    .limit(15)
    .sort({ name: 1 });

  res.json({ success: true, data: await Promise.all(items.map(async item => ({ ...toDTO(item), ...await batchSummary(item, false) }))) });
});

export const getInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id).populate('supplier', 'name phone').populate('category', 'name');
  if (!item) throw new ApiError(404, 'Item not found.');

  const purchaseLines = await Purchase.aggregate([
    { $match: { status: 'completed', 'items.item': item._id } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    {
      $project: {
        purchaseNumber: 1,
        supplierName: 1,
        purchaseDate: 1,
        createdAt: 1,
        quantity: '$items.quantity',
        unitCostCents: '$items.unitCostCents',
        subtotalCents: '$items.subtotalCents',
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 25 },
  ]);

  res.json({
    success: true,
    data: {
      ...toDTO(item),
      ...await batchSummary(item),
      purchaseHistory: purchaseLines.map((p) => ({
        purchaseNumber: p.purchaseNumber,
        supplierName: p.supplierName,
        quantity: p.quantity,
        unitCost: fromCents(p.unitCostCents),
        total: fromCents(p.subtotalCents),
        date: p.purchaseDate || p.createdAt,
      })),
    },
  });
});

async function assertCategoryExists(categoryId) {
  if (!categoryId) return null;
  const category = await Category.findById(categoryId);
  if (!category) throw new ApiError(400, 'Selected category does not exist.');
  return category._id;
}

async function assertSerialNumberAvailable(serialNumber, excludeId) {
  if (!serialNumber) return;
  const filter = { serialNumber };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await InventoryItem.findOne(filter);
  if (existing) throw new ApiError(409, `Serial number "${serialNumber}" is already assigned to another item.`);
}

async function assertBarcodeAvailable(barcode, excludeId = null) {
  if (!barcode) return;
  const filter = { barcode };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await InventoryItem.findOne(filter);
  if (existing) throw new ApiError(409, `Barcode "${barcode}" is already assigned to another item.`);
}

function parseMinimumStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new ApiError(400, 'Minimum stock must be a whole number of 0 or more.');
  return n;
}

export const createInventoryItem = asyncHandler(async (req, res) => {
  const body = req.body;
  if (Number(body.quantity || 0) !== 0) throw new ApiError(400, 'Add physical goods through Stock.');
  if (!body.name || !body.name.trim()) throw new ApiError(400, 'Item name is required.');
  if (body.costPrice === undefined || body.sellingPrice === undefined) {
    throw new ApiError(400, 'Cost price and selling price are required.');
  }
  if (Number(body.costPrice) < 0 || Number(body.sellingPrice) < 0) {
    throw new ApiError(400, 'Prices cannot be negative.');
  }
  if (body.quantity !== undefined && Number(body.quantity) < 0) {
    throw new ApiError(400, 'Quantity cannot be negative.');
  }

  const serialNumber = body.serialNumber?.trim() || '';
  await assertSerialNumberAvailable(serialNumber);
  const barcode = String(body.barcode || '').trim();
  await assertBarcodeAvailable(barcode);
  const minimumStock = body.lowStockThreshold === undefined || body.lowStockThreshold === '' ? undefined : parseMinimumStock(body.lowStockThreshold);
  const categoryId = await assertCategoryExists(body.category || null);
  const itemCode = await generateItemCode();

  const item = await InventoryItem.create({
    itemCode,
    name: body.name.trim(),
    serialNumber,
    genericName: String(body.genericName || '').trim(),
    manufacturer: String(body.manufacturer || '').trim(),
    batchNumber: String(body.batchNumber || '').trim(),
    barcode,
    ...(minimumStock !== undefined ? { lowStockThreshold: minimumStock } : {}),
    category: categoryId,
    quantity: Number(body.quantity) || 0,
    unit: body.unit || 'pcs',
    costPriceCents: toCents(body.costPrice),
    sellingPriceCents: toCents(body.sellingPrice),
    expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
    supplier: body.supplier || null,
    status: body.status || 'active',
  });

  await item.populate('category', 'name');
  await item.populate('supplier', 'name');

  await logAudit({
    user: req.user,
    action: 'inventory.create',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name, itemCode: item.itemCode },
  });

  res.status(201).json({ success: true, data: toDTO(item) });
});

export const updateInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found.');

  const body = req.body;
  if (body.name !== undefined) {
    if (!body.name.trim()) throw new ApiError(400, 'Item name cannot be empty.');
    item.name = body.name.trim();
  }
  if (body.serialNumber !== undefined) {
    const serialNumber = body.serialNumber.trim();
    await assertSerialNumberAvailable(serialNumber, item._id);
    item.serialNumber = serialNumber;
  }
  if (body.genericName !== undefined) item.genericName = String(body.genericName || '').trim();
  if (body.manufacturer !== undefined) item.manufacturer = String(body.manufacturer || '').trim();
  if (body.batchNumber !== undefined) item.batchNumber = String(body.batchNumber || '').trim();
  if (body.barcode !== undefined) {
    const barcode = String(body.barcode || '').trim();
    await assertBarcodeAvailable(barcode, item._id);
    item.barcode = barcode;
  }
  if (body.lowStockThreshold !== undefined && body.lowStockThreshold !== '') item.lowStockThreshold = parseMinimumStock(body.lowStockThreshold);
  if (body.category !== undefined) {
    item.category = await assertCategoryExists(body.category || null);
  }
  if (body.quantity !== undefined) {
    if (Number(body.quantity) < 0) throw new ApiError(400, 'Quantity cannot be negative.');
    if (Number(body.quantity) !== item.quantity) throw new ApiError(400, 'Change stock through Stock entries.');
  }
  if (body.unit !== undefined) item.unit = body.unit;
  if (body.costPrice !== undefined) {
    if (Number(body.costPrice) < 0) throw new ApiError(400, 'Cost price cannot be negative.');
    item.costPriceCents = toCents(body.costPrice);
  }
  if (body.sellingPrice !== undefined) {
    if (Number(body.sellingPrice) < 0) throw new ApiError(400, 'Selling price cannot be negative.');
    item.sellingPriceCents = toCents(body.sellingPrice);
  }
  if (body.expiryDate !== undefined) item.expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;
  if (body.supplier !== undefined) item.supplier = body.supplier || null;
  if (body.status !== undefined) item.status = body.status;

  await item.save();
  await item.populate('category', 'name');
  await item.populate('supplier', 'name');

  await logAudit({
    user: req.user,
    action: 'inventory.update',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: req.body,
  });

  res.json({ success: true, data: toDTO(item) });
});

export const deleteInventoryItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Item not found.');

  const saleCount = await Sale.countDocuments({ 'items.item': item._id, status: 'CONFIRMED' });
  if (saleCount > 0 || await InventoryLot.exists({ item: item._id }) || await Sale.exists({ 'items.item': item._id })) {
    throw new ApiError(
      409,
      'This item has sales history and cannot be deleted. Consider marking it inactive instead.'
    );
  }

  await item.deleteOne();

  await logAudit({
    user: req.user,
    action: 'inventory.delete',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name },
  });

  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/inventory/alerts/summary -- used by dashboard
export const getAlertsSummary = asyncHandler(async (req, res) => {
  const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const expiredIds = await InventoryLot.distinct('item', { remainingQuantity: { $gt: 0 }, expiryDate: { $ne: null, $lt: new Date() } });
  const nearIds = await InventoryLot.distinct('item', { remainingQuantity: { $gt: 0 }, expiryDate: { $ne: null, $gte: new Date(), $lte: cutoff } });
  const [lowStock, outOfStock, expired, nearExpiry] = await Promise.all([
    InventoryItem.find({ $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] } })
      .populate('category', 'name')
      .limit(50)
      .sort({ quantity: 1 }),
    InventoryItem.countDocuments({ quantity: { $lte: 0 } }),
    InventoryItem.find({ $or: [{ _id: { $in: expiredIds } }, { expiryDate: { $ne: null, $lt: new Date() } }] }).populate('category', 'name').limit(50),
    InventoryItem.find({ $or: [{ _id: { $in: nearIds } }, { expiryDate: { $ne: null, $gte: new Date(), $lte: cutoff } }] }).populate('category', 'name').limit(50),
  ]);

  res.json({
    success: true,
    data: {
      lowStock: lowStock.map(toDTO),
      outOfStockCount: outOfStock,
      expired: expired.map(toDTO),
      nearExpiry: nearExpiry.map(toDTO),
    },
  });
});

export { toDTO as inventoryToDTO };
