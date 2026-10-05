import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import BusinessDay from '../src/models/BusinessDay.js';
import Sale from '../src/models/Sale.js';
import { closeDay } from '../src/services/dayCloseService.js';

function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('POS LOCK -- after Close Day nobody, not even an admin, can sell until the day is opened', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/pos_lock_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-pos-lock-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const token = jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = body != null ? 'POST' : 'GET') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const customer = await Customer.create({ name: 'Cumar', phone: '1' });
    const item = await InventoryItem.create({ name: 'Biotin', itemCode: 'BIO-L', quantity: 100, costPriceCents: 100, sellingPriceCents: 400 });
    const sale = (qty = 1) => ({ customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: 0 });

    // Open day: selling works; leave one draft pending.
    const draft = await request('/sales', sale());
    assert.equal(draft.status, 201, JSON.stringify(draft));

    // A pending draft cannot be edited while the day is closed.
    await BusinessDay.findByIdAndUpdate('current', { status: 'CLOSED' }, { upsert: true });
    const edit = await request(`/sales/${draft.data.id}`, sale(2), 'PUT');
    assert.equal(edit.status, 403, JSON.stringify(edit));
    assert.match(edit.message, /Maalintu waa xiran tahay/);
    await BusinessDay.findByIdAndUpdate('current', { status: 'OPEN' });

    // Close Day: now even the admin is refused.
    await closeDay({ user: admin });
    const blocked = await request('/sales', sale());
    assert.equal(blocked.status, 403, JSON.stringify(blocked));
    assert.match(blocked.message, /nothing can be sold until it is opened/);

    // Converting an accepted quotation into an invoice is selling too.
    const quote = await request('/quotations', { customerId: customer.id, date: localDay(), expiryDate: '2034-12-31', items: [{ itemId: item.id, quantity: 1, unitPrice: 4, discount: 0 }], discount: 0, grandTotal: 0 });
    assert.equal(quote.status, 201, JSON.stringify(quote));
    assert.equal((await request(`/quotations/${quote.data.id}/status`, { status: 'Accepted' }, 'PATCH')).status, 200);
    assert.equal((await request(`/quotations/${quote.data.id}/convert`, {})).status, 403);
    assert.equal(await Sale.countDocuments({ status: 'DRAFT' }), 0, 'nothing new was created');

    // Open the Day: selling works again.
    assert.equal((await request('/day-close/open', {})).status, 200);
    assert.equal((await request('/sales', sale())).status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
