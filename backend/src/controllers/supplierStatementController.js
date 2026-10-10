import mongoose from 'mongoose';
import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import PurchasePayment from '../models/PurchasePayment.js';
import BulkPurchasePayment from '../models/BulkPurchasePayment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';

// Calendar day (server-local) of a date, for ordering lines day by day.
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// GET /api/purchases/suppliers/:supplierId/statement -- the supplier's
// account, the way it is reconciled with them: every goods invoice (with
// their invoice serial number) and every payment (with the serial number of
// their payment receipt), oldest first with a running balance, and the
// totals bought / paid / still owed. A payment is shown against the
// supplier's total only, never against a particular invoice. Voided
// invoices and deleted payments are left out.
export const getSupplierStatement = asyncHandler(async (req, res) => {
  const { supplierId } = req.params;
  if (!mongoose.isValidObjectId(supplierId)) throw new ApiError(404, 'Supplier not found.');
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new ApiError(404, 'Supplier not found.');

  const purchases = await Purchase.find({ supplier: supplier._id, status: 'completed' }).sort({ purchaseDate: 1, createdAt: 1 });
  const payments = await PurchasePayment.find({ purchase: { $in: purchases.map((p) => p._id) }, status: 'POSTED' }).sort({ createdAt: 1 });

  // A bulk payment was split over several invoices internally; here it is
  // one payment again.
  const bulkIds = [...new Set(payments.filter((p) => p.bulkPayment).map((p) => String(p.bulkPayment)))];
  const bulks = new Map((await BulkPurchasePayment.find({ _id: { $in: bulkIds } })).map((b) => [String(b._id), b]));
  const grouped = new Map();
  for (const p of payments) {
    const key = p.bulkPayment ? `b:${p.bulkPayment}` : `p:${p._id}`;
    const bulk = p.bulkPayment ? bulks.get(String(p.bulkPayment)) : null;
    const g = grouped.get(key) || {
      kind: 'PAYMENT',
      id: String(bulk?._id || p._id),
      bulk: !!bulk,
      date: p.paymentDate || p.createdAt,
      createdAt: p.createdAt,
      receiptNo: bulk?.receiptNo || p.receiptNo || '',
      reference: bulk?.bulkNumber || p.paymentNumber,
      account: p.paymentAccountName,
      amountCents: 0,
    };
    g.amountCents += p.amountCents;
    grouped.set(key, g);
  }

  const lines = [
    ...purchases.map((p) => ({
      kind: 'INVOICE',
      id: String(p._id),
      date: p.purchaseDate || p.createdAt,
      createdAt: p.createdAt,
      serialNo: p.supplierInvoiceNumber || '',
      reference: p.purchaseNumber,
      amountCents: p.totalCostCents,
    })),
    ...[...grouped.values()].map((g) => ({ ...g, serialNo: g.receiptNo })),
  ].sort(
    (a, b) =>
      dayKey(a.date).localeCompare(dayKey(b.date)) ||
      // On the same day, goods come before what was paid for them.
      (a.kind === b.kind ? 0 : a.kind === 'INVOICE' ? -1 : 1) ||
      new Date(a.createdAt) - new Date(b.createdAt)
  );

  let balance = 0;
  const out = lines.map((l) => {
    balance += l.kind === 'INVOICE' ? l.amountCents : -l.amountCents;
    return {
      kind: l.kind,
      id: l.id,
      bulk: l.bulk || false,
      date: l.date,
      serialNo: l.serialNo,
      reference: l.reference,
      account: l.account || '',
      goods: l.kind === 'INVOICE' ? fromCents(l.amountCents) : 0,
      paid: l.kind === 'PAYMENT' ? fromCents(l.amountCents) : 0,
      balance: fromCents(balance),
    };
  });

  const boughtCents = purchases.reduce((s, p) => s + p.totalCostCents, 0);
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  res.json({
    success: true,
    data: {
      supplier: { id: supplier._id, name: supplier.name, phone: supplier.phone || '', address: supplier.address || '' },
      lines: out,
      totals: {
        bought: fromCents(boughtCents),
        paid: fromCents(paidCents),
        remaining: fromCents(boughtCents - paidCents),
        invoiceCount: purchases.length,
        paymentCount: grouped.size,
      },
      asOf: new Date(),
    },
  });
});
