import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';
import Supplier from '../models/Supplier.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { runInTransaction } from '../utils/transaction.js';
import Purchase from '../models/Purchase.js';
import { syncArchivePurchase, removePurchase } from '../services/archivePurchaseService.js';
import { assertInvoiceNumberFree } from '../services/invoiceNumberService.js';

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
    purchase: doc.purchase?._id || doc.purchase || null,
    purchaseNumber: doc.purchaseNumber || doc.purchase?.purchaseNumber || null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
  };
}

async function generateArchiveNumber() {
  const seq = await nextSequence('supplierInvoiceArchive');
  const year = new Date().getFullYear();
  return `SINV-${year}-${String(seq).padStart(6, '0')}`;
}

// Validates the fields shared by create and edit and builds the stored
// rows/total. `excludeId` lets an edit keep its own serial number.
async function buildArchiveFields(body, excludeId = null) {
  const { serialNumber, supplierId, rows, notes = '' } = body;
  if (typeof serialNumber !== 'string' || !serialNumber.trim()) throw new ApiError(400, 'Shop/Supplier serial number is required.');
  if (serialNumber.length > 100) throw new ApiError(400, 'Serial number is too long.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new ApiError(400, 'Enter between 1 and 500 rows.');
  if (String(notes || '').length > 2000) throw new ApiError(400, 'Notes are too long (2000 characters max).');

  // Backend-enforced uniqueness (frontend validation alone is never
  // sufficient) -- checked up front for a clear message, with the schema's
  // own unique index (see the model) as the race-condition backstop.
  const trimmedSerial = serialNumber.trim();
  let supplier = null;
  if (supplierId) {
    supplier = await Supplier.findById(supplierId);
    if (!supplier) throw new ApiError(404, 'Selected supplier no longer exists.');
  }
  // Unique per supplier: 1155 can belong to Cali and to Cumar, never twice to one.
  const current = excludeId ? await SupplierInvoiceArchive.findById(excludeId).select('purchase') : null;
  await assertInvoiceNumberFree({ supplierId: supplier?._id, number: trimmedSerial, supplierName: supplier?.name, exceptArchive: excludeId, exceptPurchase: current?.purchase });

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

  return {
    serialNumber: trimmedSerial,
    supplier: supplier?._id || null,
    supplierName: supplier?.name || '',
    rows: builtRows,
    grandTotalCents,
    notes: String(notes || ''),
  };
}

// POST /api/supplier-invoice-archives -- saves the supplier's paper invoice
// exactly as entered, as ONE archive record. This is intentionally the
// entire operation: no Stock, no InventoryItem, no Account is ever touched
// here. It is a pure reference/archive document.
export const createArchive = asyncHandler(async (req, res) => {
  const fields = await buildArchiveFields(req.body);
  const archiveNumber = await generateArchiveNumber();
  let archive;
  try {
    // With a supplier, the same save also records the purchase invoice
    // (their serial number, the grand total owed) -- no second entry.
    archive = await runInTransaction(async (session) => {
      const [doc] = await SupplierInvoiceArchive.create([{ archiveNumber, ...fields, createdBy: req.user?._id }], { session });
      const purchase = await syncArchivePurchase(session, doc, { user: req.user });
      await doc.save({ session });
      doc.purchaseNumber = purchase?.purchaseNumber || null;
      return doc;
    });
  } catch (err) {
    // Race-condition backstop: two concurrent saves for the same serial can
    // both pass the pre-check above -- the schema's unique index (once
    // built, see runMigrateSupplierArchive.js) catches that case here.
    if (err?.code === 11000) throw new ApiError(409, `Invoice number "${fields.serialNumber}" is already saved${fields.supplierName ? ` for ${fields.supplierName}` : ''}.`);
    throw err;
  }

  res.status(201).json({ success: true, data: toDTO(archive) });
});

// PUT /api/supplier-invoice-archives/:id -- corrects an archived invoice
// (serial, supplier, rows, notes). Like create, it touches nothing but this
// archive record, so editing it can never change Stock or Accounts.
export const updateArchive = asyncHandler(async (req, res) => {
  const archive = await SupplierInvoiceArchive.findById(req.params.id);
  if (!archive) throw new ApiError(404, 'Supplier invoice archive not found.');
  const fields = await buildArchiveFields(req.body, archive._id);
  try {
    await runInTransaction(async (session) => {
      const doc = await SupplierInvoiceArchive.findById(archive._id).session(session);
      Object.assign(doc, fields);
      const purchase = await syncArchivePurchase(session, doc, { user: req.user });
      await doc.save({ session });
      Object.assign(archive, fields, { purchase: doc.purchase, purchaseNumber: purchase?.purchaseNumber || null });
    });
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, `Invoice number "${fields.serialNumber}" is already saved${fields.supplierName ? ` for ${fields.supplierName}` : ''}.`);
    throw err;
  }
  await logAudit({
    user: req.user,
    action: 'supplierInvoiceArchive.update',
    entityType: 'SupplierInvoiceArchive',
    entityId: archive._id,
    details: { archiveNumber: archive.archiveNumber, serialNumber: archive.serialNumber },
  });
  res.json({ success: true, data: toDTO(archive) });
});

