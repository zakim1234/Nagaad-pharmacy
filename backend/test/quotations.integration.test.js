import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Quotation from '../src/models/Quotation.js';
import Sale from '../src/models/Sale.js';
import Payment from '../src/models/Payment.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import DayClose from '../src/models/DayClose.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('quotation lifecycle, concurrent conversion, rollback, reports and debt-account settlement', { timeout: 120000 }, async () => {
  let server;
  await mongoose.connect(`mongodb://127.0.0.1:27028/quotation_test_${Date.now()}?replicaSet=stocktest`);
  try {
    process.env.JWT_SECRET = 'isolated-quotation-test';
    await Promise.all(Object.values(mongoose.models).map(m => m.init()));
    const user = await User.create({ username: 'tester', name: 'Tester', passwordHash: 'unused', role: 'admin' });
    const customer = await Customer.create({ name: 'Mohamed', phone: '123' });
    const account = await Account.create({ name: 'EVC' });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
    const request = async (path, body, method = 'POST', authorized = true) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, ...await r.json() };
    };
    const stock = await request('/stock', { rows: [{ name: 'Baramol', quantity: 20, costPrice: 1, sellingPrice: 60, expiryDate: '2035-01-01' }] });
    assert.equal(stock.status, 201, JSON.stringify(stock));
    const product = await InventoryItem.findOne({ name: 'Baramol' });
    const payload = { customerId: customer.id, date: new Date().toISOString().slice(0, 10), expiryDate: '2034-12-31', items: [{ itemId: product.id, quantity: 2, unitPrice: 55, discount: 0 }], discount: 0, grandTotal: 0, notes: 'Quoted price' };
    assert.equal((await request('/quotations', payload, 'POST', false)).status, 401);
    const created = await request('/quotations', payload);
    assert.equal(created.status, 201, JSON.stringify(created));
    const id = created.data.id;
    assert.equal(created.data.grandTotal, 110);
    assert.equal((await InventoryItem.findById(product.id)).quantity, 20);
    assert.equal((await InventoryItem.findById(product.id)).reservedQuantity, 0);
    assert.equal(await Sale.countDocuments(), 0);
    assert.equal(await AccountTransaction.countDocuments(), 0);
    assert.equal(await DayClose.countDocuments(), 0);
    assert.equal((await request(`/quotations/${id}/convert`, {})).status, 409);
    assert.equal((await request(`/quotations/${id}/status`, { status: 'Accepted' }, 'PATCH')).status, 200);
    assert.equal((await request(`/quotations/${id}`, payload, 'PUT')).status, 409);
    // Server uses the accepted snapshot, ignoring edited prices/items in conversion input.
    const conversions = await Promise.all([1, 2].map(() => request(`/quotations/${id}/convert`, { paidAmount: 50, paymentAccountId: account.id, items: [], discount: 110 })));
    assert.deepEqual(conversions.map(r => r.status).sort(), [200, 201], JSON.stringify(conversions));
    assert.equal(conversions[0].data.id, conversions[1].data.id);
    const saleId = conversions[0].data.id;
    assert.equal(await Sale.countDocuments(), 1);
    assert.equal(await AccountTransaction.countDocuments(), 1);
    assert.equal((await Sale.findById(saleId)).totalCents, 11000);
    assert.equal((await InventoryItem.findById(product.id)).quantity, 20);
    assert.equal((await InventoryItem.findById(product.id)).reservedQuantity, 2);
    assert.equal((await Account.findById(account.id)).currentBalanceCents, 0);
    assert.equal((await Quotation.findById(id)).status, 'Converted');
    assert.equal((await request(`/sales/${saleId}`, { items: [{ itemId: product.id, quantity: 2 }] }, 'PUT')).status, 409);
    const pending = await request('/quotations', { ...payload, items: [{ itemId: product.id, quantity: 5, unitPrice: 60 }] });
    assert.equal(pending.data.grandTotal, 300);
    await closeDay({ user });
    assert.equal((await InventoryItem.findById(product.id)).quantity, 18);
    assert.equal((await Customer.findById(customer.id)).balanceCents, 6000);
    // Not 5000: Close Day posts today's $50 EVC payment and then, in that
    // same close, resets every operational Account to $0 with an auditable
    // ADJUSTMENT transaction -- the $50 is preserved permanently in the
    // DayClose snapshot's paymentBreakdown (asserted below), not in the
    // live balance, which always starts the next business day at zero.
    assert.equal((await Account.findById(account.id)).currentBalanceCents, 0);
    const dayCloseDoc = await DayClose.findOne();
    assert.equal(dayCloseDoc.revenueCents, 11000);
    assert.equal(dayCloseDoc.paymentBreakdown.find(p => String(p.account) === String(account.id))?.amountCents, 5000);
    assert.equal(dayCloseDoc.accountBalancesBeforeReset.find(a => String(a.account) === String(account.id))?.balanceBeforeResetCents, 5000);
    const missingAccount = await request(`/customers/${customer.id}/payments`, { amount: 40 });
    assert.equal(missingAccount.status, 400);
    const paymentPayload = { amount: 40, paymentAccountId: account.id, requestKey: 'payment-request-123' };
    const payments = await Promise.all([1, 2].map(() => request(`/customers/${customer.id}/payments`, paymentPayload)));
    assert.ok(payments.every(r => r.status === 201), JSON.stringify(payments));
    assert.equal(payments[0].data.paymentId, payments[1].data.paymentId);
    assert.equal(await Payment.countDocuments({ type: 'debt_payment' }), 1);
    assert.equal((await Customer.findById(customer.id)).balanceCents, 2000);
    // 4000, not 9000: the account was reset to 0 at Close Day above (see
    // line 73), so this is just the $40 debt payment posted immediately
    // afterward, not an accumulation on top of the pre-reset 5000.
    assert.equal((await Account.findById(account.id)).currentBalanceCents, 4000);
    assert.equal((await Sale.findById(saleId)).totalCents, 11000);
    assert.equal((await Sale.findById(saleId)).outstandingCents, 2000);
    assert.equal(await AccountTransaction.countDocuments({ type: 'CUSTOMER_DEBT_PAYMENT' }), 1);
    const receipt = await request(`/payments/${payments[0].data.paymentId}/receipt`, null, 'GET');
    assert.equal(receipt.data.paymentAccountName, 'EVC');
    assert.equal(receipt.data.newBalance, 20);
    assert.equal((await request(`/customers/${customer.id}/payments`, { ...paymentPayload, amount: 10 })).status, 409);
    const revenue = await request('/reports/sales?range=today', null, 'GET');
    assert.equal(revenue.data.totalSales, 110);
    // A later insufficient-stock failure rolls back every conversion side effect.
    const scarce = await request('/quotations', { ...payload, items: [{ itemId: product.id, quantity: 19, unitPrice: 2 }] });
    await request(`/quotations/${scarce.data.id}/status`, { status: 'Accepted' }, 'PATCH');
    assert.equal((await request(`/quotations/${scarce.data.id}/convert`, {})).status, 409);
    assert.equal((await Quotation.findById(scarce.data.id)).status, 'Accepted');
    assert.equal((await InventoryItem.findById(product.id)).reservedQuantity, 0);
    assert.equal(await Sale.countDocuments(), 1);
    const expired = await request('/quotations', { ...payload, date: '2020-01-01', expiryDate: '2020-01-02' });
    assert.equal(expired.data.status, 'Expired');
    assert.equal((await request(`/quotations/${expired.data.id}/convert`, {})).status, 409);
    const rejected = await request('/quotations', payload);
    await request(`/quotations/${rejected.data.id}/status`, { status: 'Rejected' }, 'PATCH');
    assert.equal((await request(`/quotations/${rejected.data.id}/convert`, {})).status, 409);
    const report = await request('/reports/quotations', null, 'GET');
    assert.equal(report.data.counts.Converted, 1);
    assert.equal(report.data.counts.Pending, 1);
    assert.equal(report.data.counts.Accepted, 1);
    assert.equal(report.data.counts.Expired, 1);
    assert.equal(report.data.counts.Rejected, 1);
    const parallel = await Promise.all([1, 2, 3].map(() => request('/quotations', payload)));
    assert.ok(parallel.every(r => r.status === 201), JSON.stringify(parallel));
    assert.equal(new Set(parallel.map(r => r.data.quotationNumber)).size, 3);
    const empty = await request('/sales?id=not-an-invoice', null, 'GET');
    assert.deepEqual(empty.data, []);
    const filtered = await request('/sales?customerName=Mohamed&status=CONFIRMED&sortBy=updatedAt', null, 'GET');
    assert.equal(filtered.data[0].settledPaidAmount, 90);
    assert.equal((await request(`/quotations/${id}`, null, 'DELETE')).status, 409);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
