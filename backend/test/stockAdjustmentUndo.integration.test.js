import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import InventoryLot from '../src/models/InventoryLot.js';
import StockAdjustment from '../src/models/StockAdjustment.js';
import { netAdjustmentValueCents } from '../src/services/stockAdjustmentService.js';

// A save that was wrong can be undone and done again: stock goes back to the
// very batches, the save is kept marked undone and leaves Profit & Loss.
test('STOCK ADJUSTMENT UNDO -- a whole save is put back; sold units block undoing an increase', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/adj_undo_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-adj-undo-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cashier = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['stock', 'pos'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const as = (user) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const request = as(admin);
  try {
    const zinc = await InventoryItem.create({ name: 'zinc', itemCode: 'ZN-1', quantity: 20, costPriceCents: 100, sellingPriceCents: 200 });
    const biotin = await InventoryItem.create({ name: 'biotin', itemCode: 'BT-1', quantity: 10, costPriceCents: 500, sellingPriceCents: 1200 });
    const lotsBefore = async (id) => (await InventoryLot.find({ item: id })).reduce((t, l) => t + l.remainingQuantity, 0);

    // One save: zinc 20 -> 12 (written off 8), biotin 10 -> 13 (+3).
    const count = await request('/stock-adjustments/count', { rows: [{ itemId: zinc.id, countedQuantity: 12 }, { itemId: biotin.id, countedQuantity: 13 }] });
    assert.equal(count.status, 201, JSON.stringify(count));
    const start = new Date(Date.now() - 86400000);
    const end = new Date(Date.now() + 86400000);
    assert.equal(await netAdjustmentValueCents({ start, end }), 800 - 1500);

    // A cashier cannot undo; the admin can.
    assert.equal((await as(cashier)(`/stock-adjustments/${count.data.countNumber}/reverse`, {})).status, 403);
    const undo = await request(`/stock-adjustments/${count.data.countNumber}/reverse`, { reason: 'Counted wrong' });
    assert.equal(undo.status, 200, JSON.stringify(undo));
    assert.equal((await InventoryItem.findById(zinc.id)).quantity, 20, 'zinc back');
    assert.equal((await InventoryItem.findById(biotin.id)).quantity, 10, 'biotin back');
    assert.equal(await lotsBefore(zinc.id), 20, 'zinc batches back');
    assert.equal(await lotsBefore(biotin.id), 10, 'biotin batches back');
    assert.equal(await netAdjustmentValueCents({ start, end }), 0, 'no longer in Profit & Loss');
    assert.ok((await StockAdjustment.find({ countNumber: count.data.countNumber })).every((r) => r.status === 'REVERSED'));
    assert.equal((await request(`/stock-adjustments/${count.data.countNumber}/reverse`, {})).status, 409, 'only once');

    // It shows as undone, and the totals leave it out.
    const list = await request('/stock-adjustments?group=save');
    assert.equal(list.data.find((x) => x.number === count.data.countNumber).undone, true);
    assert.equal(list.summary.decreaseValue, 0);
    assert.equal((await request(`/stock-adjustments/document/${count.data.countNumber}`)).data.undoReason, 'Counted wrong');

    // An increase whose units are already on an invoice cannot be undone.
    const add = await request('/stock-adjustments', { itemId: zinc.id, direction: 'INCREASE', quantity: 5, reason: 'FOUND' });
    assert.equal(add.status, 201, JSON.stringify(add));
    const customer = await Customer.create({ name: 'Cali', phone: '1' });
    assert.equal((await request('/sales', { customerId: customer.id, items: [{ itemId: zinc.id, quantity: 23 }], paidAmount: 0 })).status, 201);
    const blocked = await request(`/stock-adjustments/${add.data.adjustmentNumber}/reverse`, {});
    assert.equal(blocked.status, 409, JSON.stringify(blocked));
    assert.equal((await InventoryItem.findById(zinc.id)).quantity, 25, 'nothing changed');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
