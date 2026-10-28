import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import { closeDay, openDay } from '../src/services/dayCloseService.js';

// A customer with a credit limit of 300 may owe 300, never 301 -- counting
// what they owe and their pending invoices. Paying is always fine; only an
// admin sets the limit.
test('CREDIT LIMIT -- 300 allowed, 301 refused; pending invoices count; admin only', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/credit_limit_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-credit-limit-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cashier = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'customers', 'editRecords', 'editInvoices'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path, body, method = 'POST', as = admin) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(as._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const sell = (customer, qty, paid = 0, as = cashier, accountId) =>
    request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: paid, paymentAccountId: accountId }, 'POST', as);
  let item;
  try {
    item = await InventoryItem.create({ name: 'Zinc', itemCode: 'ZN-1', quantity: 1000, costPriceCents: 50, sellingPriceCents: 100 }); // $1 each
    const evc = await Account.create({ name: 'EVC' });
    const cali = await Customer.create({ name: 'Cali', phone: '111' });

    // Only the admin sets it.
    assert.equal((await request(`/customers/${cali.id}/credit-limit`, { limit: 300 }, 'PUT', cashier)).status, 403);
    const set = await request(`/customers/${cali.id}/credit-limit`, { limit: 300 }, 'PUT', admin);
    assert.equal(set.status, 200, JSON.stringify(set));
    assert.equal(set.data.creditLimit, 300);

    // 250 on credit (pending), then 51 more is refused, 50 is fine: exactly 300.
    assert.equal((await sell(cali, 250)).status, 201);
    const over = await sell(cali, 51);
    assert.equal(over.status, 400);
    assert.match(over.message, /credit limit is 300\.00/);
    assert.match(over.message, /Take at least 1\.00 more/);
    const fifty = await sell(cali, 50);
    assert.equal(fifty.status, 201, JSON.stringify(fifty));

    // At the limit: paying in full still works; any credit does not.
    assert.equal((await sell(cali, 20, 20, cashier, evc.id)).status, 201, 'cash is fine');
    assert.equal((await sell(cali, 20, 19, cashier, evc.id)).status, 400, '1 on credit is over');

    // After Close Day the debt counts the same way.
    await closeDay({ user: admin });
    await openDay({ user: admin });
    assert.equal((await Customer.findById(cali.id)).balanceCents, 30000);
    assert.equal((await sell(cali, 1)).status, 400);

    // Editing an invoice is checked too, without counting its old credit twice.
    const dawo = await Customer.create({ name: 'Dawo', phone: '222', creditLimitCents: 10000 });
    const draft = await sell(dawo, 100);
    assert.equal(draft.status, 201);
    const sameAgain = await request(`/sales/${draft.data.id}`, { customerId: dawo.id, items: [{ itemId: item.id, quantity: 100 }], paidAmount: 0 }, 'PUT', cashier);
    assert.equal(sameAgain.status, 200, JSON.stringify(sameAgain));
    const bigger = await request(`/sales/${draft.data.id}`, { customerId: dawo.id, items: [{ itemId: item.id, quantity: 101 }], paidAmount: 0 }, 'PUT', cashier);
    assert.equal(bigger.status, 400);

    // Removing the limit lifts it; no limit at all means no check.
    assert.equal((await request(`/customers/${cali.id}/credit-limit`, { limit: null }, 'PUT', admin)).data.creditLimit, null);
    assert.equal((await sell(cali, 500)).status, 201);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
