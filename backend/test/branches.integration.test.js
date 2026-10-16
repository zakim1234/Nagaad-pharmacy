import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Branch from '../src/models/Branch.js';
import Account from '../src/models/Account.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import { clearBranchCache } from '../src/middleware/auth.js';
import { runWithBranch } from '../src/services/branchContext.js';
import { closeDay } from '../src/services/dayCloseService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-branch-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const hodan = await Branch.create({ name: 'Hodan Branch' });
  const bakaal = await Branch.create({ name: 'Bakaal Branch' });
  clearBranchCache();
  const owner = await User.create({ username: 'owner', name: 'Owner', passwordHash: 'unused', role: 'admin', isSuperAdmin: true });
  const hodanAdmin = await User.create({ username: 'hodan', name: 'Hodan Admin', passwordHash: 'unused', role: 'admin', branch: hodan._id });
  const bakaalAdmin = await User.create({ username: 'bakaal', name: 'Bakaal Admin', passwordHash: 'unused', role: 'admin', branch: bakaal._id });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const as = (user, branchId) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}) },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  return { server, hodan, bakaal, owner, hodanAdmin, bakaalAdmin, as };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  clearBranchCache();
}

test('BRANCHES -- each branch sees only its own data; the Super Admin switches between them', { timeout: 120000 }, async () => {
  const { server, hodan, bakaal, owner, hodanAdmin, bakaalAdmin, as } = await setup('branches_iso');
  try {
    const H = as(hodanAdmin);
    const K = as(bakaalAdmin);

    // The same customer name is fine in two branches; each gets its own record.
    const hc = await H('/customers', { name: 'Cali Muuse', phone: '615000001' });
    const kc = await K('/customers', { name: 'Cali Muuse', phone: '615000001' });
    assert.equal(hc.status, 201, JSON.stringify(hc));
    assert.equal(kc.status, 201, JSON.stringify(kc));
    assert.equal((await Customer.findById(hc.data.id)).branch.toString(), hodan.id);
    assert.equal((await Customer.findById(kc.data.id)).branch.toString(), bakaal.id);

    // Hodan can't see or open Bakaal's customer.
    const hList = await H('/customers');
    assert.deepEqual(hList.data.map((c) => c.id), [hc.data.id]);
    assert.equal((await H(`/customers/${kc.data.id}`)).status, 404);

    // The same account name in both branches.
    await runWithBranch(hodan._id, () => Account.create({ name: 'EVC Plus' }));
    await runWithBranch(bakaal._id, () => Account.create({ name: 'EVC Plus' }));
    assert.equal((await H('/accounts')).data.accounts.length, 1);

    // Items (same code) are per branch too.
    await runWithBranch(hodan._id, () => InventoryItem.create({ name: 'Panadol', itemCode: 'P-1', quantity: 10, costPriceCents: 100, sellingPriceCents: 200 }));
    await runWithBranch(bakaal._id, () => InventoryItem.create({ name: 'Panadol', itemCode: 'P-1', quantity: 3, costPriceCents: 100, sellingPriceCents: 200 }));

    // Super Admin: sees the branch they switched to.
    assert.deepEqual((await as(owner, bakaal._id)('/customers')).data.map((c) => c.id), [kc.data.id]);
    assert.deepEqual((await as(owner, hodan._id)('/customers')).data.map((c) => c.id), [hc.data.id]);

    // Users: a branch admin sees only their branch's users; the Super Admin everyone.
    assert.deepEqual((await H('/users')).data.map((u) => u.username), ['hodan']);
    assert.equal((await as(owner)('/users')).data.length, 3);
    assert.equal((await H(`/users/${bakaalAdmin.id}`, { name: 'x' }, 'PUT')).status, 404, 'cannot edit another branch user');

    // Branch management is Super Admin only.
    assert.equal((await H('/branches', { name: 'Not allowed' })).status, 403);
    const created = await as(owner)('/branches', { name: 'Wadajir Branch' });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.deepEqual((await as(owner)('/branches')).data.map((b) => b.name), ['Hodan Branch', 'Bakaal Branch', 'Wadajir Branch']);
    assert.equal((await H('/branches')).data.length, 1, 'a branch admin sees only their branch');
  } finally {
    await teardown(server);
  }
});

