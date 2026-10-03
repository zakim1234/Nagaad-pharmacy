import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Expense from '../src/models/Expense.js';
import { closeDay } from '../src/services/dayCloseService.js';
import { formatProfitLossRange } from '../src/services/profitLossService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-pl-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const tokenFor = (u) => jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET);
  const raw = (path, body, method = 'POST', user = admin) =>
    fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(user)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
  const request = async (...args) => {
    const r = await raw(...args);
    return { status: r.status, ...(await r.json()) };
  };
  return { admin, server, request, raw };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

const find = (report, type, label) => report.rows.find((r) => r.type === type && r.label === label);
const total = (report, type, label) => find(report, type, label).values.total;

test('PROFIT & LOSS -- accrual vs cash basis, expense categories, month columns, sorting, Excel export', { timeout: 120000 }, async () => {
  const { admin, server, request, raw } = await setup('pl_main');
  try {
    const customer = await Customer.create({ name: 'Walk-in', phone: '999' });
    const cash = await Account.create({ name: 'Cash Drawer' });
    const evc = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 500 });

    // Sale A: 10 x $5 = $50, fully paid to Cash. Sale B: $50, $20 paid to EVC, $30 on credit.
    const a = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 10 }], paidAmount: 50, paymentAccountId: cash.id });
    const b = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 10 }], paidAmount: 20, paymentAccountId: evc.id });
    assert.equal(a.status, 201, JSON.stringify(a));
    assert.equal(b.status, 201, JSON.stringify(b));
    await closeDay({ user: admin });

    // Customer later pays $10 of the credit; 2 units come back from sale A ($10 refunded from Cash).
    assert.equal((await request(`/customers/${customer.id}/payments`, { amount: 10, paymentAccountId: cash.id })).status, 201);
    const ret = await request(`/sales/${a.data.id}/return`, { items: [{ itemId: item.id, quantity: 2 }] });
    assert.equal(ret.status, 200, JSON.stringify(ret));

    // Expense categories: a default one, and a brand-new one added by an admin.
    const cats = await request('/expenses/categories', null, 'GET');
    assert.deepEqual(cats.data.slice(0, 3), ['Rent', 'Salaries', 'Labor']);
    const created = await request('/expenses/categories', { name: 'Zako Expense' });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal((await request('/expenses/categories', { name: 'zako expense' })).status, 409, 'duplicates are case-insensitive');
    assert.equal((await request('/expenses/categories', { name: '   ' })).status, 400);
    const mk = (category, amount) => request('/expenses', { category, amount, paymentAccountId: cash.id });
    assert.equal((await mk('Rent', 15)).status, 201);
    assert.equal((await mk('Fuel', 5)).status, 201);
    assert.equal((await mk('Zako Expense', 8)).status, 201);
    assert.equal((await mk('zako expense', 2)).status, 201, 'category is stored in its canonical spelling');
    assert.equal((await mk('Not a category', 1)).status, 400);
    // A voided expense never counts.
    const voidMe = await mk('Rent', 100);
    await request(`/expenses/${voidMe.data.id}/void`, {});

    const q = 'from=2000-01-01&to=2099-12-31';

    // ACCRUAL: income = confirmed invoices net of the return = 100 - 10 = 90; COGS = 20 - 2 = 18.
    const accrual = (await request(`/reports/profit-loss?${q}&basis=accrual`, null, 'GET')).data;
    assert.equal(accrual.basis, 'accrual');
    assert.equal(total(accrual, 'line', 'Sales Income'), 90);
    assert.equal(total(accrual, 'line', 'Discount Received'), 0);
    assert.equal(total(accrual, 'total', 'Total Income'), 90);
    assert.equal(total(accrual, 'total', 'Total COGS'), 18);
    assert.equal(total(accrual, 'grand', 'Gross Profit'), 72);
    assert.equal(total(accrual, 'total', 'Total Expense'), 30);
    assert.equal(total(accrual, 'grand', 'Net Income'), 42);
    // Section order and default expense-category order (Rent, Fuel, then the custom one; nothing with zero activity).
    assert.deepEqual(accrual.rows.filter((r) => r.type === 'section').map((r) => r.label), ['Income', 'Cost of Goods Sold', 'Expense']);
    const expenseRows = (report) => report.rows.filter((r) => r.depth === 1 && !['Discount Received', 'Sales Income', 'Cost of Goods Sold'].includes(r.label));
    assert.deepEqual(expenseRows(accrual).map((r) => [r.label, r.values.total]), [['Rent', 15], ['Fuel', 5], ['Zako Expense', 10]]);

    // Cross-check: the accrual P&L must agree exactly with the existing Profit report for the same range.
    const profit = (await request(`/reports/profit?${q}`, null, 'GET')).data;
    assert.equal(total(accrual, 'total', 'Total Income'), profit.revenue);
    assert.equal(total(accrual, 'total', 'Total COGS'), profit.costOfGoodsSold);
    assert.equal(total(accrual, 'grand', 'Gross Profit'), profit.grossProfit);

    // CASH: received 50 + 20 (posted at Close Day) + 10 (debt payment) - 10 (refund) = 70. COGS/expenses unchanged.
    const cashBasis = (await request(`/reports/profit-loss?${q}&basis=cash`, null, 'GET')).data;
    assert.equal(total(cashBasis, 'line', 'Sales Income'), 70);
    assert.equal(total(cashBasis, 'total', 'Total COGS'), 18);
    assert.equal(total(cashBasis, 'grand', 'Gross Profit'), 52);
    assert.equal(total(cashBasis, 'grand', 'Net Income'), 22);

    // Gross Profit / Net Income are always derived from the lines above them.
    for (const r of [accrual, cashBasis]) {
      assert.equal(total(r, 'grand', 'Gross Profit'), total(r, 'total', 'Total Income') - total(r, 'total', 'Total COGS'));
      assert.equal(total(r, 'grand', 'Net Income'), total(r, 'grand', 'Gross Profit') - total(r, 'total', 'Total Expense'));
    }

    // Sorting expense categories.
    const byAmount = (await request(`/reports/profit-loss?${q}&sort=amount`, null, 'GET')).data;
    assert.deepEqual(expenseRows(byAmount).map((r) => r.label), ['Rent', 'Zako Expense', 'Fuel']);
    const byName = (await request(`/reports/profit-loss?${q}&sort=name`, null, 'GET')).data;
    assert.deepEqual(expenseRows(byName).map((r) => r.label), ['Fuel', 'Rent', 'Zako Expense']);

    // Date range: a window that contains no activity is all zeros; expenses honour their own dates.
    const empty = (await request('/reports/profit-loss?from=2001-01-01&to=2001-01-31', null, 'GET')).data;
    assert.equal(total(empty, 'grand', 'Net Income'), 0);
    assert.equal(empty.range.from, '2001-01-01');
    await Expense.updateOne({ category: 'Fuel' }, { date: new Date(2001, 0, 15, 12) });
    const jan = (await request('/reports/profit-loss?from=2001-01-01&to=2001-01-31', null, 'GET')).data;
    assert.equal(total(jan, 'total', 'Total Expense'), 5, 'an expense dated inside the window counts');
    const janEdge = (await request('/reports/profit-loss?from=2001-01-15&to=2001-01-15', null, 'GET')).data;
    assert.equal(total(janEdge, 'total', 'Total Expense'), 5, 'a single-day range includes that whole day');

    // Month columns: one per calendar month in range, plus Total; columns add up to the total.
    await Expense.updateOne({ category: 'Fuel' }, { date: new Date(2001, 1, 3, 12) });
    const months = (await request('/reports/profit-loss?from=2001-01-20&to=2001-03-05&columns=month', null, 'GET')).data;
    assert.deepEqual(months.columns.map((c) => c.key), ['2001-01', '2001-02', '2001-03', 'total']);
    const fuel = find(months, 'line', 'Fuel').values;
    assert.deepEqual([fuel['2001-01'], fuel['2001-02'], fuel['2001-03'], fuel.total], [0, 5, 0, 5]);
    const tooMany = await request('/reports/profit-loss?from=2000-01-01&to=2099-12-31&columns=month', null, 'GET');
    assert.equal(tooMany.status, 400, 'absurdly many month columns are refused');

    // Validation.
    for (const bad of ['basis=weird', 'columns=weekly', 'sort=random', 'from=2026-13-01', 'from=nope', 'from=2026-09-20&to=2026-09-01']) {
      assert.equal((await request(`/reports/profit-loss?${bad}`, null, 'GET')).status, 400, bad);
    }
    // Defaults: month-to-date, accrual.
    const dflt = (await request('/reports/profit-loss', null, 'GET')).data;
    assert.equal(dflt.basis, 'accrual');
    assert.match(dflt.range.from, /-01$/);

    // Excel export is a real workbook with the same numbers and a proper header.
    const res = await raw(`/reports/profit-loss/export?${q}&basis=cash`, null, 'GET');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /profit-and-loss_2000-01-01_to_2099-12-31_cash\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const ws = wb.getWorksheet('Profit & Loss');
    const cells = [];
    ws.eachRow((row) => cells.push(row.values.slice(1)));
    assert.equal(cells[0][0], 'Nagaad Pharma');
    assert.equal(cells[1][0], 'Profit & Loss');
    assert.equal(cells[3][0], 'Cash Basis');
    assert.equal(cells.find((r) => String(r[0]).trim() === 'Sales Income')[1], 70);
    assert.equal(cells.find((r) => r[0] === 'Net Income')[1], 22);
    assert.equal(cells.find((r) => r[0] === 'Gross Profit')[1], 52);
  } finally {
    await teardown(server);
  }
});

