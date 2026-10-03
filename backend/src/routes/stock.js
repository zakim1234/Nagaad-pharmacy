import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { nextSequence } from '../models/Counter.js';
import { toCents } from '../utils/money.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import StockEntry from '../models/StockEntry.js';
import Supplier from '../models/Supplier.js';
import { receiveStock, escapeRegex } from '../services/stockReceiptService.js';
const router = Router();
router.use(requireAuth);
router.use(requirePermission('stock'));
router.post('/', asyncHandler(async (req, res) => {
  const { rows, externalSerialNumber = '', supplierId = null } = req.body;
  if (typeof externalSerialNumber !== 'string' || externalSerialNumber.length > 100) throw new ApiError(400, 'Shop/supplier serial number must be text of at most 100 characters.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new ApiError(400, 'Enter between 1 and 200 stock rows.');
  for (const [i, row] of rows.entries()) {
    if (!row.itemId && !String(row.name || '').trim()) throw new ApiError(400, `Row ${i + 1}: select or name an item.`);
    if (!Number.isSafeInteger(Number(row.quantity)) || Number(row.quantity) <= 0) throw new ApiError(400, `Row ${i + 1}: quantity must be a positive whole number.`);
    for (const key of ['costPrice', 'sellingPrice']) if (row[key] === '' || row[key] == null || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0) throw new ApiError(400, `Row ${i + 1}: enter a valid ${key}.`);
    if (row.expiryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(row.expiryDate) || !Number.isFinite(Date.parse(row.expiryDate)) || new Date(row.expiryDate).toISOString().slice(0, 10) !== row.expiryDate)) throw new ApiError(400, `Row ${i + 1}: expiry is invalid.`);
  }
  // categoryId is honoured only by the POS quick-create; never from this route.
  const entry = await runInTransaction(async (session) => (await receiveStock(session, { rows: rows.map(({ categoryId, ...row }) => row), externalSerialNumber, supplierId, user: req.user })).entry);
  res.status(201).json({ success: true, data: entry });
}));
router.get('/', asyncHandler(async (req, res) => {
  const q = escapeRegex(String(req.query.q || '').trim());
  const filter = q ? { $or: [{ stockSerial: { $regex: q, $options: 'i' } }, { externalSerialNumber: { $regex: q, $options: 'i' } }, { 'rows.itemName': { $regex: q, $options: 'i' } }] } : {};
  if (req.query.supplier) filter.supplier = req.query.supplier;
  const page = Math.max(1, Number(req.query.page) || 1);
  const data = await StockEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('rows.batch').populate('supplier', 'name phone email address');
  res.json({ success: true, data, total: await StockEntry.countDocuments(filter) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const data = await StockEntry.findById(req.params.id).populate('rows.batch').populate('createdBy', 'name').populate('supplier', 'name phone email address');
  if (!data) throw new ApiError(404, 'Stock entry not found.');
  res.json({ success: true, data });
}));
export default router;
