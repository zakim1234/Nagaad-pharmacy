import mongoose from 'mongoose';
import Quotation from '../models/Quotation.js';
import Sale from '../models/Sale.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { runInTransaction } from '../utils/transaction.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { fromCents } from '../utils/money.js';
import { createSaleDraft } from '../services/saleService.js';
import { saleToDTO } from './saleController.js';
import { effectiveStatus, quotationDTO, quotationStatuses, validateQuotation, money } from '../services/quotationService.js';

const literal = value => String(value).slice(0, 150).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function filters(query, now) {
  const filter = {};
  if (query.customer) {
    if (!mongoose.isValidObjectId(query.customer)) throw new ApiError(400, 'Invalid customer.');
    filter.customer = new mongoose.Types.ObjectId(query.customer);
  }
  if (query.q) filter.$or = [{ quotationNumber: new RegExp(literal(query.q), 'i') }, { customerName: new RegExp(literal(query.q), 'i') }];
  if ((query.range && query.range !== 'all') || query.from || query.to) {
    const { start, end } = resolveDateRange(query);
    filter.date = { $gte: start, $lte: end };
  }
  if (query.status) {
    if (!quotationStatuses.includes(query.status)) throw new ApiError(400, 'Invalid quotation status.');
    if (query.status === 'Expired') filter.$and = [{ $or: [{ status: 'Expired' }, { status: { $in: ['Pending', 'Accepted'] }, expiryDate: { $lt: now } }] }];
    else {
      filter.status = query.status;
      if (['Pending', 'Accepted'].includes(query.status)) filter.expiryDate = { $gte: now };
    }
  }
  return filter;
}
async function findQuotation(id, session = null) {
  const q = await Quotation.findById(id).session(session);
  if (!q) throw new ApiError(404, 'Quotation not found.');
  return q;
}
export const listQuotations = asyncHandler(async (req, res) => {
  const filter = filters(req.query, new Date());
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const [rows, total] = await Promise.all([Quotation.find(filter).sort({ date: -1, _id: -1 }).skip((page - 1) * limit).limit(limit), Quotation.countDocuments(filter)]);
  res.json({ success: true, data: rows.map(quotationDTO), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});
export const getQuotation = asyncHandler(async (req, res) => res.json({ success: true, data: quotationDTO(await findQuotation(req.params.id)) }));
export const createQuotation = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async session => {
    const data = await validateQuotation(req.body, session);
    const year = new Date().getUTCFullYear();
    const seq = await nextSequence(`quotation:${year}`, session);
    const [q] = await Quotation.create([{ ...data, quotationNumber: `QUO-${year}-${String(seq).padStart(3, '0')}`, createdBy: req.user._id }], { session });
    return q;
  });
  res.status(201).json({ success: true, data: quotationDTO(result) });
});
export const updateQuotation = asyncHandler(async (req, res) => {
  const q = await runInTransaction(async session => {
    const q = await findQuotation(req.params.id, session);
    if (effectiveStatus(q) !== 'Pending') throw new ApiError(409, 'Only pending quotations can be edited.');
    Object.assign(q, await validateQuotation(req.body, session));
    await q.save({ session });
    return q;
  });
  res.json({ success: true, data: quotationDTO(q) });
});
export const setQuotationStatus = asyncHandler(async (req, res) => {
  const q = await runInTransaction(async session => {
    const q = await findQuotation(req.params.id, session);
    const status = effectiveStatus(q);
    const allowed = { Pending: ['Accepted', 'Rejected', 'Expired'], Accepted: ['Rejected', 'Expired'] };
    if (!allowed[status]?.includes(req.body.status)) throw new ApiError(409, 'This quotation status transition is not allowed.');
    if (req.body.status === 'Expired' && q.expiryDate >= new Date()) throw new ApiError(400, 'This quotation has not expired.');
    q.status = req.body.status;
    await q.save({ session });
    return q;
  });
  res.json({ success: true, data: quotationDTO(q) });
});
export const deleteQuotation = asyncHandler(async (req, res) => {
  await runInTransaction(async session => {
    const q = await findQuotation(req.params.id, session);
    if (q.convertedInvoice || !['Pending', 'Rejected', 'Expired'].includes(effectiveStatus(q))) throw new ApiError(409, 'Accepted or converted quotations cannot be deleted.');
    await q.deleteOne({ session });
  });
  res.json({ success: true });
});
// Conversion is committed with the existing draft sale and its reservations.
// Close Day remains the sole authority for final stock and financial posting.
export const convertQuotation = asyncHandler(async (req, res) => {
  const result = await runInTransaction(async session => {
    const q = await findQuotation(req.params.id, session);
    if (q.convertedInvoice) {
      const sale = await Sale.findById(q.convertedInvoice).session(session);
      if (!sale) throw new ApiError(409, 'The linked invoice is unavailable. Contact an administrator.');
      return { q, sale, existing: true };
    }
    if (effectiveStatus(q) !== 'Accepted') throw new ApiError(409, 'Only accepted, unexpired quotations can be converted.');
    money(req.body.paidAmount ?? 0, 'Paid amount');
    // Writing the quotation serializes simultaneous conversion requests.
    q.status = 'Converted';
    await q.save({ session });
    const sale = await createSaleDraft({
      customerId: q.customer, items: q.items.map(i => ({ itemId: i.item, quantity: i.quantity })),
      discount: fromCents(q.totalDiscountCents), paidAmount: req.body.paidAmount ?? 0, paymentAccountId: req.body.paymentAccountId,
    }, req.user, session, { quotationId: q._id, quotedPrices: new Map(q.items.map(i => [String(i.item), i.unitPriceCents])) });
    q.convertedInvoice = sale._id;
    q.convertedInvoiceNumber = sale.receiptNumber;
    await q.save({ session });
    return { q, sale, existing: false };
  });
  res.status(result.existing ? 200 : 201).json({ success: true, data: saleToDTO(result.sale), quotation: quotationDTO(result.q), existing: result.existing });
});
export const quotationReport = asyncHandler(async (req, res) => {
  const now = new Date();
  const groups = await Quotation.aggregate([
    { $match: filters(req.query, now) },
    { $set: { effectiveStatus: { $cond: [{ $and: [{ $in: ['$status', ['Pending', 'Accepted']] }, { $lt: ['$expiryDate', now] }] }, 'Expired', '$status'] } } },
    { $group: { _id: '$effectiveStatus', count: { $sum: 1 }, amountCents: { $sum: '$grandTotalCents' } } },
  ]);
  const counts = Object.fromEntries(quotationStatuses.map(s => [s, 0]));
  let total = 0, amount = 0;
  for (const group of groups) { counts[group._id] = group.count; total += group.count; amount += group.amountCents; }
  const range = (req.query.range && req.query.range !== 'all') || req.query.from || req.query.to ? resolveDateRange(req.query) : null;
  res.json({ success: true, data: { counts, totalQuotations: total, totalQuotationAmount: fromCents(amount), range: range ? { from: range.start, to: range.end } : null } });
});
