import Customer from '../models/Customer.js';
import Account from '../models/Account.js';
import { createHash } from 'node:crypto';
import { postImmediateTransaction } from '../services/accountService.js';
import Sale from '../models/Sale.js';
import Payment from '../models/Payment.js';
import CustomerLedger from '../models/CustomerLedger.js';
import CustomerWalletTransaction from '../models/CustomerWalletTransaction.js';
import { nextSequence } from '../models/Counter.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { logAudit } from '../services/auditService.js';

function toDTO(c) {
  return {
    id: c._id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    balance: fromCents(c.balanceCents),
    walletBalance: fromCents(c.walletBalanceCents),
    totalPurchased: fromCents(c.totalPurchasedCents),
    totalPaid: fromCents(c.totalPaidCents),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function generatePaymentReceiptNumber(session) {
  const seq = await nextSequence('payment', session);
  const year = new Date().getFullYear();
  return `PAY-${year}-${String(seq).padStart(6, '0')}`;
}

// GET /api/customers?search=&page=&limit=
export const listCustomers = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 20 } = req.query;
  const filter = {};
  if (search.trim()) {
    const norm = Customer.normalize(search);
    filter.$or = [
      { normalizedName: { $regex: norm, $options: 'i' } },
      { phone: { $regex: search.trim(), $options: 'i' } },
    ];
  }
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Customer.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items.map(toDTO),
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/customers/search?q=Ahmed  -- fast lightweight search used by POS
export const searchCustomers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, data: [] });

  const norm = Customer.normalize(q);
  const customers = await Customer.find({
    $or: [{ normalizedName: { $regex: norm, $options: 'i' } }, { phone: { $regex: q, $options: 'i' } }],
  })
    .sort({ name: 1 })
    .limit(10);

  res.json({ success: true, data: customers.map(toDTO) });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');
  res.json({ success: true, data: toDTO(customer) });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone = '', email = '', address = '', openingBalance = 0, notes = '' } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Customer name is required.');

  const openingBalanceCents = toCents(openingBalance);
  const customer = await Customer.create({
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim(),
    address: address.trim(),
    notes,
    openingBalanceCents,
    balanceCents: openingBalanceCents,
  });

  if (openingBalanceCents > 0) {
    await CustomerLedger.create({
      customer: customer._id,
      type: 'ADJUSTMENT',
      amountCents: openingBalanceCents,
      description: 'Opening balance',
      balanceBeforeCents: 0,
      balanceAfterCents: openingBalanceCents,
      createdBy: req.user?._id,
    });
  }

  await logAudit({
    user: req.user,
    action: 'customer.create',
    entityType: 'Customer',
    entityId: customer._id,
    details: { name: customer.name },
  });

  res.status(201).json({ success: true, data: toDTO(customer) });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const { name, phone, email, address, notes } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Customer name cannot be empty.');
    customer.name = name.trim();
  }
  if (phone !== undefined) customer.phone = phone.trim();
  if (email !== undefined) customer.email = email.trim();
  if (address !== undefined) customer.address = address.trim();
  if (notes !== undefined) customer.notes = notes;

  await customer.save();

  await logAudit({
    user: req.user,
    action: 'customer.update',
    entityType: 'Customer',
    entityId: customer._id,
    details: req.body,
  });

  res.json({ success: true, data: toDTO(customer) });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const saleCount = await Sale.countDocuments({ customer: customer._id, status: 'CONFIRMED' });
  if (saleCount > 0) {
    throw new ApiError(
      409,
      'This customer has sales history and cannot be deleted. Consider editing their details instead.'
    );
  }

  await customer.deleteOne();

  await logAudit({
    user: req.user,
    action: 'customer.delete',
    entityType: 'Customer',
    entityId: customer._id,
    details: { name: customer.name },
  });

  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/customers/:id/history  -- full transaction history + ledger timeline
