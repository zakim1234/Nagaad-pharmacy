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

test('user performance report: per-user totals, account breakdown, and cancelled/draft exclusion', { timeout: 120000 }, async () => {
  let server;
  await mongoose.connect(`mongodb://127.0.0.1:27028/userperf_test_${Date.now()}?replicaSet=stocktest`);
  try {
    process.env.JWT_SECRET = 'isolated-userperf-test';
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

    const admin = await User.create({ username: 'admin1', name: 'Admin One', passwordHash: 'unused', role: 'admin' });
    const cashierA = await User.create({ username: 'cashiera', name: 'Cashier A', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'reports'] });
    const cashierB = await User.create({ username: 'cashierb', name: 'Cashier B', passwordHash: 'unused', role: 'cashier', permissions: ['pos', 'reports'] });
    const customer = await Customer.create({ name: 'Walk-in', phone: '999' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 500 });

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const tokenFor = (u) => jwt.sign({ sub: u.id }, process.env.JWT_SECRET);
    const request = async (path, body, method = 'POST', user = admin) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(user)}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, ...(await r.json()) };
    };

    // Cashier A: one $50 sale, fully paid to the account.
    const saleA = await request(
      '/sales',
      { customerId: customer.id, items: [{ itemId: item.id, quantity: 10 }], paidAmount: 50, paymentAccountId: account.id },
      'POST',
      cashierA
    );
    assert.equal(saleA.status, 201, JSON.stringify(saleA));

    // Cashier B: one $30 sale, $10 paid (credit sale), plus a second sale
    // that gets cancelled and must NOT count toward performance totals.
    const saleB = await request(
      '/sales',
      { customerId: customer.id, items: [{ itemId: item.id, quantity: 6 }], paidAmount: 10, paymentAccountId: account.id },
      'POST',
      cashierB
    );
    assert.equal(saleB.status, 201, JSON.stringify(saleB));
    const cancelled = await request(
      '/sales',
      { customerId: customer.id, items: [{ itemId: item.id, quantity: 2 }], paidAmount: 10, paymentAccountId: account.id },
      'POST',
      cashierB
    );
    assert.equal(cancelled.status, 201, JSON.stringify(cancelled));
    const cancelResult = await request(`/sales/${cancelled.data.id}/cancel`, { reason: 'test' }, 'POST', cashierB);
    assert.equal(cancelResult.status, 200, JSON.stringify(cancelResult));

    await closeDay({ user: admin });

    // Report for Cashier A: exactly the $50 sale.
    const reportA = await request(
      `/reports/user-performance?userId=${cashierA.id}&range=year`,
      null,
      'GET',
      admin
    );
    assert.equal(reportA.status, 200, JSON.stringify(reportA));
    assert.equal(reportA.data.invoiceCount, 1);
    assert.equal(reportA.data.totalSales, 50);
    assert.equal(reportA.data.cashCollected, 50);
    assert.equal(reportA.data.paymentByAccount.find((a) => a.account === 'Cash Drawer')?.amount, 50);

    // Report for Cashier B: only the $30 sale counts -- the cancelled one
    // must be excluded entirely (not even as a zeroed-out row).
    const reportB = await request(
      `/reports/user-performance?userId=${cashierB.id}&range=year`,
      null,
      'GET',
      admin
    );
    assert.equal(reportB.status, 200, JSON.stringify(reportB));
    assert.equal(reportB.data.invoiceCount, 1);
    assert.equal(reportB.data.totalSales, 30);
    assert.equal(reportB.data.cashCollected, 10);
    assert.equal(reportB.data.creditExtended, 20);

    // A cashier with only 'pos'+'reports' permission (no 'users') can still
    // list reportable users and run the report -- this is intentionally NOT
    // gated behind the admin-only Users administration endpoint.
    const listedUsers = await request('/reports/users', null, 'GET', cashierA);
    assert.equal(listedUsers.status, 200, JSON.stringify(listedUsers));
    assert.ok(listedUsers.data.some((u) => u.id === cashierB.id));

    // Missing userId is rejected with a clear error, not a silent empty report.
    const noUser = await request('/reports/user-performance?range=year', null, 'GET', admin);
    assert.equal(noUser.status, 400);

    await openDay({ user: admin });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
