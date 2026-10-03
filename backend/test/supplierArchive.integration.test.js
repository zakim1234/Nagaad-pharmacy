import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Supplier from '../src/models/Supplier.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Account from '../src/models/Account.js';

test('TEST SI7-SI13 -- Supplier Invoice archive: search by serial/supplier, duplicate rejection, grand total, detail, isolation', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/supplier_archive_test_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-supplier-archive-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const supplier = await Supplier.create({ name: 'ABC Pharma Distributors' });
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
    const create = await request('/supplier-invoice-archives', {
      serialNumber: 'SI-585858',
      supplierId: supplier.id,
      rows: [
        { itemName: 'Paracetamol', quantity: 100, cost: 2 },
        { itemName: 'Bandage', quantity: 50, cost: 0.5 },
      ],
      notes: 'paper invoice archive',
    });
    assert.equal(create.status, 201, JSON.stringify(create));
    // SI11: Grand Total = Sigma(qty * cost) = 100*2 + 50*0.5 = 225.
    assert.equal(create.data.grandTotal, 225);

    // SI10: duplicate serial is rejected server-side with a useful message.
    const duplicate = await request('/supplier-invoice-archives', {
      serialNumber: 'SI-585858',
      supplierId: supplier.id,
      rows: [{ itemName: 'Something else', quantity: 1, cost: 1 }],
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate));

    // SI7: search by Shop/Supplier Serial Number.
    const bySerial = await request('/supplier-invoice-archives?q=585858', null, 'GET');
    assert.equal(bySerial.status, 200);
    assert.equal(bySerial.data.length, 1);
    assert.equal(bySerial.data[0].serialNumber, 'SI-585858');

    // SI8: search by supplier name.
    const bySupplierName = await request('/supplier-invoice-archives?q=ABC Pharma', null, 'GET');
    assert.equal(bySupplierName.status, 200);
    assert.equal(bySupplierName.data.length, 1);
    assert.equal(bySupplierName.data[0].id, create.data.id);

    // SI9 (backend side of the no-results state): a genuinely unmatched
    // query returns an empty array, not an error -- the frontend renders
    // "Wax natiijo ah lama helin." for this exact empty-array case.
    const noMatch = await request('/supplier-invoice-archives?q=zzz-nonexistent-zzz', null, 'GET');
    assert.equal(noMatch.status, 200);
    assert.deepEqual(noMatch.data, []);

    // No query at all -- default file-browser view returns everything.
    const browseAll = await request('/supplier-invoice-archives', null, 'GET');
    assert.equal(browseAll.status, 200);
    assert.ok(browseAll.data.some((a) => a.id === create.data.id));

    // SI12: archive detail exactly matches the persisted rows.
    const detail = await request(`/supplier-invoice-archives/${create.data.id}`, null, 'GET');
    assert.equal(detail.status, 200);
    assert.equal(detail.data.rows.length, 2);
    assert.equal(detail.data.rows[0].itemName, 'Paracetamol');
    assert.equal(detail.data.rows[0].total, 200);
    assert.equal(detail.data.rows[1].total, 25);

    // SI13: saving this archive changed Inventory Qty by 0, WAC by 0,
    // Accounts by 0 -- there is no InventoryItem named "Paracetamol"/
    // "Bandage" at all (archive-only, never touches Stock/Inventory), and
    // no account was created or touched.
    assert.equal(await InventoryItem.countDocuments({ name: { $in: ['Paracetamol', 'Bandage'] } }), 0);
    assert.equal(await Account.countDocuments(), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
});
