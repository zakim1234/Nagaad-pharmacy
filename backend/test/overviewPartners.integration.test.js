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

test('OVERVIEW -- partners, zakat, commissions read-only for all branches; year profit shared company-wide', { timeout: 120000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/overview_partners_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-overview-partners-secret';
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
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}`,
        ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}),
      },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const year = new Date().getFullYear();
    let hodanCash;
    for (const [branch, admin, qty, partnerName, capital] of [
      [hodan, hodanAdmin, 40, 'Cali', 60000],
      [bakaal, bakaalAdmin, 20, 'Cumar', 40000],
    ]) {
      const account = await runWithBranch(branch._id, () => Account.create({ name: 'Cash' }));
      if (branch === hodan) hodanCash = account;
      const item = await runWithBranch(branch._id, () => InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 1000, sellingPriceCents: 2000 }));
      const customer = await runWithBranch(branch._id, () => Customer.create({ name: 'Buyer', phone: '1' }));
      const sale = await as(admin)('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: qty }], paidAmount: 0, paymentAccountId: account.id });
      assert.equal(sale.status, 201, JSON.stringify(sale));
      await runWithBranch(branch._id, () => closeDay({ user: admin }));
      const p = await as(admin)('/partners', { name: partnerName });
      assert.equal(p.status, 201, JSON.stringify(p));
      const c = await as(admin)(`/partners/${p.data.id}/contribute`, { amount: capital, paymentAccountId: account.id });
      assert.ok(c.status < 300, JSON.stringify(c));
    }
    const all = as(owner, 'all');

    // Reads cover every branch.
    const partners = await all('/partners');
    assert.equal(partners.status, 200, JSON.stringify(partners));
    assert.deepEqual(partners.data.partners.map((p) => p.name).sort(), ['Cali', 'Cumar']);
    assert.ok(partners.data.partners.every((p) => p.branch), 'each partner says which branch it is in');
    assert.equal((await all('/commissions')).status, 200);
    assert.equal((await all('/zakat/preview')).status, 200);

    // Branch-level changes are refused in the overview.
    assert.equal((await all('/partners', { name: 'Nobody' })).status, 400);
    assert.equal((await all('/commissions', { type: 'year', key: String(year), paymentAccountId: hodanCash.id, lines: [{ name: 'X', percent: 1 }] })).status, 400);

    // Year profit is the whole company: 40*10 + 20*10 = 600, split 60/40 by capital.
    const preview = await all(`/partners/profit-sharing/preview?year=${year}`);
    assert.equal(preview.data.netProfit, 600, JSON.stringify(preview.data));
    const byName = Object.fromEntries(preview.data.partners.map((p) => [p.name, p]));
    assert.deepEqual([byName.Cali.percent, byName.Cumar.percent], [60, 40]);
    const sheetBefore = (await all('/reports/balance-sheet')).data;
    const shared = await all('/partners/profit-sharing', { year, mode: 'CAPITAL', shares: preview.data.partners.map((p) => ({ partnerId: p.id, percent: p.percent })) });
    assert.equal(shared.status, 201, JSON.stringify(shared));
    assert.equal(shared.data.branch, null, 'company-wide');
    assert.deepEqual(shared.data.shares.map((s) => [s.partnerName, s.amount]).sort(), [['Cali', 360], ['Cumar', 240]]);
    const sheetAfter = (await all('/reports/balance-sheet')).data;
    assert.equal(sheetAfter.difference, sheetBefore.difference, 'the company balance sheet still balances');

    // A branch cannot share the same year again.
    const again = await as(hodanAdmin)('/partners/profit-sharing', { year, mode: 'CAPITAL', shares: [{ partnerId: byName.Cali.id, percent: 100 }] });
    assert.equal(again.status, 409, JSON.stringify(again));

    // Cancel it from the overview.
    const cancelled = await all(`/partners/profit-sharing/${shared.data.id}/cancel`, { reason: 'test' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    clearBranchCache();
  }
});
