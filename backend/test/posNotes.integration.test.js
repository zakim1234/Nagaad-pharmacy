import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';

test('POS -- sale notes are saved/edited/validated, and item search finds barcode and generic name', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/pos_notes_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-pos-notes-secret';
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
    const customer = await Customer.create({ name: 'Walk-in', phone: '999' });
    const item = await InventoryItem.create({
      name: 'Zinc Tablets (Strip 10)', itemCode: 'ZINC-1', quantity: 12, costPriceCents: 100, sellingPriceCents: 250,
      barcode: '6009876543210', genericName: 'Zinc Sulphate',
    });
    const sale = { customerId: customer.id, items: [{ itemId: item.id, quantity: 2 }] };

    const created = await request('/sales', { ...sale, notes: '  Deliver after 5pm  ' });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.notes, 'Deliver after 5pm', 'notes are trimmed and returned');
    assert.equal((await request(`/sales/${created.data.id}`, null, 'GET')).data.notes, 'Deliver after 5pm');

    // Omitting notes on edit leaves them alone; sending new text replaces them; blank clears them.
    const untouched = await request(`/sales/${created.data.id}`, { ...sale }, 'PUT');
    assert.equal(untouched.status, 200, JSON.stringify(untouched));
    assert.equal(untouched.data.notes, 'Deliver after 5pm');
    assert.equal((await request(`/sales/${created.data.id}`, { ...sale, notes: 'Call first' }, 'PUT')).data.notes, 'Call first');
    assert.equal((await request(`/sales/${created.data.id}`, { ...sale, notes: '' }, 'PUT')).data.notes, '');

    // Sales without notes still work; over-long notes are rejected without creating a sale.
    assert.equal((await request('/sales', sale)).data.notes, '');
    const tooLong = await request('/sales', { ...sale, notes: 'x'.repeat(501) });
    assert.equal(tooLong.status, 400);

    // The POS item search matches barcode (scanner) and generic name, and reports what can still be sold.
    for (const q of ['6009876543210', 'sulphate', 'zinc']) {
      const found = await request(`/inventory/search?q=${encodeURIComponent(q)}`, null, 'GET');
      assert.equal(found.data.length, 1, q);
      assert.equal(found.data[0].name, 'Zinc Tablets (Strip 10)');
      assert.ok(found.data[0].availableQuantity <= 12 && found.data[0].sellingPrice === 2.5);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
