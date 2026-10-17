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
import Quotation from '../src/models/Quotation.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('ITEM RENAME -- correcting a misspelt item name also corrects every past invoice with it', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/item_rename_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-item-rename-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const token = jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const customer = await Customer.create({ name: 'Cali', phone: '1' });
    const account = await Account.create({ name: 'Cash' });
    const wrong = await InventoryItem.create({ name: 'prmol', itemCode: 'P-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 300 });
    const other = await InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 300 });

    // Two invoices sold under the misspelt name, one with another item too.
    const s1 = await request('/sales', { customerId: customer.id, items: [{ itemId: wrong.id, quantity: 2 }, { itemId: other.id, quantity: 1 }], paidAmount: 9, paymentAccountId: account.id });
    const s2 = await request('/sales', { customerId: customer.id, items: [{ itemId: wrong.id, quantity: 1 }], paidAmount: 3, paymentAccountId: account.id });
    assert.equal(s1.status, 201, JSON.stringify(s1));
    assert.equal(s2.status, 201, JSON.stringify(s2));
    await closeDay({ user: admin });
    await Sale.updateOne({ _id: s1.data.id }, { $push: { returns: { items: [{ item: wrong._id, itemName: 'prmol', quantity: 1, unitPriceCents: 300 }], amountCents: 300 } } });
    const quote = await request('/quotations', { customerId: customer.id, date: new Date().toISOString().slice(0, 10), expiryDate: '2034-12-31', items: [{ itemId: wrong.id, quantity: 1, unitPrice: 3, discount: 0 }], discount: 0, grandTotal: 0 });
    assert.equal(quote.status, 201, JSON.stringify(quote));
    const before = await Sale.findById(s1.data.id).lean();

    const res = await request(`/inventory/${wrong.id}`, { name: 'Baramol' }, 'PUT');
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal(res.data.name, 'Baramol');

    const after1 = await Sale.findById(s1.data.id).lean();
    const after2 = await Sale.findById(s2.data.id).lean();
    assert.deepEqual(after1.items.map((l) => l.itemName), ['Baramol', 'Bio'], 'only the renamed item changes');
    assert.equal(after2.items[0].itemName, 'Baramol');
    assert.equal(after1.returns[0].items[0].itemName, 'Baramol');
    assert.equal((await Quotation.findById(quote.data.id)).items[0].itemName, 'Baramol');
    // Nothing else on the invoice moves.
    assert.equal(after1.totalCents, before.totalCents);
    assert.equal(after1.items[0].quantity, before.items[0].quantity);

    // Reports now show one item under the right name.
    const report = await request('/reports/sales?range=month', null, 'GET');
    const names = report.data.topByQuantity.map((r) => r.name);
    assert.ok(names.includes('Baramol') && !names.includes('prmol'), JSON.stringify(names));

    // Saving again with the same name changes nothing.
    assert.equal((await request(`/inventory/${wrong.id}`, { name: 'Baramol' }, 'PUT')).renamedDocuments, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
