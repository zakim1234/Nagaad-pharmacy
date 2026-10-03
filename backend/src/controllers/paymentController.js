import Payment from '../models/Payment.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';

// GET /api/payments?customer=&page=&limit=
export const listPayments = asyncHandler(async (req, res) => {
  const { customer, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (customer) filter.customer = customer;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .populate('customer', 'name')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Payment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map((p) => ({
      id: p._id,
      receiptNumber: p.receiptNumber,
      customer: p.customer,
      amount: fromCents(p.amountCents),
      type: p.type,
      notes: p.notes,
      createdAt: p.createdAt,
    })),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/payments/:id/receipt -- printable A5 debt payment receipt
export const getPaymentReceipt = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate('customer', 'name phone').populate('paymentAccount', 'name');
  if (!payment) throw new ApiError(404, 'Payment not found.');

  res.json({
    success: true,
    data: {
      id: payment._id,
      receiptNumber: payment.receiptNumber,
      customerName: payment.customer?.name || '',
      customerPhone: payment.customer?.phone || '',
      paymentAccount: payment.paymentAccount?._id || null,
      paymentAccountName: payment.paymentAccountName || payment.paymentAccount?.name || '',
      amount: fromCents(payment.amountCents),
      previousBalance: fromCents(payment.previousBalanceCents),
      newBalance: fromCents(payment.newBalanceCents),
      allocations: payment.allocations.map((a) => ({ receiptNumber: a.receiptNumber, amount: fromCents(a.amountCents) })),
      notes: payment.notes,
      createdAt: payment.createdAt,
    },
  });
});