export const getCustomerHistory = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const { from, to, status } = req.query;
  const filter = { customer: customer._id };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  if (status) {
    if (!['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) throw new ApiError(400, 'Invalid invoice status filter.');
    filter.status = status;
  }

  const sales = await Sale.find(filter).sort({ createdAt: -1 });
  // Wallet credit used on confirmed invoices -- paid, but never counted in
  // Customer.totalPaidCents (that cash was received at deposit time).
  const [walletUsed] = await Sale.aggregate([{ $match: { customer: customer._id, status: 'CONFIRMED' } }, { $group: { _id: null, cents: { $sum: '$walletAmountCents' } } }]);
  const payments = await Payment.find({ customer: customer._id, type: { $ne: 'sale' } })
    .sort({ createdAt: -1 });
  const ledger = await CustomerLedger.find({ customer: customer._id }).sort({ createdAt: 1 });

  res.json({
    success: true,
    data: {
      customer: toDTO(customer),
      walletPaid: fromCents(walletUsed?.cents || 0),
      sales: sales.map((s) => ({
        id: s._id,
        receiptNumber: s.receiptNumber,
        status: s.status,
        items: s.items.map((i) => ({
          item: i.item,
          name: i.itemName,
          quantity: i.quantity,
          returnedQuantity: i.returnedQuantity || 0,
          unitPrice: fromCents(i.unitPriceCents),
          subtotal: fromCents(i.subtotalCents),
        })),
        subtotal: fromCents(s.subtotalCents),
        discount: fromCents(s.discountCents),
        total: fromCents(s.totalCents),
        paidAmount: fromCents(s.paidAmountCents),
        balanceAdded: fromCents(s.balanceAddedCents),
        outstanding: fromCents(s.outstandingCents),
        paymentAccount: s.paymentAccount,
        walletAmount: fromCents(s.walletAmountCents || 0),
        returnCount: s.returns?.length || 0,
        returns: (s.returns || []).map((r, index) => ({
          index,
          items: r.items.map((ri) => ({ name: ri.itemName, quantity: ri.quantity, unitPrice: fromCents(ri.unitPriceCents) })),
          amount: fromCents(r.amountCents),
          debtReduced: fromCents(r.debtReducedCents),
          refund: fromCents(r.refundCents),
          walletRefund: fromCents(r.walletRefundCents || 0),
          reason: r.reason,
          createdAt: r.createdAt,
        })),
        cancelledAt: s.cancelledAt,
        cancelledReason: s.cancelledReason,
        createdAt: s.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p._id,
        receiptNumber: p.receiptNumber,
        amount: fromCents(p.amountCents),
        type: p.type,
        allocations: p.allocations.map((a) => ({ receiptNumber: a.receiptNumber, amount: fromCents(a.amountCents) })),
        notes: p.notes,
        createdAt: p.createdAt,
      })),
      timeline: ledger.map((l) => ({
        id: l._id,
        type: l.type,
        amount: fromCents(l.amountCents),
        description: l.description,
        balanceBefore: fromCents(l.balanceBeforeCents),
        balanceAfter: fromCents(l.balanceAfterCents),
        sale: l.sale,
        payment: l.payment,
        createdAt: l.createdAt,
      })),
    },
  });
});

// GET /api/customers/:id/debt -- outstanding invoices this customer still owes on
export const getCustomerDebt = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const invoices = await Sale.find({ customer: customer._id, status: 'CONFIRMED', outstandingCents: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .select('receiptNumber totalCents paidAmountCents outstandingCents createdAt');

  const totalOutstandingCents = invoices.reduce((sum, i) => sum + i.outstandingCents, 0);

  res.json({
    success: true,
    data: {
      customer: toDTO(customer),
      totalOutstanding: fromCents(totalOutstandingCents),
      invoices: invoices.map((i) => ({
        id: i._id,
        receiptNumber: i.receiptNumber,
        total: fromCents(i.totalCents),
        paidAtSale: fromCents(i.paidAmountCents),
        outstanding: fromCents(i.outstandingCents),
        createdAt: i.createdAt,
      })),
    },
  });
});