// DELETE /api/supplier-invoice-archives/:id -- removes an archived invoice.
// It is a reference copy only (nothing else points at it), so it is deleted
// outright; the audit log keeps a record of what was removed.
export const deleteArchive = asyncHandler(async (req, res) => {
  const archive = await SupplierInvoiceArchive.findById(req.params.id);
  if (!archive) throw new ApiError(404, 'Supplier invoice archive not found.');
  // Its purchase invoice goes too (any payment on it is cancelled and the
  // money returned to the account).
  let refundedCents = 0;
  await runInTransaction(async (session) => {
    const purchase = archive.purchase ? await Purchase.findById(archive.purchase).session(session) : null;
    if (purchase) refundedCents = await removePurchase(session, purchase, { user: req.user, reason: `supplier invoice ${archive.archiveNumber} deleted` });
    await SupplierInvoiceArchive.deleteOne({ _id: archive._id }, { session });
  });
  await logAudit({
    user: req.user,
    action: 'supplierInvoiceArchive.delete',
    entityType: 'SupplierInvoiceArchive',
    entityId: archive._id,
    details: { archiveNumber: archive.archiveNumber, serialNumber: archive.serialNumber, supplierName: archive.supplierName, grandTotal: fromCents(archive.grandTotalCents) },
  });
  res.json({ success: true, data: { id: archive._id, refunded: fromCents(refundedCents) } });
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
    SupplierInvoiceArchive.find(filter).populate('purchase', 'purchaseNumber').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SupplierInvoiceArchive.countDocuments(filter),
  ]);
  res.json({ success: true, data: rows.map(toDTO), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getArchive = asyncHandler(async (req, res) => {
  const archive = await SupplierInvoiceArchive.findById(req.params.id);
  if (!archive) throw new ApiError(404, 'Supplier invoice archive not found.');
  res.json({ success: true, data: toDTO(archive) });
});

// POST /api/supplier-invoice-archives/:id/to-purchase -- for an archive saved
// before archives were added to Purchase Invoices automatically: records
// its purchase invoice (serial number, grand total owed) now, once.
export const sendArchiveToPurchases = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async (session) => {
    const doc = await SupplierInvoiceArchive.findById(req.params.id).session(session);
    if (!doc) throw new ApiError(404, 'Supplier invoice archive not found.');
    if (!doc.supplier) throw new ApiError(400, 'Choose the supplier on this invoice first (Edit), then add it to Purchase Invoices.');
    if (doc.purchase && (await Purchase.exists({ _id: doc.purchase }).session(session))) throw new ApiError(409, 'This invoice is already in Purchase Invoices.');
    doc.purchase = null;
    const purchase = await syncArchivePurchase(session, doc, { user: req.user });
    await doc.save({ session });
    doc.purchaseNumber = purchase?.purchaseNumber || null;
    return doc;
  });
  await logAudit({ user: req.user, action: 'supplierInvoiceArchive.toPurchase', entityType: 'SupplierInvoiceArchive', entityId: result._id, details: { archiveNumber: result.archiveNumber, purchaseNumber: result.purchaseNumber } });
  res.json({ success: true, data: toDTO(result) });
});
