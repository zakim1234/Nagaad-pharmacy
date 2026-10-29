import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import { closeDay, openDay } from '../src/services/dayCloseService.js';

// A quotation can be written any time, but Accept waits for an open day. A
// cashier accepts or rejects without the 'editRecords' switch -- it is part of
// selling, not an edit.
test('QUOTATION ACCEPT -- only while the day is open; a cashier can accept/reject', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/quote_accept_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-quote-accept-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cashier = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'quotations'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(cashier._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const zinc = await InventoryItem.create({ name: 'zinc', itemCode: 'ZN-1', quantity: 100, costPriceCents: 50, sellingPriceCents: 100 });
    const customer = await Customer.create({ name: 'cumar', phone: '612334477' });
    const payload = { customerId: customer.id, date: new Date().toISOString().slice(0, 10), expiryDate: '2034-12-31', items: [{ itemId: zinc.id, quantity: 20, unitPrice: 1, discount: 0 }], discount: 0, notes: '' };

    // Day closed: the quotation is written, Accept waits, Reject still works.
    await closeDay({ user: admin });
    const q1 = await request('/quotations', payload);
    assert.equal(q1.status, 201, JSON.stringify(q1));
    const early = await request(`/quotations/${q1.data.id}/status`, { status: 'Accepted' }, 'PATCH');
    assert.equal(early.status, 409);
    assert.match(early.message, /Open Day/);
    const q2 = await request('/quotations', payload);
    assert.equal((await request(`/quotations/${q2.data.id}/status`, { status: 'Rejected' }, 'PATCH')).status, 200);

    // Editing a pending quotation needs no 'editRecords' either.
    const q3 = await request('/quotations', payload);
    const edited = await request(`/quotations/${q3.data.id}`, { ...payload, items: [{ itemId: zinc.id, quantity: 25, unitPrice: 1, discount: 0 }] }, 'PUT');
    assert.equal(edited.status, 200, JSON.stringify(edited));

    // Day open: the cashier accepts (no 'editRecords' needed).
    await openDay({ user: admin });
    const ok = await request(`/quotations/${q1.data.id}/status`, { status: 'Accepted' }, 'PATCH');
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.equal(ok.data.status, 'Accepted');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