// POST /api/customers/:id/payments  -- pay down debt, allocated to specific invoices
export const payCustomerDebt = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount)) || toCents(amount) <= 0) throw new ApiError(400, 'Please enter a valid payment amount.');
  const amountCents = toCents(amount);
  const requestedAllocations = Array.isArray(req.body.allocations) ? req.body.allocations : null;
  if (!req.body.paymentAccountId) throw new ApiError(400, 'Please select an account for this payment.');
  const requestKey = req.body.requestKey;
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[\w-]{8,100}$/.test(requestKey))) throw new ApiError(400, 'Invalid payment request reference.');
  const requestFingerprint = createHash('sha256').update(JSON.stringify([req.params.id, amountCents, req.body.paymentAccountId, requestedAllocations, req.body.notes || ''])).digest('hex');

  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found.');

    if (requestKey) {
      const existing = await Payment.findOne({ createdBy: req.user._id, requestKey }).session(session);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new ApiError(409, 'This payment reference was already used with different details.');
        return { payment: existing, customer };
      }
    }
    const account = await Account.findById(req.body.paymentAccountId).session(session);
    if (!account?.isActive) throw new ApiError(400, 'Selected payment account is not available.');

    const outstandingInvoices = await Sale.find({
      customer: customer._id,
      status: 'CONFIRMED',
      outstandingCents: { $gt: 0 },
    })
      .sort({ createdAt: 1 })
      .session(session);

    const totalOutstandingCents = outstandingInvoices.reduce((sum, s) => sum + s.outstandingCents, 0);
    if (totalOutstandingCents <= 0) {
      throw new ApiError(409, 'This customer has no outstanding debt to pay.');
    }
    if (amountCents > totalOutstandingCents) {
      throw new ApiError(
        400,
        `Payment ($${amount.toFixed(2)}) exceeds the customer's total outstanding debt ($${fromCents(totalOutstandingCents).toFixed(2)}).`
      );
    }

    const allocations = [];
    let remaining = amountCents;

    if (requestedAllocations) {
      // Manual allocation: pay specific invoices by id.
      const bySaleId = new Map(outstandingInvoices.map((s) => [s._id.toString(), s]));
      for (const a of requestedAllocations) {
        const sale = bySaleId.get(String(a.saleId));
        if (!sale) throw new ApiError(400, 'One of the selected invoices is no longer outstanding.');
        if (!Number.isFinite(Number(a.amount)) || Number(a.amount) < 0 || !Number.isSafeInteger(toCents(a.amount))) throw new ApiError(400, 'Invalid invoice allocation amount.');
        const allocCents = toCents(a.amount);
        if (allocCents <= 0) continue;
        if (allocCents > sale.outstandingCents) {
          throw new ApiError(400, `Allocation to ${sale.receiptNumber} exceeds its outstanding balance.`);
        }
        sale.outstandingCents -= allocCents;
        await sale.save({ session });
        allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: allocCents });
        remaining -= allocCents;
      }
      if (remaining !== 0) {
        throw new ApiError(400, 'Allocated amounts must add up exactly to the payment amount.');
      }
    } else {
      // Automatic allocation: oldest invoice first.
      for (const sale of outstandingInvoices) {
        if (remaining <= 0) break;
        const take = Math.min(sale.outstandingCents, remaining);
        sale.outstandingCents -= take;
        await sale.save({ session });
        allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: take });
        remaining -= take;
      }
    }

    const previousBalanceCents = customer.balanceCents;
    customer.balanceCents -= amountCents;
    customer.totalPaidCents += amountCents;
    await customer.save({ session });

    const receiptNumber = await generatePaymentReceiptNumber(session);

    const [payment] = await Payment.create(
      [
        {
          receiptNumber,
          customer: customer._id,
          amountCents,
          type: 'debt_payment',
          paymentAccount: account._id,
          paymentAccountName: account.name,
          requestKey,
          requestFingerprint,
          allocations,
          previousBalanceCents,
          newBalanceCents: customer.balanceCents,
          notes: req.body.notes || '',
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    await CustomerLedger.create(
      [
        {
          customer: customer._id,
          type: 'PAYMENT',
          amountCents: -amountCents,
          payment: payment._id,
          description: `Debt payment ${receiptNumber} (${allocations.map((a) => a.receiptNumber).join(', ')})`,
          balanceBeforeCents: previousBalanceCents,
          balanceAfterCents: customer.balanceCents,
          createdBy: req.user?._id,
        },
      ],
      { session }
    );

    const transaction = await postImmediateTransaction({ account, direction: 'IN', type: 'CUSTOMER_DEBT_PAYMENT', amountCents, referenceType: 'Payment', referenceId: payment._id, description: `Debt payment ${receiptNumber} — ${customer.name}`, createdBy: req.user }, session);
    payment.accountTransaction = transaction._id;
    await payment.save({ session });
    return { payment, customer };
  });

  await logAudit({
    user: req.user,
    action: 'customer.payment',
    entityType: 'Customer',
    entityId: result.customer._id,
    details: { amount, receiptNumber: result.payment.receiptNumber },
  });

  res.status(201).json({
    success: true,
    data: { customer: toDTO(result.customer), paymentId: result.payment._id, receiptNumber: result.payment.receiptNumber },
  });
});

