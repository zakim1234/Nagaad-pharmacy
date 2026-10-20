import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import DayClose from '../src/models/DayClose.js';
import { closeDay, openDay } from '../src/services/dayCloseService.js';

test('DAY CLOSE -- items sold report: per item units, cost, sales, profit; totals equal the day', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/day_items_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-day-items-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
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
  try {
    const customer = await Customer.create({ name: 'Cali', phone: '1' });
    const account = await Account.create({ name: 'Cash' });
    const biotin = await InventoryItem.create({ name: 'Biotin', itemCode: 'B-1', quantity: 200, costPriceCents: 500, sellingPriceCents: 650 });
    const zinc = await InventoryItem.create({ name: 'Zinc', itemCode: 'Z-1', quantity: 200, costPriceCents: 500, sellingPriceCents: 700 });

    // Biotin 58 @ 6.50 over two invoices; Zinc 90 @ 7, one with a $10 invoice discount.
    const s1 = await request('/sales', { customerId: customer.id, items: [{ itemId: biotin.id, quantity: 50 }, { itemId: zinc.id, quantity: 90 }], discount: 10, paidAmount: 0, paymentAccountId: account.id });
    const s2 = await request('/sales', { customerId: customer.id, items: [{ itemId: biotin.id, quantity: 8 }], paidAmount: 0, paymentAccountId: account.id });
    assert.equal(s1.status, 201, JSON.stringify(s1));
    assert.equal(s2.status, 201, JSON.stringify(s2));
    await closeDay({ user: admin });

    const daily = await request('/day-close/daily', null, 'GET');
    const day = daily.data[0];
    const res = await request(`/day-close/daily/items?date=${encodeURIComponent(day.businessDate)}`, null, 'GET');
    assert.equal(res.status, 200, JSON.stringify(res));
    const byName = Object.fromEntries(res.data.items.map((i) => [i.name, i]));
    assert.deepEqual(
      { q: byName.Biotin.quantity, uc: byName.Biotin.unitCost, up: byName.Biotin.unitPrice, c: byName.Biotin.cost, s: byName.Biotin.sales, p: byName.Biotin.profit },
      { q: 58, uc: 5, up: 6.5, c: 290, s: 377, p: 87 }
    );
    assert.deepEqual({ q: byName.Zinc.quantity, c: byName.Zinc.cost, s: byName.Zinc.sales, p: byName.Zinc.profit }, { q: 90, c: 450, s: 630, p: 180 });
    assert.deepEqual(res.data.totals, { items: 2, quantity: 148, cost: 740, sales: 1007, invoiceDiscount: 10, grossProfit: 257, expenses: 0, netProfit: 257 });
    assert.equal(res.data.totals.grossProfit, day.grossProfit, 'matches the day close');
    assert.equal(res.data.totals.netProfit, day.netProfit, 'net of the day expenses, as on the card');

    // A close recorded before this report existed is rebuilt from its invoices.
    await DayClose.collection.updateMany({}, { $unset: { itemsSold: '', invoiceDiscountCents: '' } });
    const old = await request(`/day-close/daily/items?date=${encodeURIComponent(day.businessDate)}`, null, 'GET');
    assert.deepEqual(old.data.totals, res.data.totals);

    assert.equal((await request('/day-close/daily/items?date=2001-01-01', null, 'GET')).status, 404);

    // Move that close to yesterday, sell again today: the month and year add both days up.
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    await DayClose.collection.updateMany({}, { $set: { businessDate: yesterday } });
    await openDay({ user: admin });
    const s3 = await request('/sales', { customerId: customer.id, items: [{ itemId: biotin.id, quantity: 2 }], paidAmount: 0, paymentAccountId: account.id });
    assert.equal(s3.status, 201, JSON.stringify(s3));
    await closeDay({ user: admin });

    const pad = (n) => String(n).padStart(2, '0');
    const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const days = await request('/reports/items-sold/periods?type=day', null, 'GET');
    assert.deepEqual(days.data.map((p) => p.key), [dayKey(today), dayKey(yesterday)]);
    const todayRep = await request(`/reports/items-sold?type=day&key=${dayKey(today)}`, null, 'GET');
    assert.deepEqual(todayRep.data.items.map((i) => [i.name, i.quantity]), [['Biotin', 2]]);

    const sameMonth = today.getMonth() === yesterday.getMonth();
    const monthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
    const month = await request(`/reports/items-sold?type=month&key=${monthKey}`, null, 'GET');
    assert.equal(month.status, 200, JSON.stringify(month));
    const year = await request(`/reports/items-sold?type=year&key=${today.getFullYear()}`, null, 'GET');
    const yb = year.data.items.find((i) => i.name === 'Biotin');
    assert.equal(yb.quantity, 60, 'both days in the year');
    assert.equal(year.data.dayCount, today.getFullYear() === yesterday.getFullYear() ? 2 : 1);
    if (sameMonth) {
      assert.equal(month.data.items.find((i) => i.name === 'Biotin').quantity, 60);
      assert.equal(month.data.totals.quantity, 150);
      const months = await request('/reports/items-sold/periods?type=month', null, 'GET');
      assert.equal(months.data[0].key, monthKey);
      assert.equal(months.data[0].dayCount, 2);
      assert.equal(months.data[0].netProfit, month.data.totals.netProfit, 'list total = report total');
    }
    assert.equal((await request('/reports/items-sold?type=week&key=1', null, 'GET')).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
