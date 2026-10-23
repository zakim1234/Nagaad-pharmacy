import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';
import Purchase from '../models/Purchase.js';
import { ApiError } from '../utils/ApiError.js';

// A supplier's invoice number is unique per supplier: the same number can be
// saved for Cali and for Cumar, but never twice for the same supplier --
// neither as a Manual Entry archive nor as a purchase invoice. A Manual Entry
// archive and the purchase it created are the same invoice, so they never
// count against each other (`exceptArchive` / `exceptPurchase`).
export async function assertInvoiceNumberFree({ supplierId = null, number, supplierName = '', exceptArchive = null, exceptPurchase = null, session = null }) {
  const serial = String(number || '').trim();
  if (!serial) return;
  const supplier = supplierId || null;
  const who = supplierName ? ` for ${supplierName}` : supplier ? '' : ' without a supplier';

  const archive = await SupplierInvoiceArchive.findOne({
    serialNumber: serial,
    supplier,
    ...(exceptArchive ? { _id: { $ne: exceptArchive } } : {}),
  }).session(session);
  if (archive) throw new ApiError(409, `Invoice number "${serial}" is already saved${who} (${archive.archiveNumber}).`);

  if (!supplier) return;
  const purchase = await Purchase.findOne({
    supplier,
    supplierInvoiceNumber: serial,
    status: { $ne: 'voided' },
    ...(exceptPurchase ? { _id: { $ne: exceptPurchase } } : {}),
  }).session(session);
  if (purchase) throw new ApiError(409, `Invoice number "${serial}" is already saved${who} (${purchase.purchaseNumber}).`);
}
