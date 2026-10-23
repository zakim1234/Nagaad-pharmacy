import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Partner from '../src/models/Partner.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('PROFIT SHARING -- the year profit split 50/30/20, paid out or added to capital, cancellable, balance sheet unchanged', { timeout: 120000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/profit_sharing_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-profit-sharing-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
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
  const year = new Date().getFullYear();
  try {
    const bank = await Account.create({ name: 'Bank' });
    const partners = {};
    for (const [name, amount] of [['cali', 50000], ['cumar', 30000], ['cabdulahi', 20000]]) {
      const p = await request('/partners', { name });
      assert.equal(p.status, 201, JSON.stringify(p));
      const c = await request(`/partners/${p.data.id}/contribute`, { amount, paymentAccountId: bank.id });
      assert.ok(c.status < 300, JSON.stringify(c));
      partners[name] = p.data.id;
    }

    // Nothing sold yet: no profit to share.
    const none = await request('/partners/profit-sharing', { year, mode: 'CAPITAL', shares: [{ partnerId: partners.cali, percent: 100 }] });
    assert.equal(none.status, 400);

    // Make $1,000 profit this year: 100 units bought at $10, sold at $20.
    const customer = await Customer.create({ name: 'Buyer', phone: '1' });
    const item = await InventoryItem.create({ name: 'Bio', itemCode: 'B-1', quantity: 100, costPriceCents: 1000, sellingPriceCents: 2000 });
    const sale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 100 }], paidAmount: 2000, paymentAccountId: bank.id });
    assert.equal(sale.status, 201, JSON.stringify(sale));
    await closeDay({ user: admin });

    const preview = await request(`/partners/profit-sharing/preview?year=${year}`, null, 'GET');
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(preview.data.netProfit, 1000);
    const byName = Object.fromEntries(preview.data.partners.map((p) => [p.name, p]));
    assert.deepEqual([byName.cali.percent, byName.cumar.percent, byName.cabdulahi.percent], [50, 30, 20]);
    assert.deepEqual([byName.cali.amount, byName.cumar.amount, byName.cabdulahi.amount], [500, 300, 200]);

    const shares = preview.data.partners.map((p) => ({ partnerId: p.id, percent: p.percent }));
    assert.equal((await request('/partners/profit-sharing', { year, mode: 'CAPITAL', shares: shares.map((s) => ({ ...s, percent: 10 })) })).status, 400, 'must add up to 100');

    const sheetBefore = (await request('/reports/balance-sheet', null, 'GET')).data;
    const bankBefore = (await Account.findById(bank.id)).currentBalanceCents;

    // Pay it out of the bank.
    const paid = await request('/partners/profit-sharing', { year, mode: 'PAYOUT', paymentAccountId: bank.id, shares });
    assert.equal(paid.status, 201, JSON.stringify(paid));
    assert.deepEqual(paid.data.shares.map((s) => [s.partnerName, s.amount]), [['cali', 500], ['cumar', 300], ['cabdulahi', 200]]);
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, bankBefore - 100000);
    assert.equal((await Partner.findById(partners.cali)).currentEquityCents, 5000000, 'paid out: capital unchanged');
    assert.equal((await Partner.findById(partners.cali)).totalProfitCents, 50000);
    const sheetPaid = (await request('/reports/balance-sheet', null, 'GET')).data;
    assert.equal(sheetPaid.difference, sheetBefore.difference, 'balance sheet still balances the same');
    assert.equal(sheetPaid.equity.totalEquity, sheetBefore.equity.totalEquity - 1000);

    // The same year cannot be shared twice.
    assert.equal((await request('/partners/profit-sharing', { year, mode: 'PAYOUT', paymentAccountId: bank.id, shares })).status, 409);

    // Cancel: the money comes back.
    const cancelled = await request(`/partners/profit-sharing/${paid.data.id}/cancel`, { reason: 'wrong account' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
    assert.equal(cancelled.data.status, 'CANCELLED');
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, bankBefore);
    assert.equal((await Partner.findById(partners.cali)).totalProfitCents, 0);
    assert.equal((await request('/reports/balance-sheet', null, 'GET')).data.equity.totalEquity, sheetBefore.equity.totalEquity);

    // Add it to their capital instead.
    const capital = await request('/partners/profit-sharing', { year, mode: 'CAPITAL', shares });
    assert.equal(capital.status, 201, JSON.stringify(capital));
    assert.equal((await Partner.findById(partners.cali)).currentEquityCents, 5050000);
    assert.equal((await Partner.findById(partners.cabdulahi)).currentEquityCents, 2020000);
    const sheetCapital = (await request('/reports/balance-sheet', null, 'GET')).data;
    assert.equal(sheetCapital.difference, sheetBefore.difference);
    assert.equal(sheetCapital.equity.totalEquity, sheetBefore.equity.totalEquity, 'moved from retained profit into capital');
    assert.equal(sheetCapital.equity.partnersCapital, sheetBefore.equity.partnersCapital + 1000);

    const history = await request(`/partners/${partners.cumar}/transactions`, null, 'GET');
    assert.equal(history.data.filter((t) => t.type === 'PROFIT_SHARE').length, 2);
    assert.ok(history.data.some((t) => t.type === 'PROFIT_SHARE_CANCELLED'));
    assert.equal((await request('/partners/profit-sharing', null, 'GET')).data.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
