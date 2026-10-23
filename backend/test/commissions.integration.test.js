import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Expense from '../src/models/Expense.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('COMMISSIONS -- monthly/yearly % of profit per person, paid as expense before partner sharing, cancellable', { timeout: 120000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/commissions_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-commissions-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin', isSuperAdmin: true });
  const cashier = await User.create({ username: 'cashier', name: 'Faadumo', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
  const branchAdmin = await User.create({ username: 'badmin', name: 'Hodan Admin', passwordHash: 'unused', role: 'admin' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const tokenFor = (u) => jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST', as = admin) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(as)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const year = String(now.getFullYear());
  try {
    const bank = await Account.create({ name: 'Bank', currentBalanceCents: 500000 });
    const customer = await Customer.create({ name: 'Buyer', phone: '1' });
    const item = await InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 1000, sellingPriceCents: 2000 });
    await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 100 }], paidAmount: 0, paymentAccountId: bank.id });
    await closeDay({ user: admin }); // $1,000 profit this month

    const preview = await request(`/commissions/preview?type=month&key=${month}`, null, 'GET');
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(preview.data.baseProfit, 1000);
    assert.deepEqual(preview.data.staff.map((s) => s.name).sort(), ['Admin', 'Faadumo', 'Hodan Admin']);

    // Cashiers cannot pay commission.
    assert.equal((await request('/commissions', { type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: cashier.id, percent: 10 }] }, 'POST', cashier)).status, 403);
    assert.equal((await request('/commissions', { type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: cashier.id, percent: 60 }, { name: 'Guard Cabdi', percent: 50 }] })).status, 400, 'over 100%');

    // Staff commission: paid by the branch admin -- never to an admin.
    const asBranchAdmin = (path, body) => request(path, body, 'POST', branchAdmin);
    assert.equal((await asBranchAdmin('/commissions', { type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: branchAdmin.id, percent: 20 }] })).status, 403);
    assert.equal((await asBranchAdmin('/commissions', { kind: 'ADMIN', type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: branchAdmin.id, percent: 20 }] })).status, 403, 'admin commission is for the Super Admin');

    const bankBefore = (await Account.findById(bank.id)).currentBalanceCents;
    const paid = await asBranchAdmin('/commissions', {
      type: 'month',
      key: month,
      paymentAccountId: bank.id,
      lines: [
        { userId: cashier.id, percent: 10 },
        { name: 'Guard Cabdi', percent: 5 },
      ],
    });
    assert.equal(paid.status, 201, JSON.stringify(paid));
    assert.equal(paid.data.kind, 'STAFF');
    assert.deepEqual(paid.data.lines.map((l) => [l.name, l.percent, l.amount]), [['Faadumo', 10, 100], ['Guard Cabdi', 5, 50]]);

    // Admin commission: only the Super Admin, only to admins.
    assert.equal((await request('/commissions', { kind: 'ADMIN', type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: cashier.id, percent: 5 }] })).status, 400);
    const adminPaid = await request('/commissions', { kind: 'ADMIN', type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: branchAdmin.id, percent: 20 }] });
    assert.equal(adminPaid.status, 201, JSON.stringify(adminPaid));
    assert.equal(adminPaid.data.kind, 'ADMIN');
    assert.equal(adminPaid.data.total, 200);
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, bankBefore - 35000);
    assert.equal(await Expense.countDocuments({ category: 'Commission', status: 'POSTED' }), 3);

    // The base stays "before commission"; the same person can't be paid twice for the month.
    assert.equal((await request(`/commissions/preview?type=month&key=${month}`, null, 'GET')).data.baseProfit, 1000);
    assert.equal((await request('/commissions', { type: 'month', key: month, paymentAccountId: bank.id, lines: [{ userId: cashier.id, percent: 5 }] })).status, 409);
    // A yearly commission is separate from the monthly one.
    const yearly = await request('/commissions', { kind: 'ADMIN', type: 'year', key: year, paymentAccountId: bank.id, lines: [{ userId: branchAdmin.id, percent: 10 }] });
    assert.equal(yearly.status, 201, JSON.stringify(yearly));
    assert.equal(yearly.data.lines[0].amount, 100, '10% of the year profit before commission');

    // Partners share what is left after commission: 1000 - 150 - 200 - 100.
    const share = await request(`/partners/profit-sharing/preview?year=${year}`, null, 'GET');
    assert.equal(share.data.netProfit, 550);

    // Cancel the staff one: the money comes back, partner profit goes back up.
    const cancelled = await request(`/commissions/${paid.data.id}/cancel`, { reason: 'wrong %' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, bankBefore - 30000);
    assert.equal((await request(`/partners/profit-sharing/preview?year=${year}`, null, 'GET')).data.netProfit, 700);
    assert.equal((await request('/commissions', null, 'GET')).data.length, 3);
    assert.equal((await request('/commissions?kind=ADMIN', null, 'GET')).data.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
