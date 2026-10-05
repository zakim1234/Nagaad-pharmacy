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
import { buildProfitLoss } from '../src/services/profitLossService.js';
import { buildBalanceSheet } from '../src/services/balanceSheetService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-stock-adjustment-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
  const cashier = await User.create({ username: 'cashier', name: 'Cashier', passwordHash: 'unused', role: 'cashier', permissions: ['stock', 'pos'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const requestAs = (user) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  return { server, request: requestAs(admin), asCashier: requestAs(cashier) };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// 15 units at $1.00 average cost: 5 in an expired batch, 10 in a good one.
async function stockedItem() {
  const item = await InventoryItem.create({ name: 'Amoxicillin', itemCode: 'AMX-ADJ', quantity: 15, costPriceCents: 100, sellingPriceCents: 300, unit: 'box' });
  const expired = await InventoryLot.create({ item: item._id, stockSerial: 'ST-OLD', unitCostCents: 100, originalQuantity: 5, remainingQuantity: 5, expiryDate: new Date('2020-01-01') });
  const good = await InventoryLot.create({ item: item._id, stockSerial: 'ST-NEW', unitCostCents: 100, originalQuantity: 10, remainingQuantity: 10, expiryDate: new Date('2099-01-01') });
  return { item, expired, good };
}

test('STOCK ADJUSTMENT -- decrease writes off nearest-expiry batches first and records the value lost', { timeout: 90000 }, async () => {
  const { server, request } = await setup('adj_decrease');
  try {
    const { item, expired, good } = await stockedItem();
    const res = await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 6, reason: 'EXPIRED' });
    assert.equal(res.status, 201, JSON.stringify(res));
    assert.match(res.data.adjustmentNumber, /^ADJ-\d{4}-\d{6}$/);
    assert.equal(res.data.quantityBefore, 15);
    assert.equal(res.data.quantityAfter, 9);
    assert.equal(res.data.value, 6);
    assert.deepEqual(res.data.lots.map((l) => [l.stockSerial, l.quantity]), [['ST-OLD', -5], ['ST-NEW', -1]]);

    const after = await InventoryItem.findById(item.id);
    assert.equal(after.quantity, 9);
    assert.equal(after.costPriceCents, 100, 'average cost is unchanged by a write-off');
    assert.equal(after.stockEvents.at(-1).type, 'ADJUSTMENT_OUT');
    assert.equal(after.stockEvents.at(-1).reference, res.data.adjustmentNumber);
    assert.equal((await InventoryLot.findById(expired.id)).remainingQuantity, 0);
    assert.equal((await InventoryLot.findById(good.id)).remainingQuantity, 9);

    // A specific batch can be chosen.
    const chosen = await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 2, reason: 'DAMAGED', lotId: good.id });
    assert.equal(chosen.status, 201, JSON.stringify(chosen));
    assert.equal((await InventoryLot.findById(good.id)).remainingQuantity, 7);

    // "Other" needs an explanation; reasons must match the direction.
    assert.equal((await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 1, reason: 'OTHER' })).status, 400);
    assert.equal((await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 1, reason: 'FOUND' })).status, 400);
    assert.equal((await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 0, reason: 'LOST' })).status, 400);
  } finally {
    await teardown(server);
  }
});

test('STOCK ADJUSTMENT -- units held by pending invoices cannot be written off', { timeout: 90000 }, async () => {
  const { server, request } = await setup('adj_reserved');
  try {
    const { item } = await stockedItem();
    await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 5, reason: 'EXPIRED' }); // 10 good left
    const customer = await Customer.create({ name: 'Cumar', phone: '1' });
    const draft = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 8 }], paidAmount: 0 });
    assert.equal(draft.status, 201, JSON.stringify(draft));

    const tooMuch = await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 3, reason: 'LOST' });
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.message, /Only 2 box/);
    assert.equal((await InventoryItem.findById(item.id)).quantity, 10, 'nothing changed on a refused adjustment');

    const ok = await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 2, reason: 'LOST' });
    assert.equal(ok.status, 201, JSON.stringify(ok));
  } finally {
    await teardown(server);
  }
});

test('STOCK ADJUSTMENT -- increase adds a new batch at the current average cost', { timeout: 90000 }, async () => {
  const { server, request } = await setup('adj_increase');
  try {
    const { item } = await stockedItem();
    const res = await request('/stock-adjustments', { itemId: item.id, direction: 'INCREASE', quantity: 4, reason: 'FOUND', expiryDate: '2099-06-30' });
    assert.equal(res.status, 201, JSON.stringify(res));
    assert.equal(res.data.quantityAfter, 19);
    assert.equal(res.data.value, 4);

    const lot = await InventoryLot.findOne({ stockSerial: res.data.adjustmentNumber });
    assert.equal(lot.remainingQuantity, 4);
    assert.equal(lot.unitCostCents, 100);
    assert.equal(lot.expiryDate.toISOString().slice(0, 10), '2099-06-30');
    const after = await InventoryItem.findById(item.id);
    assert.equal(after.quantity, 19);
    assert.equal(after.costPriceCents, 100);
    assert.equal(after.stockEvents.at(-1).type, 'ADJUSTMENT_IN');
    assert.equal((await request('/stock-adjustments', { itemId: item.id, direction: 'INCREASE', quantity: 1, reason: 'DAMAGED' })).status, 400);
  } finally {
    await teardown(server);
  }
});

test('STOCK ADJUSTMENT -- net loss shows in Profit & Loss; balance sheet stays consistent; cashiers cannot adjust', { timeout: 90000 }, async () => {
  const { server, request, asCashier } = await setup('adj_reports');
  try {
    const { item } = await stockedItem();
    const before = await buildBalanceSheet();
    await request('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 6, reason: 'EXPIRED' }); // -$6
    await request('/stock-adjustments', { itemId: item.id, direction: 'INCREASE', quantity: 2, reason: 'COUNT_CORRECTION' }); // +$2

    // Local calendar day (the report works in local time; the UTC date is
    // already tomorrow in the evening west of Greenwich).
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const pl = await buildProfitLoss({ from: today, to: today });
    const line = pl.rows.find((r) => r.label === 'Inventory Adjustments');
    assert.equal(line.values.total, 4, 'net $4 written off');
    assert.equal(pl.rows.find((r) => r.label === 'Gross Profit').values.total, -4);

    const after = await buildBalanceSheet();
    assert.equal(after.differenceCents, before.differenceCents, 'inventory and profit move together');

    const list = await request('/stock-adjustments');
    assert.equal(list.data.length, 2);
    assert.equal(list.summary.netLoss, 4);
    assert.equal((await request(`/stock-adjustments/item/${item.id}`)).data.lots.length, 2);

    const denied = await asCashier('/stock-adjustments', { itemId: item.id, direction: 'DECREASE', quantity: 1, reason: 'LOST' });
    assert.equal(denied.status, 403);
    assert.equal((await asCashier('/stock-adjustments')).status, 200, 'cashiers with stock access can still view');
    assert.equal(await StockAdjustment.countDocuments(), 2);
  } finally {
    await teardown(server);
  }
});
