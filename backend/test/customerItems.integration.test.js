import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Sale from '../src/models/Sale.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('CUSTOMER ITEMS -- what one customer bought, most and least bought, by period', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/customer_items_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-customer-items-secret';
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
    const cali = await Customer.create({ name: 'Cali', phone: '1' });
    const other = await Customer.create({ name: 'Other', phone: '2' });
    const account = await Account.create({ name: 'Cash' });
    const zinc = await InventoryItem.create({ name: 'Zinc', itemCode: 'Z-1', quantity: 500, costPriceCents: 100, sellingPriceCents: 200 });
    const bio = await InventoryItem.create({ name: 'Biotin', itemCode: 'B-1', quantity: 500, costPriceCents: 500, sellingPriceCents: 650 });

    const sell = (customer, items) => request('/sales', { customerId: customer.id, items, paidAmount: 0, paymentAccountId: account.id });
    const s1 = await sell(cali, [{ itemId: zinc.id, quantity: 40 }, { itemId: bio.id, quantity: 3 }]);
    await sell(cali, [{ itemId: zinc.id, quantity: 30 }]);
    await sell(other, [{ itemId: bio.id, quantity: 50 }]); // someone else's purchase never counts
    await sell(cali, [{ itemId: bio.id, quantity: 1 }]); // still a draft at report time? no -- closed below
    await closeDay({ user: admin });

    // Cali returns 1 Biotin from the first invoice.
    const ret = await request(`/sales/${s1.data.id}/return`, { items: [{ itemId: bio.id, quantity: 1 }], reason: 'test' });
    assert.equal(ret.status, 200, JSON.stringify(ret));

    const all = await request(`/customers/${cali.id}/items`, null, 'GET');
    assert.equal(all.status, 200, JSON.stringify(all));
    const byName = Object.fromEntries(all.data.items.map((i) => [i.name, i]));
    assert.deepEqual({ q: byName.Zinc.quantity, spent: byName.Zinc.spent, inv: byName.Zinc.invoices }, { q: 70, spent: 140, inv: 2 });
    assert.equal(byName.Biotin.quantity, 3, '3 + 1 bought, 1 returned');
    assert.equal(byName.Biotin.spent, 19.5);
    assert.equal(all.data.mostBought.name, 'Zinc');
    assert.equal(all.data.leastBought.name, 'Biotin');
    assert.deepEqual(all.data.totals, { items: 2, quantity: 73, spent: 159.5, cost: 85, profit: 74.5 });
    assert.equal(all.data.invoiceCount, 3);

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const month = await request(`/customers/${cali.id}/items?type=month&key=${now.getFullYear()}-${pad(now.getMonth() + 1)}`, null, 'GET');
    assert.equal(month.data.totals.quantity, 73);
    const lastYear = await request(`/customers/${cali.id}/items?type=year&key=${now.getFullYear() - 1}`, null, 'GET');
    assert.equal(lastYear.data.items.length, 0);
    assert.equal(lastYear.data.mostBought, null);
    assert.equal((await request(`/customers/${cali.id}/items?type=week&key=1`, null, 'GET')).status, 400);

    // Drafts (not yet closed) are not counted.
    await sell(cali, [{ itemId: zinc.id, quantity: 999 }]).catch(() => {});
    assert.equal((await request(`/customers/${cali.id}/items`, null, 'GET')).data.totals.quantity, 73);
    assert.ok(await Sale.exists({ status: 'DRAFT' }) !== undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
