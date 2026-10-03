import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';
import Supplier from '../models/Supplier.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toDTO(doc) {
  return {
    id: doc._id,
    archiveNumber: doc.archiveNumber,
    serialNumber: doc.serialNumber,
    supplier: doc.supplier?._id || doc.supplier,
    supplierName: doc.supplierName,
    rows: doc.rows.map((r) => ({
      itemName: r.itemName,
      quantity: r.quantity,
      cost: fromCents(r.costCents),
      total: fromCents(r.totalCents),
    })),
    grandTotal: fromCents(doc.grandTotalCents),
    notes: doc.notes,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

async function generateArchiveNumber() {
  const seq = await nextSequence('supplierInvoiceArchive');
  const year = new Date().getFullYear();
  return `SINV-${year}-${String(seq).padStart(6, '0')}`;
}

// POST /api/supplier-invoice-archives -- saves the supplier's paper invoice
// exactly as entered, as ONE archive record. This is intentionally the
// entire operation: no Stock, no InventoryItem, no Account is ever touched
// here. It is a pure reference/archive document.
export const createArchive = asyncHandler(async (req, res) => {
  const { serialNumber, supplierId, rows, notes = '' } = req.body;
  if (typeof serialNumber !== 'string' || !serialNumber.trim()) throw new ApiError(400, 'Shop/Supplier serial number is required.');
  if (serialNumber.length > 100) throw new ApiError(400, 'Serial number is too long.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new ApiError(400, 'Enter between 1 and 500 rows.');

  // Backend-enforced uniqueness (frontend validation alone is never
  // sufficient) -- checked up front for a clear message, with the schema's
  // own unique index (see the model) as the race-condition backstop.
  const trimmedSerial = serialNumber.trim();
  const existing = await SupplierInvoiceArchive.findOne({ serialNumber: trimmedSerial });
  if (existing) throw new ApiError(409, `An archive with serial number "${trimmedSerial}" already exists (${existing.archiveNumber}).`);

  let supplier = null;
  if (supplierId) {
    supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');
  }

  let grandTotalCents = 0;
  const builtRows = rows.map((row, i) => {
    const itemName = String(row.itemName || '').trim();
    if (!itemName) throw new ApiError(400, `Row ${i + 1}: item name is required.`);
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ApiError(400, `Row ${i + 1}: quantity must be a positive number.`);
    if (row.cost === '' || row.cost == null || !Number.isFinite(Number(row.cost)) || Number(row.cost) < 0) {
      throw new ApiError(400, `Row ${i + 1}: enter a valid cost.`);
    }
    const costCents = toCents(row.cost);
    const totalCents = Math.round(quantity * costCents);
    grandTotalCents += totalCents;
    return { itemName, quantity, costCents, totalCents };
  });

  const archiveNumber = await generateArchiveNumber();
  let archive;
  try {
    archive = await SupplierInvoiceArchive.create({
      archiveNumber,
      serialNumber: trimmedSerial,
      supplier: supplier?._id || null,
      supplierName: supplier?.name || '',
      rows: builtRows,
      grandTotalCents,
      notes: notes || '',
      createdBy: req.user?._id,
    });
  } catch (err) {
    // Race-condition backstop: two concurrent saves for the same serial can
    // both pass the pre-check above -- the schema's unique index (once
    // built, see runMigrateSupplierArchive.js) catches that case here.
    if (err?.code === 11000) throw new ApiError(409, `An archive with serial number "${trimmedSerial}" already exists.`);
    throw err;
  }

  res.status(201).json({ success: true, data: toDTO(archive) });
});

// GET /api/supplier-invoice-archives?q=...&serial=...&supplier=... -- with
// no filter at all, returns every archive (paginated, newest first) so the
// default page can behave like a file browser. `q` is a general live-search
// box matching either the Shop/Supplier Serial Number or the supplier name
// (never today's Inventory prices); `serial`/`supplier` (id) remain as
// narrower filters for backward compatibility with existing call sites.
export const searchArchives = asyncHandler(async (req, res) => {
  const filter = {};
  const q = String(req.query.q || '').trim();
  const serial = String(req.query.serial || '').trim();
  if (q) {
    const escaped = escapeRegex(q);
    filter.$or = [{ serialNumber: { $regex: escaped, $options: 'i' } }, { supplierName: { $regex: escaped, $options: 'i' } }];
  } else if (serial) {
    filter.serialNumber = { $regex: escapeRegex(serial), $options: 'i' };
  }
  if (req.query.supplier) filter.supplier = req.query.supplier;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const [rows, total] = await Promise.all([
    SupplierInvoiceArchive.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SupplierInvoiceArchive.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows.map(toDTO), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getArchive = asyncHandler(async (req, res) => {
  const archive = await SupplierInvoiceArchive.findById(req.params.id);
  if (!archive) throw new ApiError(404, 'Supplier invoice archive not found.');
  res.json({ success: true, data: toDTO(archive) });
});
