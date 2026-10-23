import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Supplier from '../src/models/Supplier.js';
import Account from '../src/models/Account.js';
import SupplierInvoiceArchive from '../src/models/SupplierInvoiceArchive.js';

test('INVOICE NUMBER -- unique per supplier: 1155 for Cali and for Cumar, never twice for one', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/invoice_per_supplier_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-invoice-per-supplier-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await SupplierInvoiceArchive.syncIndexes(); // the real unique index, as at startup
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cali = await Supplier.create({ name: 'cali' });
  const cumar = await Supplier.create({ name: 'cumar' });
  const account = await Account.create({ name: 'Cash', currentBalanceCents: 100000 });
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
  const archive = (supplierId, serialNumber = '1155') =>
    request('/supplier-invoice-archives', { serialNumber, supplierId, rows: [{ itemName: 'Biotin', quantity: 10, cost: 5 }] });

  try {
    const forCali = await archive(cali.id);
    assert.equal(forCali.status, 201, JSON.stringify(forCali));

    // The same number for a different supplier is fine.
    const forCumar = await archive(cumar.id);
    assert.equal(forCumar.status, 201, JSON.stringify(forCumar));

    // Never twice for the same supplier.
    const again = await archive(cali.id);
    assert.equal(again.status, 409);
    assert.match(again.message, /1155.*cali/);

    // Nor as a purchase invoice for that supplier.
    const purchase = await request('/purchases', { supplierId: cali.id, supplierInvoiceNumber: '1155', amount: 20, amountPaid: 0, purchaseAccountId: account.id });
    assert.equal(purchase.status, 409, JSON.stringify(purchase));

    // Editing an archive keeps its own number; moving it onto Cumar's 1155 is refused.
    const keep = await request(`/supplier-invoice-archives/${forCali.data.id}`, { serialNumber: '1155', supplierId: cali.id, rows: [{ itemName: 'Biotin', quantity: 12, cost: 5 }] }, 'PUT');
    assert.equal(keep.status, 200, JSON.stringify(keep));
    const move = await request(`/supplier-invoice-archives/${forCali.data.id}`, { serialNumber: '1155', supplierId: cumar.id, rows: [{ itemName: 'Biotin', quantity: 12, cost: 5 }] }, 'PUT');
    assert.equal(move.status, 409);

    // The purchase invoice that an archive created can still be edited with its own number.
    const linked = await SupplierInvoiceArchive.findById(forCali.data.id);
    assert.ok(linked.purchase, 'the archive created a purchase invoice');
    const editPurchase = await request(`/purchases/${linked.purchase}`, { supplierId: cali.id, supplierInvoiceNumber: '1155', amount: 60 }, 'PUT');
    assert.equal(editPurchase.status, 200, JSON.stringify(editPurchase));

    // A new number for Cali works.
    assert.equal((await archive(cali.id, '1156')).status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
