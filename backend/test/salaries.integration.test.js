import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Expense from '../src/models/Expense.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-salary-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
  const cashier = await User.create({ username: 'cashier', name: 'Cashier Ali', passwordHash: 'unused', role: 'cashier', permissions: ['expenses'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const as = (user) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  return { server, admin, cashier, request: as(admin), asCashier: as(cashier) };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

test('SALARIES -- sheet of users, pay all at once as Salaries expenses, cancel refunds', { timeout: 90000 }, async () => {
  const { server, admin, cashier, request, asCashier } = await setup('salaries');
  try {
    const evc = await Account.create({ name: 'EVC Plus' });
    const sheet = await request('/salaries/sheet');
    assert.equal(sheet.status, 200, JSON.stringify(sheet));
    assert.deepEqual(sheet.data.people.map((p) => p.name), ['Admin', 'Cashier Ali']);
    assert.equal((await asCashier('/salaries/sheet')).status, 403, 'salaries are admin/manager only');

    assert.equal((await request('/salaries/sheet', { period: '2026-13', rows: [] }, 'PUT')).status, 400);
    const saved = await request('/salaries/sheet', { period: '2026-10', rows: [{ userId: admin.id, amount: 0 }, { userId: cashier.id, amount: 300 }] }, 'PUT');
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.match(saved.data.sheetNumber, /^SAL-\d{4}-\d{6}$/);
    assert.equal(saved.data.rows.length, 1, 'zero lines dropped');
    const again = await request('/salaries/sheet', { period: '2026-10', rows: [{ userId: admin.id, amount: 500 }, { userId: cashier.id, amount: 300 }] }, 'PUT');
    assert.equal(again.data.sheetNumber, saved.data.sheetNumber, 'same open sheet');
    assert.equal(again.data.total, 800);

    const paid = await request('/salaries/sheet/pay', { paymentAccountId: evc.id });
    assert.equal(paid.status, 200, JSON.stringify(paid));
    assert.equal(paid.data.status, 'PAID');
    assert.ok(paid.data.rows.every((r) => /^EXP-/.test(r.expenseNumber)));
    const expenses = await Expense.find({ status: 'POSTED' });
    assert.deepEqual(expenses.map((e) => [e.category, e.amountCents]).sort(), [['Salaries', 30000], ['Salaries', 50000]]);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, -80000);
    assert.equal((await request('/salaries/sheet/pay', { paymentAccountId: evc.id })).status, 400, 'nothing left to pay');

    const list = await request('/salaries/sheets');
    assert.equal(list.data[0].status, 'PAID');

    const cancelled = await request(`/salaries/sheets/${paid.data.id}/cancel`, { reason: 'wrong month' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
    assert.equal(cancelled.data.refunded, 800);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0);
    assert.equal(await Expense.countDocuments({ status: 'VOIDED' }), 2);
    assert.equal((await request(`/salaries/sheets/${paid.data.id}/cancel`, {})).status, 409);

    // Next month starts a new sheet; the last paid one is offered to pre-fill.
    const next = await request('/salaries/sheet');
    assert.equal(next.data.open, null);
  } finally {
    await teardown(server);
  }
});

test('SALARY STATEMENT -- everyone or one person; cancelled sheets left out', { timeout: 90000 }, async () => {
  const { server, admin, cashier, request } = await setup('salary_statement');
  try {
    const evc = await Account.create({ name: 'EVC Plus' });
    const payMonth = async (period, a, c, date) => {
      await request('/salaries/sheet', { period, rows: [{ userId: admin.id, amount: a }, { userId: cashier.id, amount: c }] }, 'PUT');
      return request('/salaries/sheet/pay', { paymentAccountId: evc.id, paymentDate: date });
    };
    await payMonth('2026-08', 500, 300, '2026-08-30');
    await payMonth('2026-09', 500, 350, '2026-09-30');
    const wrong = await payMonth('2026-10', 999, 999, '2026-10-05');
    await request(`/salaries/sheets/${wrong.data.id}/cancel`, {});

    const all = await request('/salaries/statement');
    assert.equal(all.status, 200, JSON.stringify(all));
    assert.equal(all.data.lines.length, 4, 'cancelled month left out');
    assert.equal(all.data.total, 1650);
    assert.deepEqual(all.data.people.map((p) => [p.name, p.payments, p.total]), [['Admin', 2, 1000], ['Cashier Ali', 2, 650]]);

    const one = await request(`/salaries/statement?userId=${cashier.id}`);
    assert.deepEqual(one.data.lines.map((l) => [l.period, l.amount]), [['2026-08', 300], ['2026-09', 350]]);
    assert.equal(one.data.total, 650);

    const sept = await request('/salaries/statement?from=2026-09-01&to=2026-09-30');
    assert.equal(sept.data.total, 850);
  } finally {
    await teardown(server);
  }
});