function walletTxnToDTO(t) {
  return {
    id: t._id,
    type: t.type,
    amount: fromCents(t.amountCents),
    account: t.account?._id || t.account,
    accountName: t.account?.name || '',
    sale: t.sale?._id || t.sale,
    saleReceiptNumber: t.sale?.receiptNumber || '',
    note: t.note,
    balanceBefore: fromCents(t.balanceBeforeCents),
    balanceAfter: fromCents(t.balanceAfterCents),
    createdBy: t.createdBy,
    createdAt: t.createdAt,
  };
}

// POST /api/customers/:id/wallet/deposit -- the customer hands over cash
// now (it enters the selected Account, exactly like any other cash
// receipt). If the customer currently owes debt, that debt is cleared
// first out of this same deposit (oldest invoice first, exactly like
// payCustomerDebt's automatic allocation); only what is left over becomes
// prepaid wallet credit. The cash still lands in the Account as ONE
// receipt -- the debt-clearing portion never posts a second Account
// transaction (that would double-count the same physical cash), it only
// moves Customer.balanceCents/Sale.outstandingCents and is recorded via a
// Payment + CustomerLedger entry exactly like a manual debt payment,
// pointing at this deposit's own AccountTransaction for traceability.
export const depositToWallet = asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toCents(amount))) throw new ApiError(400, 'Enter a valid deposit amount.');
  if (!req.body.paymentAccountId) throw new ApiError(400, 'Please select an account for this deposit.');
  const amountCents = toCents(amount);

  const result = await runInTransaction(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found.');
    const account = await Account.findById(req.body.paymentAccountId).session(session);
    if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

    const txn = await postImmediateTransaction(
      {
        account,
        direction: 'IN',
        type: 'DEPOSIT',
        amountCents,
        referenceType: 'CustomerWalletTransaction',
        referenceId: customer._id,
        description: `Wallet deposit for ${customer.name}`,
        createdBy: req.user,
      },
      session
    );

    let remainingCents = amountCents;
    let debtClearedCents = 0;
    let payment = null;

    if (customer.balanceCents > 0) {
      const outstandingInvoices = await Sale.find({ customer: customer._id, status: 'CONFIRMED', outstandingCents: { $gt: 0 } })
        .sort({ createdAt: 1 })
        .session(session);
      // Normally equal to customer.balanceCents; capped independently in
      // case they have ever drifted, so balanceCents can never go negative
      // and never outpaces what invoices actually still owe.
      const totalOutstandingCents = outstandingInvoices.reduce((sum, s) => sum + s.outstandingCents, 0);
      const debtPortionCents = Math.min(remainingCents, customer.balanceCents, totalOutstandingCents);

      if (debtPortionCents > 0) {
        const allocations = [];
        let toAllocate = debtPortionCents;
        for (const sale of outstandingInvoices) {
          if (toAllocate <= 0) break;
          const take = Math.min(sale.outstandingCents, toAllocate);
          sale.outstandingCents -= take;
          await sale.save({ session });
          allocations.push({ sale: sale._id, receiptNumber: sale.receiptNumber, amountCents: take });
          toAllocate -= take;
        }
        debtClearedCents = debtPortionCents - toAllocate; // actually allocated, in case of a drift
        remainingCents -= debtClearedCents;

        const previousBalanceCents = customer.balanceCents;
        customer.balanceCents -= debtClearedCents;
        customer.totalPaidCents += debtClearedCents;

        const receiptNumber = await generatePaymentReceiptNumber(session);
        [payment] = await Payment.create(
          [
            {
              receiptNumber,
              customer: customer._id,
              amountCents: debtClearedCents,
              type: 'debt_payment',
              paymentAccount: account._id,
              paymentAccountName: account.name,
              accountTransaction: txn?._id || null,
              allocations,
              previousBalanceCents,
              newBalanceCents: customer.balanceCents,
              notes: `Auto-applied from wallet deposit${req.body.note ? `: ${req.body.note}` : ''}`,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );

        await CustomerLedger.create(
          [
            {
              customer: customer._id,
              type: 'PAYMENT',
              amountCents: -debtClearedCents,
              payment: payment._id,
              description: `Debt payment ${receiptNumber} (${allocations.map((a) => a.receiptNumber).join(', ')}) -- auto-applied from wallet deposit`,
              balanceBeforeCents: previousBalanceCents,
              balanceAfterCents: customer.balanceCents,
              createdBy: req.user?._id,
            },
          ],
          { session }
        );
      }
    }

    const walletCreditedCents = remainingCents;
    const previousWalletBalanceCents = customer.walletBalanceCents;
    let walletTxn = null;
    if (walletCreditedCents > 0) {
      customer.walletBalanceCents += walletCreditedCents;
      const note =
        debtClearedCents > 0
          ? `Deposit ${fromCents(amountCents).toFixed(2)} -- ${fromCents(debtClearedCents).toFixed(2)} applied to debt, ${fromCents(walletCreditedCents).toFixed(2)} added to wallet${req.body.note ? `: ${req.body.note}` : ''}`
          : req.body.note || '';
      [walletTxn] = await CustomerWalletTransaction.create(
        [
          {
            customer: customer._id,
            type: 'DEPOSIT',
            amountCents: walletCreditedCents,
            account: account._id,
            accountTransaction: txn?._id || null,
            note,
            balanceBeforeCents: previousWalletBalanceCents,
            balanceAfterCents: customer.walletBalanceCents,
            createdBy: req.user?._id,
          },
        ],
        { session }
      );
    }
    await customer.save({ session });

    return { customer, walletTxn, payment, debtClearedCents, walletCreditedCents };
  });

  await logAudit({
    user: req.user,
    action: 'customer.wallet.deposit',
    entityType: 'Customer',
    entityId: result.customer._id,
    details: { amount, debtCleared: fromCents(result.debtClearedCents), walletCredited: fromCents(result.walletCreditedCents) },
  });

  res.status(201).json({
    success: true,
    data: {
      customer: toDTO(result.customer),
      transaction: result.walletTxn ? walletTxnToDTO(result.walletTxn) : null,
      debtCleared: fromCents(result.debtClearedCents),
      walletCredited: fromCents(result.walletCreditedCents),
    },
  });
});