test('BRANCHES -- day close is per branch; the Super Admin dashboard adds every branch up', { timeout: 120000 }, async () => {
  const { server, hodan, bakaal, owner, hodanAdmin, bakaalAdmin, as } = await setup('branches_dash');
  try {
    for (const [branch, admin, qty] of [[hodan, hodanAdmin, 4], [bakaal, bakaalAdmin, 2]]) {
      const account = await runWithBranch(branch._id, () => Account.create({ name: 'Cash' }));
      const item = await runWithBranch(branch._id, () => InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 500, sellingPriceCents: 1000 }));
      const customer = await runWithBranch(branch._id, () => Customer.create({ name: 'Buyer', phone: '1' }));
      const sale = await as(admin)('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: 0, paymentAccountId: account.id });
      assert.equal(sale.status, 201, JSON.stringify(sale));
    }

    // Closing Hodan's day leaves Bakaal open.
    await runWithBranch(hodan._id, () => closeDay({ user: hodanAdmin }));
    const hodanDay = await as(hodanAdmin)('/day-close/status');
    const bakaalDay = await as(bakaalAdmin)('/day-close/status');
    assert.equal(hodanDay.data.status, 'CLOSED', JSON.stringify(hodanDay));
    assert.equal(bakaalDay.data.status, 'OPEN', JSON.stringify(bakaalDay));
    await runWithBranch(bakaal._id, () => closeDay({ user: bakaalAdmin }));

    const dash = await as(owner)('/branches/dashboard?range=month');
    assert.equal(dash.status, 200, JSON.stringify(dash));
    const byName = Object.fromEntries(dash.data.branches.map((b) => [b.name, b]));
    assert.equal(byName['Hodan Branch'].sales, 40);
    assert.equal(byName['Bakaal Branch'].sales, 20);
    assert.equal(dash.data.totals.sales, 60);
    assert.equal(dash.data.totals.customerDebt, 60);
    assert.equal(byName['Hodan Branch'].stockValue, 480);
    assert.equal(dash.data.totals.stockValue, 480 + 490);
    assert.equal((await as(hodanAdmin)('/branches/dashboard')).status, 403, 'branch admins never see the all-branch dashboard');
  } finally {
    await teardown(server);
  }
});

