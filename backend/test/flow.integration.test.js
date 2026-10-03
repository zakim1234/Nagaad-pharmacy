import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Supplier from '../src/models/Supplier.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import InventoryLot from '../src/models/InventoryLot.js';
import Purchase from '../src/models/Purchase.js';
import StockEntry from '../src/models/StockEntry.js';
import Sale from '../src/models/Sale.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import { closeDay, openDay } from '../src/services/dayCloseService.js';

test('purchase, stock, reservations, close-day, expiry, rollback and concurrency integration', async () => {
  // Deliberately isolated local test database; never loads .env or production data.
  await mongoose.connect(`mongodb://127.0.0.1:27028/stock_test_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-test-secret';
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const user = await User.create({ username: 'test', name: 'Tester', passwordHash: 'unused' });
  const supplier = await Supplier.create({ name: 'ABC Pharma' });
  const account = await Account.create({ name: 'EVC', currentBalanceCents: 100000 });
  const other = await Account.create({ name: 'Other', currentBalanceCents: 100000 });
  const customer = await Customer.create({ name: 'Customer' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...(await response.json()) };
  };
  const row = (name, quantity, costPrice = 1, expiryDate = '2030-01-01') => ({ name, quantity, costPrice, sellingPrice: 2, expiryDate });
  try {
    const paid = await request('/purchases', { supplierId: supplier.id, supplierInvoiceNumber: 'ABC-991', amount: 300, purchaseAccountId: account.id });
    assert.equal(paid.status, 201, JSON.stringify(paid));
    assert.match(paid.data.purchaseNumber, /^PUR-/);
    assert.equal(await InventoryItem.countDocuments(), 0);
    assert.equal((await Account.findById(account.id)).currentBalanceCents, 70000);
    assert.equal((await AccountTransaction.findOne()).balanceBeforeCents, 100000);
    // Purchases are never rejected for insufficient balance: the account is
    // simply allowed to go negative, and never silently split across accounts.
    const overdrawn = await request('/purchases', { supplierId: supplier.id, amount: 800, purchaseAccountId: account.id });
    assert.equal(overdrawn.status, 201, JSON.stringify(overdrawn));
    assert.equal(await Purchase.countDocuments(), 2);
    assert.equal((await Account.findById(account.id)).currentBalanceCents, -10000);
    assert.equal((await Account.findById(other.id)).currentBalanceCents, 100000);
    const first = await request('/stock', { rows: [row('Amoxicillin', 20), row('Ibuprofen', 50)] });
    assert.equal(first.status, 201, JSON.stringify(first));
    assert.equal(await InventoryLot.countDocuments(), 2);
    const second = await request('/stock', { rows: [row('amoxicillin', 100, 1.2, '2031-01-01')] });
    assert.equal(second.status, 201);
    assert.equal(await InventoryItem.countDocuments(), 2);
    const item = await InventoryItem.findOne({ name: 'Amoxicillin' });
    assert.equal(item.quantity, 120);
    const before = await StockEntry.countDocuments();
    const failed = await request('/stock', { rows: [row('Rollback item', 5), { ...row('missing', 5), itemId: new mongoose.Types.ObjectId() }] });
    assert.equal(failed.status, 404);
    assert.equal(await StockEntry.countDocuments(), before);
    assert.equal(await InventoryItem.countDocuments({ name: 'Rollback item' }), 0);
    const draft = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 50 }], paidAmount: 0 });
    assert.equal(draft.status, 201, JSON.stringify(draft));
    assert.equal((await InventoryItem.findById(item.id)).quantity, 120);
    const sale = await Sale.findById(draft.data.id);
    assert.deepEqual(sale.items[0].batchReservations.map(a => a.quantity), [20, 30]);
    await closeDay({ user });
    const confirmed = await Sale.findById(sale.id);
    // Weighted Average Cost, not a FIFO lot blend: after the two receipts
    // (20@$1.00, then 100@$1.20), the item's WAC is
    // (20*100 + 100*120) / 120 = 14000/120 = 116.66... -> rounds to 117
    // cents ($1.17). The sale confirms 50 units at that snapshot:
    // 50 * 117 = 5850, regardless of which physical lots FEFO happened to
    // draw from for quantity/expiry purposes.
    assert.equal(confirmed.costOfGoodsCents, 5850);
    assert.equal((await InventoryItem.findById(item.id)).quantity, 70);
    assert.equal((await InventoryItem.findById(item.id)).reservedQuantity, 0);
    // Close Day now gates on an explicit OPEN/CLOSED business-day state --
    // a second close attempt without an Open Day in between is rejected
    // outright, regardless of whether any drafts exist.
    await assert.rejects(() => closeDay({ user }), /already closed/);
    await openDay({ user });
    const cancelDraft = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 70 }] });
    assert.equal(cancelDraft.status, 201);
    assert.equal((await request(`/sales/${cancelDraft.data.id}/cancel`, {})).status, 200);
    assert.equal((await InventoryItem.findById(item.id)).reservedQuantity, 0);
    const sellOut = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 70 }] });
    assert.equal(sellOut.status, 201);
    await closeDay({ user });
    assert.equal((await InventoryItem.findById(item.id)).quantity, 0);
    const restock = await request('/stock', { rows: [{ ...row('Amoxicillin', 100, 1.3, '2032-01-01'), itemId: item.id }] });
    assert.equal(restock.status, 201);
    assert.equal(await InventoryItem.countDocuments({ name: 'Amoxicillin' }), 1);
    const detail = await request(`/inventory/${item.id}`, null, 'GET');
    assert.equal(detail.data.timesStocked, 3);
    assert.equal(detail.data.totalReceived, 220);
    assert.equal(detail.data.availableQuantity, 100);
    assert.ok(detail.data.stockEvents.some(e => e.type === 'OUT_OF_STOCK'));
    assert.equal(detail.data.batches.find(b => b.stockSerial === first.data.stockSerial).unitCostCents, 100);
    const found = await request(`/stock?q=${first.data.stockSerial}`, null, 'GET');
    assert.equal(found.data[0].rows.length, 2);
    const competing = await Promise.all([request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 80 }] }), request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 80 }] })]);
    assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
    const winner = competing.find(r => r.status === 201);
    const edited = await request(`/sales/${winner.data.id}`, { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }] }, 'PUT');
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal((await InventoryItem.findById(item.id)).reservedQuantity, 5);
    await InventoryLot.updateMany({ item: item.id, remainingQuantity: { $gt: 0 } }, { $set: { expiryDate: new Date('2020-01-01') } });
    await openDay({ user });
    await assert.rejects(() => closeDay({ user }), /expired or is unavailable/);
    assert.equal((await InventoryItem.findById(item.id)).quantity, 100);
    assert.equal((await request(`/sales/${winner.data.id}/cancel`, {})).status, 200);
    const expired = await request('/stock', { rows: [row('Expired only', 100, 1, '2020-01-01')] });
    const expiredId = expired.data.rows[0].item;
    assert.equal((await request('/sales', { customerId: customer.id, items: [{ itemId: expiredId, quantity: 1 }] })).status, 409);
    const search = await request('/inventory/search?q=Expired', null, 'GET');
    assert.equal(search.data[0].availableQuantity, 0);
    const concurrent = await Promise.all([request('/stock', { rows: [row('Concurrent new', 5)] }), request('/stock', { rows: [row('Concurrent new', 5)] })]);
    assert.ok(concurrent.every(r => r.status === 201), JSON.stringify(concurrent));
    assert.equal(await InventoryItem.countDocuments({ name: 'Concurrent new' }), 1);
    assert.equal((await InventoryItem.findOne({ name: 'Concurrent new' })).quantity, 10);
    // Concurrent purchases against the same (already-negative) account both
    // succeed -- overdraft is allowed -- and neither debit is lost to a race.
    const payments = await Promise.all([request('/purchases', { supplierId: supplier.id, amount: 500, purchaseAccountId: account.id }), request('/purchases', { supplierId: supplier.id, amount: 500, purchaseAccountId: account.id })]);
    assert.deepEqual(payments.map(p => p.status).sort(), [201, 201]);
    // Not -110000: Close Day now resets every operational Account to $0
    // (with an auditable ADJUSTMENT transaction) each time it runs, and it
    // ran twice above -- so this account's balance is just these two -$500
    // purchases made since the second reset (each fully paid, since
    // amountPaid was omitted), not an accumulation all the way back to
    // before either close.
    assert.equal((await Account.findById(account.id)).currentBalanceCents, -100000);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