test('PROFIT & LOSS -- permissions and range label', { timeout: 60000 }, async () => {
  const { server, request } = await setup('pl_perm');
  try {
    const noReports = await User.create({ username: 'nr', name: 'NR', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    assert.equal((await request('/reports/profit-loss', null, 'GET', noReports)).status, 403);
    assert.equal((await request('/reports/profit-loss/export', null, 'GET', noReports)).status, 403);
    // Category management is admin/manager only, but any expenses user may read the list.
    const clerk = await User.create({ username: 'clerk', name: 'Clerk', passwordHash: 'unused', role: 'cashier', permissions: ['expenses'] });
    assert.equal((await request('/expenses/categories', null, 'GET', clerk)).status, 200);
    assert.equal((await request('/expenses/categories', { name: 'Sneaky' }, 'POST', clerk)).status, 403);

    assert.equal(formatProfitLossRange({ from: '2026-09-01', to: '2026-09-19' }), 'September 1 - 19, 2026');
    assert.equal(formatProfitLossRange({ from: '2026-09-05', to: '2026-09-05' }), 'September 5, 2026');
    assert.equal(formatProfitLossRange({ from: '2026-08-15', to: '2026-09-19' }), 'August 15 - September 19, 2026');
    assert.equal(formatProfitLossRange({ from: '2025-12-01', to: '2026-01-31' }), 'December 1, 2025 - January 31, 2026');
  } finally {
    await teardown(server);
  }
});
