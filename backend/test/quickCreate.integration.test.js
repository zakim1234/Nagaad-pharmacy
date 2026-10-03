import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Category from '../src/models/Category.js';
import InventoryItem from '../src/models/InventoryItem.js';
import InventoryLot from '../src/models/InventoryLot.js';
import StockEntry from '../src/models/StockEntry.js';
import AuditLog from '../src/models/AuditLog.js';

test('POS QUICK-CREATE -- permission gate, item + opening stock in one step, validation, duplicates, usable in a sale', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/quick_create_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-quick-create-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const plain = await User.create({ username: 'plain', name: 'Plain Cashier', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
  const trusted = await User.create({ username: 'trusted', name: 'Trusted Cashier', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'createItems'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const tokenFor = (u) => jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST', user = admin) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(user)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const customer = await Customer.create({ name: 'Walk-in', phone: '999' });
    const category = await Category.create({ name: 'Supplements' });
    const good = { name: '  Zinc   Tablets  ', sellingPrice: 2.5, initialQuantity: 12, cost: 1.2, categoryId: category.id };

    // Permission: a plain cashier (even with POS access) is refused everywhere; nothing is created.
    assert.equal((await request('/quick-items', good, 'POST', plain)).status, 403);
    assert.equal((await request('/quick-items/categories', null, 'GET', plain)).status, 403);
    assert.equal(await InventoryItem.countDocuments(), 0);

    // A user with "Can create items" -- and no Categories module -- can still list categories and create.
    const cats = await request('/quick-items/categories', null, 'GET', trusted);
    assert.equal(cats.status, 200);
    assert.deepEqual(cats.data.map((c) => c.name), ['Supplements']);

    const created = await request('/quick-items', good, 'POST', trusted);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.name, 'Zinc Tablets', 'name is trimmed and whitespace-collapsed');
    assert.match(created.data.itemCode, /^ITM-\d{6}$/);
    assert.equal(created.data.quantity, 12);
    assert.equal(created.data.availableQuantity, 12);
    assert.equal(created.data.sellingPrice, 2.5);
    assert.equal(created.data.costPrice, 1.2);

    // It really is in Stock: item quantity, Weighted Average Cost seeded from the typed cost, a lot, and a Stock Entry.
    const item = await InventoryItem.findById(created.data.id);
    assert.equal(item.quantity, 12);
    assert.equal(item.costPriceCents, 120);
    assert.equal(item.sellingPriceCents, 250);
    assert.equal(String(item.category), category.id);
    assert.equal(item.stockEvents.length, 1);
    assert.equal(item.stockEvents[0].quantityAfter, 12);
    assert.equal(item.stockEvents[0].averageCostAfterCents, 120);
    const lots = await InventoryLot.find({ item: item._id });
    assert.equal(lots.length, 1);
    assert.equal(lots[0].remainingQuantity, 12);
    assert.equal(lots[0].unitCostCents, 120);
    const entries = await StockEntry.find();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].rows.length, 1);
    assert.equal(String(entries[0].createdBy), String(trusted._id));
    const audit = await AuditLog.findOne({ action: 'inventory.quickCreate' });
    assert.equal(audit.userName, 'Trusted Cashier');

    // Cost is optional: omitted -> 0, and category is optional too.
    const noCost = await request('/quick-items', { name: 'Gauze Roll', sellingPrice: 1, initialQuantity: 3 });
    assert.equal(noCost.status, 201, JSON.stringify(noCost));
    assert.equal(noCost.data.costPrice, 0);
    assert.equal((await InventoryItem.findById(noCost.data.id)).category, null);

    // Validation: every bad request is refused and creates nothing (no item, no stock entry).
    const itemsBefore = await InventoryItem.countDocuments();
    const entriesBefore = await StockEntry.countDocuments();
    const bad = [
      { ...good, name: '   ' },
      { ...good, name: 'x'.repeat(201) },
      { ...good, name: 'Bad A', sellingPrice: '' },
      { ...good, name: 'Bad B', sellingPrice: -1 },
      { ...good, name: 'Bad C', sellingPrice: 'abc' },
      { ...good, name: 'Bad D', initialQuantity: 0 },
      { ...good, name: 'Bad E', initialQuantity: 1.5 },
      { ...good, name: 'Bad F', initialQuantity: -3 },
      { ...good, name: 'Bad G', initialQuantity: undefined },
      { ...good, name: 'Bad H', cost: -1 },
      { ...good, name: 'Bad I', categoryId: new mongoose.Types.ObjectId().toString() },
    ];
    for (const body of bad) assert.equal((await request('/quick-items', body)).status, 400, JSON.stringify(body));
    assert.equal(await InventoryItem.countDocuments(), itemsBefore);
    assert.equal(await StockEntry.countDocuments(), entriesBefore);

    // Duplicates are refused (case-insensitively) rather than silently topping up the existing item --
    // including an inactive one that the POS search would not have shown.
    const dup = await request('/quick-items', { ...good, name: 'ZINC tablets' });
    assert.equal(dup.status, 409, JSON.stringify(dup));
    await InventoryItem.updateOne({ name: 'Gauze Roll' }, { status: 'inactive' });
    const dupInactive = await request('/quick-items', { name: 'gauze roll', sellingPrice: 1, initialQuantity: 1 });
    assert.equal(dupInactive.status, 409);
    assert.match(dupInactive.message, /inactive/i);
    assert.equal((await InventoryItem.findById(created.data.id)).quantity, 12, 'the existing item was not topped up');
    assert.equal(await StockEntry.countDocuments(), entriesBefore);

    // The new item behaves like any other in a sale: it can be sold up to what was stocked, not beyond.
    const sold = await request('/sales', { customerId: customer.id, items: [{ itemId: created.data.id, quantity: 12 }] }, 'POST', trusted);
    assert.equal(sold.status, 201, JSON.stringify(sold));
    const oversold = await request('/sales', { customerId: customer.id, items: [{ itemId: created.data.id, quantity: 1 }] }, 'POST', trusted);
    assert.equal(oversold.status, 409, 'all 12 units are reserved by the first draft');

    // Regression: the Stock page (same shared receipt code) still creates and tops up items,
    // and does not honour a categoryId smuggled into its rows.
    const stockIn = await request('/stock', { rows: [{ name: 'Plaster Box', quantity: 10, costPrice: 2, sellingPrice: 3, categoryId: category.id }] });
    assert.equal(stockIn.status, 201, JSON.stringify(stockIn));
    const plaster = await InventoryItem.findOne({ name: 'Plaster Box' });
    assert.equal(plaster.quantity, 10);
    assert.equal(plaster.category, null);
    const topUp = await request('/stock', { rows: [{ itemId: plaster.id, quantity: 10, costPrice: 4, sellingPrice: 3 }] });
    assert.equal(topUp.status, 201);
    const after = await InventoryItem.findById(plaster.id);
    assert.equal(after.quantity, 20);
    assert.equal(after.costPriceCents, 300, 'Weighted Average Cost still blends: (10*2 + 10*4) / 20');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
