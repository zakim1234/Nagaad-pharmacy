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

// Close Day keeps the money in the accounts. The admin sees what they really
// hold; staff see only what came in since the last Close Day (0 right after
// it). The admin's monthly report shows each person's sales and money by day.
test('ACCOUNTS AFTER CLOSE DAY -- money kept for the admin, staff see only since the last close; staff daily report', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/accounts_after_close_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-accounts-after-close-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const cashier = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'accounts', 'reports', 'customers', 'customerMoney'] });
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
  const balance = async (as, name) => (await request('/accounts', null, 'GET', as)).data.accounts.find((a) => a.name === name);
  try {
    const item = await InventoryItem.create({ name: 'Zinc', itemCode: 'ZN-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 1000 });
    const customer = await Customer.create({ name: 'Cali', phone: '111' });
    const evc = await Account.create({ name: 'EVC Plus' });

    // Day 1: the cashier sells $30, all paid into EVC.
    const s1 = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 3 }], paidAmount: 30, paymentAccountId: evc.id }, 'POST', cashier);
    assert.equal(s1.status, 201, JSON.stringify(s1));
    assert.equal((await balance(cashier, 'EVC Plus')).currentBalance, 30, 'cashier sees the money they took today');
    const before = await request('/sales/my-day', null, 'GET', cashier);
    assert.equal(before.data.totals.invoices, 1);
    assert.equal(before.data.totals.sales, 30);
    assert.deepEqual(before.data.items.map((i) => [i.name, i.quantity, i.total]), [['Zinc', 3, 30]]);
    await closeDay({ user: admin });
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 3000, 'Close Day keeps the money');

    // After the close: the admin sees $30, the cashier sees 0.
    assert.equal((await balance(admin, 'EVC Plus')).currentBalance, 30);
    const staffView = await request('/accounts', null, 'GET', cashier);
    assert.equal(staffView.data.scope, 'own');
    assert.equal((await request('/sales/my-day', null, 'GET', cashier)).data.totals.invoices, 0, 'My Report starts again after Close Day');
    assert.equal(staffView.data.accounts[0].currentBalance, 0);
    assert.equal(staffView.data.totalBalance, 0);
    assert.equal((await request(`/accounts/${evc.id}/transactions`, null, 'GET', cashier)).data.transactions.length, 0, 'nothing before the close');
    const staffReport = await request('/accounts/report?range=month', null, 'GET', cashier);
    assert.equal(staffReport.data.accounts[0].moneyIn, 0);
    assert.equal(staffReport.data.accounts[0].currentBalance, 0);
    assert.equal((await request(`/accounts/${evc.id}/statement?range=month`, null, 'GET', cashier)).data.rows.length, 0);
    assert.equal((await request(`/accounts/${evc.id}/statement?range=month`, null, 'GET', admin)).data.closing, 30);

    // Day 2: a $20 debt payment taken by the cashier is today's money for them.
    await openDay({ user: admin });
    const s2 = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 2 }], paidAmount: 0 }, 'POST', cashier);
    assert.equal(s2.status, 201, JSON.stringify(s2));
    await closeDay({ user: admin });
    await openDay({ user: admin });
    assert.equal((await request(`/customers/${customer.id}/payments`, { amount: 20, paymentAccountId: evc.id }, 'POST', cashier)).status, 201);
    assert.equal((await balance(cashier, 'EVC Plus')).currentBalance, 20, 'cashier: since the last close');
    // Money the admin takes is not the cashier's.
    assert.equal((await request(`/customers/${customer.id}/wallet/deposit`, { amount: 100, paymentAccountId: evc.id }, 'POST', admin)).status, 201);
    assert.equal((await balance(cashier, 'EVC Plus')).currentBalance, 20, 'only their own money');
    const myDay = await request('/sales/my-day', null, 'GET', cashier);
    assert.equal(myDay.data.totals.debtCollected, 20);
    assert.equal(myDay.data.totals.received, 20);
    assert.deepEqual(myDay.data.accounts.map((a) => [a.accountName, a.net]), [['EVC Plus', 20]]);
    // The business as a whole is for the admin only.
    assert.equal((await request('/reports/sales?range=today', null, 'GET', cashier)).status, 403);
    assert.equal((await request('/sales/refunds', null, 'GET', cashier)).status, 403);
    assert.equal((await request('/dashboard', null, 'GET', cashier)).status, 403);
    assert.equal((await balance(admin, 'EVC Plus')).currentBalance, 150, 'admin: all money together');

    // The admin's month: by day and by person.
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    assert.equal((await request(`/reports/staff-daily?month=${month}`, null, 'GET', cashier)).status, 403, 'admin only');
    const rep = await request(`/reports/staff-daily?month=${month}`, null, 'GET', admin);
    assert.equal(rep.status, 200, JSON.stringify(rep));
    const cumar = rep.data.people.find((p) => p.userName === 'Cumar');
    assert.equal(cumar.invoices, 2);
    assert.equal(cumar.sales, 50);
    assert.equal(cumar.paidAtSale, 30);
    assert.equal(cumar.debtCollected, 20);
    assert.equal(cumar.received, 50);
    assert.equal(cumar.credit, 20);
    assert.deepEqual(cumar.byAccount, [{ accountName: 'EVC Plus', amount: 50 }]);
    assert.equal(rep.data.totals.sales, 50);
    // One person only.
    const onlyAdmin = await request(`/reports/staff-daily?month=${month}&userId=${admin.id}`, null, 'GET', admin);
    assert.ok(!onlyAdmin.data.people.some((p) => p.userName === 'Cumar'));
    const onlyCumar = await request(`/reports/staff-daily?month=${month}&userId=${cashier.id}`, null, 'GET', admin);
    assert.deepEqual(onlyCumar.data.people.map((p) => p.userName), ['Cumar']);
    assert.equal(onlyCumar.data.totals.sales, 50);
    assert.ok(rep.data.days.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
