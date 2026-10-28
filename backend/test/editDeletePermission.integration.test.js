import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';

// Only the admin edits or deletes saved records; anyone else needs the admin
// to switch on 'editRecords' / 'deleteRecords' for them.
test('EDIT / DELETE PERMISSION -- a cashier cannot edit or delete until the admin allows it', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/edit_delete_perm_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-edit-delete-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cashier = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['customers', 'pos'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path, body, method, as) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(as._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const c = await Customer.create({ name: 'Cali', phone: '111' });

    // Adding is fine; changing or removing is not.
    assert.equal((await request('/customers', { name: 'New one', phone: '222' }, 'POST', cashier)).status, 201);
    const edit = await request(`/customers/${c.id}`, { name: 'Cali X', phone: '111' }, 'PUT', cashier);
    assert.equal(edit.status, 403);
    assert.match(edit.message, /permission to edit/);
    const del = await request(`/customers/${c.id}`, null, 'DELETE', cashier);
    assert.equal(del.status, 403);
    assert.match(del.message, /permission to delete/);
    assert.ok(await Customer.findById(c.id), 'still there');

    // Money on the customer page (withdraw, deposit, pay debt) needs its own switch.
    const evc = await (await import('../src/models/Account.js')).default.create({ name: 'EVC' });
    await Customer.updateOne({ _id: c._id }, { walletBalanceCents: 5000 });
    const wd = await request(`/customers/${c.id}/wallet/withdraw`, { amount: 10, paymentAccountId: evc.id }, 'POST', cashier);
    assert.equal(wd.status, 403);
    assert.equal((await request(`/customers/${c.id}/wallet/deposit`, { amount: 10, paymentAccountId: evc.id }, 'POST', cashier)).status, 403);
    assert.equal((await Customer.findById(c.id)).walletBalanceCents, 5000, 'wallet untouched');
    cashier.permissions.push('customerMoney');
    await cashier.save();
    assert.equal((await request(`/customers/${c.id}/wallet/withdraw`, { amount: 10, paymentAccountId: evc.id }, 'POST', cashier)).status, 201);

    // The admin switches them on.
    cashier.permissions.push('editRecords');
    await cashier.save();
    assert.equal((await request(`/customers/${c.id}`, { name: 'Cali X', phone: '111' }, 'PUT', cashier)).status, 200);
    assert.equal((await request(`/customers/${c.id}`, null, 'DELETE', cashier)).status, 403, 'edit does not allow delete');
    cashier.permissions.push('deleteRecords');
    await cashier.save();
    const withMoney = await request(`/customers/${c.id}`, null, 'DELETE', cashier);
    assert.equal(withMoney.status, 409, 'wallet money left: not deleted');
    await Customer.updateOne({ _id: c._id }, { walletBalanceCents: 0 });
    assert.equal((await request(`/customers/${c.id}`, null, 'DELETE', cashier)).status, 200);

    // A customer with a pending (Draft) invoice cannot be deleted -- Close Day needs them.
    const InventoryItem = (await import('../src/models/InventoryItem.js')).default;
    const item = await InventoryItem.create({ name: 'Zinc', itemCode: 'ZN-1', quantity: 10, costPriceCents: 100, sellingPriceCents: 400 });
    const c3 = await Customer.create({ name: 'Cumar', phone: '444' });
    assert.equal((await request('/sales', { customerId: c3.id, items: [{ itemId: item.id, quantity: 1 }], paidAmount: 0 }, 'POST', admin)).status, 201);
    const pendingDel = await request(`/customers/${c3.id}`, null, 'DELETE', admin);
    assert.equal(pendingDel.status, 409);
    assert.match(pendingDel.message, /pending invoice/);

    // The admin never needs them.
    const c2 = await Customer.create({ name: 'Faadumo', phone: '333' });
    assert.equal((await request(`/customers/${c2.id}`, null, 'DELETE', admin)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
