import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import InventoryItem from '../models/InventoryItem.js';
import { ApiError } from '../utils/ApiError.js';
import { toCents, fromCents } from '../utils/money.js';

export const quotationStatuses = ['Pending', 'Accepted', 'Rejected', 'Expired', 'Converted'];
export function effectiveStatus(quotation, now = new Date()) {
  return ['Pending', 'Accepted'].includes(quotation.status) && quotation.expiryDate < now ? 'Expired' : quotation.status;
}
export function money(value, label) {
  if (value === '' || value == null || !Number.isFinite(Number(value)) || Number(value) < 0 || !Number.isSafeInteger(toCents(value))) {
    throw new ApiError(400, `${label} must be a valid non-negative amount.`);
  }
  return toCents(value);
}
export function calculateQuotation(items, discount = 0) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new ApiError(400, 'Add between 1 and 200 products.');
  const seen = new Set();
  let subtotalCents = 0;
  let lineDiscountCents = 0;
  const lines = items.map(line => {
    if (!mongoose.isValidObjectId(line.itemId) || seen.has(String(line.itemId))) throw new ApiError(400, 'Select valid, distinct products.');
    seen.add(String(line.itemId));
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new ApiError(400, 'Quantity must be a positive whole number.');
    const unitPriceCents = money(line.unitPrice, 'Unit price');
    const discountCents = money(line.discount ?? 0, 'Item discount');
    const gross = quantity * unitPriceCents;
    if (!Number.isSafeInteger(gross) || discountCents > gross) throw new ApiError(400, 'Item discount cannot exceed its amount.');
    subtotalCents += gross;
    lineDiscountCents += discountCents;
    return { item: line.itemId, quantity, unitPriceCents, discountCents, lineTotalCents: gross - discountCents };
  });
  const discountCents = money(discount, 'Discount');
  const totalDiscountCents = lineDiscountCents + discountCents;
  if (!Number.isSafeInteger(subtotalCents) || totalDiscountCents > subtotalCents) throw new ApiError(400, 'Discount cannot exceed the subtotal.');
  return { items: lines, subtotalCents, discountCents, totalDiscountCents, grandTotalCents: subtotalCents - totalDiscountCents };
}

export async function validateQuotation(payload, session) {
  if (!mongoose.isValidObjectId(payload.customerId)) throw new ApiError(400, 'Please select a valid customer.');
  const customer = await Customer.findById(payload.customerId).session(session);
  if (!customer) throw new ApiError(404, 'Customer not found.');
  const date = new Date(payload.date);
  const expiryDate = new Date(payload.expiryDate);
  if (!payload.date || !payload.expiryDate || !Number.isFinite(+date) || !Number.isFinite(+expiryDate)) throw new ApiError(400, 'Select valid quotation and expiry dates.');
  expiryDate.setUTCHours(23, 59, 59, 999);
  if (expiryDate < date) throw new ApiError(400, 'Expiry date must be on or after the quotation date.');
  const calculated = calculateQuotation(payload.items, payload.discount ?? 0);
  const products = await InventoryItem.find({ _id: { $in: calculated.items.map(i => i.item) }, status: 'active' }).session(session);
  const byId = new Map(products.map(p => [String(p._id), p]));
  calculated.items = calculated.items.map(line => {
    const product = byId.get(String(line.item));
    if (!product) throw new ApiError(400, 'A selected product is missing or inactive.');
    return { ...line, itemName: product.name, itemCode: product.itemCode };
  });
  if (typeof (payload.notes ?? '') !== 'string' || (payload.notes || '').length > 4000) throw new ApiError(400, 'Notes must be at most 4000 characters.');
  return { ...calculated, customer: customer._id, customerName: customer.name, customerPhone: customer.phone, date, expiryDate, notes: payload.notes || '' };
}

export function quotationDTO(q) {
  return {
    id: q._id, quotationNumber: q.quotationNumber, customer: q.customer,
    customerName: q.customerName, customerPhone: q.customerPhone, date: q.date, expiryDate: q.expiryDate,
    items: q.items.map(i => ({ itemId: i.item, name: i.itemName, itemCode: i.itemCode, quantity: i.quantity, unitPrice: fromCents(i.unitPriceCents), discount: fromCents(i.discountCents), lineTotal: fromCents(i.lineTotalCents) })),
    subtotal: fromCents(q.subtotalCents), discount: fromCents(q.discountCents), totalDiscount: fromCents(q.totalDiscountCents), grandTotal: fromCents(q.grandTotalCents),
    status: effectiveStatus(q), notes: q.notes, convertedInvoice: q.convertedInvoice, convertedInvoiceNumber: q.convertedInvoiceNumber,
    createdAt: q.createdAt, updatedAt: q.updatedAt,
  };
}
