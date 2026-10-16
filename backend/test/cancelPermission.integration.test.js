import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('CANCEL PERMISSION -- only admins, or someone an admin switched it on for, can cancel invoices', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/cancel_perm_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'cancel-perm-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'x', role: 'admin' });
  const cashier = await User.create({ username: 'cashier', name: 'Cashier', passwordHash: 'x', role: 'cashier', permissions: ['pos', 'customers'] });
  const manager = await User.create({ username: 'manager', name: 'Manager', passwordHash: 'x', role: 'manager', permissions: ['pos', 'customers'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const as = (user) => async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const account = await Account.create({ name: 'Cash' });
    const item = await InventoryItem.create({ name: 'Item', itemCode: 'I-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 500 });
    const customer = await Customer.create({ name: 'C', phone: '1' });
    const sale = (u) => as(u)('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 1 }], paidAmount: 0, paymentAccountId: account.id });

    // Pending invoice: the cashier who made it can't cancel it.
    const draft = await sale(cashier);
    assert.equal(draft.status, 201, JSON.stringify(draft));
    assert.equal((await as(cashier)(`/sales/${draft.data.id}/cancel`, {})).status, 403);
    assert.equal((await as(manager)(`/sales/${draft.data.id}/cancel`, {})).status, 403);

    // The admin switches it on for the cashier: now they can.
    const on = await as(admin)(`/users/${cashier.id}`, { permissions: ['pos', 'customers', 'cancelInvoices'] }, 'PUT');
    assert.equal(on.status, 200, JSON.stringify(on));
    assert.equal((await as(cashier)(`/sales/${draft.data.id}/cancel`, {})).status, 200);

    // Confirmed invoice: manager blocked, admin allowed.
    const second = await sale(admin);
    await closeDay({ user: admin });
    assert.equal((await as(manager)(`/sales/${second.data.id}/reverse`, {})).status, 403);
    assert.equal((await as(admin)(`/sales/${second.data.id}/reverse`, {})).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