// GET /api/customers/:id/wallet/history?q=
export const getWalletHistory = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');
  const q = String(req.query.q || '').trim();
  const filter = { customer: customer._id };
  let transactions = await CustomerWalletTransaction.find(filter)
    .populate('account', 'name')
    .populate('sale', 'receiptNumber')
    .sort({ createdAt: -1 });
  if (q) {
    const needle = q.toLowerCase();
    transactions = transactions.filter(
      (t) =>
        t.type.toLowerCase().includes(needle) ||
        (t.note || '').toLowerCase().includes(needle) ||
        (t.sale?.receiptNumber || '').toLowerCase().includes(needle) ||
        (t.account?.name || '').toLowerCase().includes(needle)
    );
  }
  res.json({ success: true, data: { walletBalance: fromCents(customer.walletBalanceCents), transactions: transactions.map(walletTxnToDTO) } });
});

// GET /api/customers/:id/statement?from=&to= -- ONE consolidated document:
// every CONFIRMED invoice and every payment from the customer's join date
// (or a custom range) through today, merged into a single running-balance
// ledger. Draft invoices are deliberately excluded from the finalized
// totals/ledger and returned separately as "pendingToday" so they are never
// mistaken for posted debt/revenue.
export const getCustomerStatement = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const from = req.query.from ? new Date(req.query.from) : new Date(customer.createdAt);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  if (req.query.to && req.query.to.length <= 10) to.setHours(23, 59, 59, 999);

  const [sales, payments, todaysDrafts] = await Promise.all([
    Sale.find({ customer: customer._id, status: 'CONFIRMED', createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
    Payment.find({ customer: customer._id, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
    Sale.find({ customer: customer._id, status: 'DRAFT' }).sort({ createdAt: -1 }),
  ]);

  // Merge into one chronological, double-entry ledger: a confirmed sale is a
  // debit (increases what the customer owes), a payment is a credit.
  const entries = [
    ...sales.map((s) => ({
      date: s.createdAt,
      reference: s.receiptNumber,
      type: 'SALE',
      description: `Sale invoice ${s.receiptNumber}`,
      debitCents: s.totalCents,
      creditCents: 0,
      saleId: s._id,
    })),
    ...payments.map((p) => ({
      date: p.createdAt,
      reference: p.receiptNumber,
      type: p.type === 'sale' ? 'SALE_PAYMENT' : 'PAYMENT',
      description: p.type === 'sale' ? `Payment received at sale (${p.receiptNumber})` : `Debt payment ${p.receiptNumber}`,
      debitCents: 0,
      creditCents: p.amountCents,
      paymentId: p._id,
    })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let runningBalanceCents = customer.openingBalanceCents;
  const ledger = entries.map((e) => {
    runningBalanceCents += e.debitCents - e.creditCents;
    return {
      date: e.date,
      reference: e.reference,
      type: e.type,
      description: e.description,
      debit: fromCents(e.debitCents),
      credit: fromCents(e.creditCents),
      runningBalance: fromCents(runningBalanceCents),
    };
  });

  const totalAmountPurchasedCents = sales.reduce((sum, s) => sum + s.totalCents, 0);
  const totalPaymentsCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
  const totalCreditGeneratedCents = sales.reduce((sum, s) => sum + s.balanceAddedCents, 0);

  res.json({
    success: true,
    data: {
      customer: { ...toDTO(customer), since: customer.createdAt },
      range: { from, to },
      summary: {
        customerSince: customer.createdAt,
        totalConfirmedPurchases: sales.length,
        totalAmountPurchased: fromCents(totalAmountPurchasedCents),
        totalPayments: fromCents(totalPaymentsCents),
        totalCreditGenerated: fromCents(totalCreditGeneratedCents),
        currentOutstandingBalance: fromCents(customer.balanceCents),
        numberOfFinalizedInvoices: sales.length,
      },
      ledger,
      invoices: sales.map((s) => ({
        id: s._id,
        receiptNumber: s.receiptNumber,
        createdAt: s.createdAt,
        items: s.items.map((i) => ({ name: i.itemName, quantity: i.quantity, unitPrice: fromCents(i.unitPriceCents), subtotal: fromCents(i.subtotalCents) })),
        total: fromCents(s.totalCents),
        paidAmount: fromCents(s.paidAmountCents),
        balance: fromCents(s.balanceAddedCents),
      })),
      pendingToday: todaysDrafts.map((s) => ({
        id: s._id,
        receiptNumber: s.receiptNumber,
        createdAt: s.createdAt,
        total: fromCents(s.totalCents),
        paidAmount: fromCents(s.paidAmountCents),
      })),
    },
  });
});

export { toDTO as customerToDTO };
