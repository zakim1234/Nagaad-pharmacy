import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Sale from '../src/models/Sale.js';
import StockEntry from '../src/models/StockEntry.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('partial return, full cancel-after-return, and stock external serial search', { timeout: 120000 }, async () => {
  let server;
  await mongoose.connect(`mongodb://127.0.0.1:27028/returns_test_${Date.now()}?replicaSet=stocktest`);
  try {
    process.env.JWT_SECRET = 'isolated-returns-test';
    await Promise.all(Object.values(mongoose.models).map(m => m.init()));
    const user = await User.create({ username: 'tester', name: 'Tester', passwordHash: 'unused', role: 'admin' });
    const customer = await Customer.create({ name: 'Ayaan', phone: '123' });
    const account = await Account.create({ name: 'EVC' });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET);
    const request = async (path, body, method = 'POST') => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, ...await r.json() };
    };

    // --- Change 1: shop/supplier external serial number is stored and searchable ---
    const stock = await request('/stock', { rows: [{ name: 'Baramol', quantity: 20, costPrice: 1, sellingPrice: 3, expiryDate: '2035-01-01' }], externalSerialNumber: 'SHOP-8891' });
    assert.equal(stock.status, 201, JSON.stringify(stock));
    assert.equal(stock.data.externalSerialNumber, 'SHOP-8891');
    assert.match(stock.data.stockSerial, /^STK-/);
    const product = await InventoryItem.findOne({ name: 'Baramol' });
    const foundByShopSerial = await request('/stock?q=SHOP-8891', null, 'GET');
    assert.equal(foundByShopSerial.data.length, 1);
    assert.equal(foundByShopSerial.data[0].stockSerial, stock.data.stockSerial);
    assert.equal(await StockEntry.countDocuments({ externalSerialNumber: 'SHOP-8891' }), 1);

    // --- Sale A: unpaid at sale time -- return relieves debt, no refund ---
    const draftA = await request('/sales', { customerId: customer.id, items: [{ itemId: product.id, quantity: 10 }], paidAmount: 0 });
    assert.equal(draftA.status, 201, JSON.stringify(draftA));

    // --- Sale B: fully paid at sale time -- return must refund out of the account ---
    const draftB = await request('/sales', { customerId: customer.id, items: [{ itemId: product.id, quantity: 10 }], paidAmount: 30, paymentAccountId: account.id });
    assert.equal(draftB.status, 201, JSON.stringify(draftB));

    await closeDay({ user });
    const saleA = await Sale.findById(draftA.data.id);
    const saleB = await Sale.findById(draftB.data.id);
    assert.equal(saleA.outstandingCents, 3000);
    assert.equal(saleB.outstandingCents, 0);
    assert.equal((await InventoryItem.findById(product.id)).quantity, 0); // 20 - 10 - 10

    // Cannot return more than sold.
    const overReturn = await request(`/sales/${saleA.id}/return`, { items: [{ itemId: product.id, quantity: 11 }] });
    assert.equal(overReturn.status, 409, JSON.stringify(overReturn));

    // Return 2 of 10 from Sale A ($6): fully absorbed by the still-unpaid balance.
    const returnA = await request(`/sales/${saleA.id}/return`, { items: [{ itemId: product.id, quantity: 2 }], reason: 'Customer changed mind' });
    assert.equal(returnA.status, 200, JSON.stringify(returnA));
    assert.equal(returnA.data.total, 24);
    assert.equal(returnA.data.outstanding, 24);
    assert.equal(returnA.data.items[0].returnedQuantity, 2);
    assert.equal((await InventoryItem.findById(product.id)).quantity, 2);
    assert.equal((await Customer.findById(customer.id)).balanceCents, 2400 + 0); // Sale B fully paid, contributes 0 debt
    assert.equal(returnA.data.returns.length, 1);
    assert.equal(returnA.data.returns[0].debtReduced, 6);
    assert.equal(returnA.data.returns[0].refund, 0);

    // Return 2 of 10 from Sale B ($6): fully paid already, so it must refund from EVC.
    const evcBefore = (await Account.findById(account.id)).currentBalanceCents;
    const returnB = await request(`/sales/${saleB.id}/return`, { items: [{ itemId: product.id, quantity: 2 }], reason: 'Damaged' });
    assert.equal(returnB.status, 200, JSON.stringify(returnB));
    assert.equal(returnB.data.paidAmount, 24);
    assert.equal(returnB.data.total, 24);
    assert.equal(returnB.data.outstanding, 0);
    assert.equal((await Account.findById(account.id)).currentBalanceCents, evcBefore - 600);
    assert.equal(await AccountTransaction.countDocuments({ type: 'REFUND' }), 1);
    assert.equal((await InventoryItem.findById(product.id)).quantity, 4);

    // Cannot return the same units twice.
    const doubleReturn = await request(`/sales/${saleB.id}/return`, { items: [{ itemId: product.id, quantity: 9 }] });
    assert.equal(doubleReturn.status, 409, JSON.stringify(doubleReturn));

    // Fully cancel Sale A's remainder (8 of 10 still outstanding after its return of 2)
    // -- must restore exactly 8, not double-restore the 2 already returned.
    const beforeCancelQty = (await InventoryItem.findById(product.id)).quantity;
    const cancelA = await request(`/sales/${saleA.id}/reverse`, { reason: 'Full cancellation' });
    assert.equal(cancelA.status, 200, JSON.stringify(cancelA));
    assert.equal((await InventoryItem.findById(product.id)).quantity, beforeCancelQty + 8);
    assert.equal((await Sale.findById(saleA.id)).status, 'CANCELLED');

    // Repeated cancellation must not reverse twice.
    const doubleCancel = await request(`/sales/${saleA.id}/reverse`, {});
    assert.equal(doubleCancel.status, 409, JSON.stringify(doubleCancel));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