test('BRANCHES -- Super Admin reports in the all-branches view add every branch together', { timeout: 120000 }, async () => {
  const { server, hodan, bakaal, owner, hodanAdmin, bakaalAdmin, as } = await setup('branches_reports');
  try {
    for (const [branch, admin, qty] of [[hodan, hodanAdmin, 4], [bakaal, bakaalAdmin, 2]]) {
      const account = await runWithBranch(branch._id, () => Account.create({ name: 'Cash', currentBalanceCents: 100000 }));
      const item = await runWithBranch(branch._id, () => InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 500, sellingPriceCents: 1000 }));
      const customer = await runWithBranch(branch._id, () => Customer.create({ name: 'Buyer', phone: '1' }));
      const sale = await as(admin)('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: qty * 3, paymentAccountId: account.id });
      assert.equal(sale.status, 201, JSON.stringify(sale));
      await runWithBranch(branch._id, () => closeDay({ user: admin }));
      // Each branch's own expense and supplier debt.
      const exp = await as(admin)('/expenses', { category: 'Rent', amount: qty * 4, paymentAccountId: account.id });
      assert.equal(exp.status, 201, JSON.stringify(exp));
      const supplier = await as(admin)('/suppliers', { name: 'Life Care', phone: '3' });
      const pur = await as(admin)('/purchases', { supplierId: supplier.data.id, amount: qty * 7, amountPaid: 0, purchaseAccountId: account.id });
      assert.equal(pur.status, 201, JSON.stringify(pur));
    }

    const all = as(owner, 'all');
    const sheet = await all('/reports/balance-sheet');
    assert.equal(sheet.status, 200, JSON.stringify(sheet));
    const hodanSheet = await as(owner, hodan._id)('/reports/balance-sheet');
    const bakaalSheet = await as(owner, bakaal._id)('/reports/balance-sheet');
    // Year-end check: every line of the company sheet equals the branches'
    // sheets added together -- Total liabilities & equity included.
    const add = (a, b) => Math.round((a + b) * 100) / 100;
    for (const part of ['assets', 'liabilities', 'equity']) {
      for (const [key, value] of Object.entries(sheet.data[part])) {
        assert.equal(value, add(hodanSheet.data[part][key], bakaalSheet.data[part][key]), `${part}.${key}`);
      }
    }
    assert.equal(sheet.data.totalLiabilitiesAndEquity, add(hodanSheet.data.totalLiabilitiesAndEquity, bakaalSheet.data.totalLiabilitiesAndEquity));
    assert.ok(sheet.data.liabilities.payable > 0 && sheet.data.equity.netIncome !== 0, JSON.stringify(sheet.data));

    const sales = await all('/reports/sales?range=month');
    assert.equal(sales.status, 200, JSON.stringify(sales));
    assert.equal(sales.data.totalSales, 60, JSON.stringify(sales.data));
    assert.equal((await all('/reports/inventory')).status, 200);
    assert.equal((await all('/reports/profit-loss?range=month')).status, 200);
    assert.equal((await all('/reports/expenses?range=month')).status, 200);

    // A branch admin asking for 'all' still sees only their own branch.
    const hodanSales = await as(hodanAdmin, 'all')('/reports/sales?range=month');
    assert.equal(hodanSales.data.totalSales, 40);

    // 'all' never reaches a write: it lands in one branch, not the whole company.
    const cust = await all('/customers', { name: 'Overview Customer', phone: '2' });
    assert.equal(cust.status, 201, JSON.stringify(cust));
    assert.ok((await Customer.findById(cust.data.id)).branch, 'a write always gets a branch');
  } finally {
    await teardown(server);
  }
});

test('BRANCHES -- Super Admin home: today, pending, day status and staff per branch', { timeout: 120000 }, async () => {
  const { server, hodan, bakaal, owner, hodanAdmin, bakaalAdmin, as } = await setup('branches_overview');
  try {
    for (const [branch, admin, qty] of [[hodan, hodanAdmin, 3], [bakaal, bakaalAdmin, 1]]) {
      const account = await runWithBranch(branch._id, () => Account.create({ name: 'Cash' }));
      const item = await runWithBranch(branch._id, () => InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 500, sellingPriceCents: 1000 }));
      const customer = await runWithBranch(branch._id, () => Customer.create({ name: 'Buyer', phone: '1' }));
      await as(admin)('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: 0, paymentAccountId: account.id });
    }
    await runWithBranch(hodan._id, () => closeDay({ user: hodanAdmin })); // Hodan confirmed, Bakaal still pending

    const res = await as(owner)('/branches/overview');
    assert.equal(res.status, 200, JSON.stringify(res));
    const byName = Object.fromEntries(res.data.branches.map((b) => [b.name, b]));
    assert.equal(byName['Hodan Branch'].todaySales, 30);
    assert.equal(byName['Hodan Branch'].dayStatus, 'CLOSED');
    assert.equal(byName['Bakaal Branch'].todaySales, 0);
    assert.equal(byName['Bakaal Branch'].pendingSales, 10);
    assert.equal(byName['Bakaal Branch'].dayStatus, 'OPEN');
    assert.equal(byName['Hodan Branch'].staff, 1);
    assert.equal(res.data.totals.todaySales, 30);
    assert.equal(res.data.totals.pendingSales, 10);
    assert.equal(res.data.days.length, 14);
    assert.equal(res.data.recent.length, 2);
    assert.equal((await as(hodanAdmin)('/branches/overview')).status, 403);
  } finally {
    await teardown(server);
  }
});
