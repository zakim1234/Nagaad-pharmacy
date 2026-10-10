import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Supplier from '../src/models/Supplier.js';
import Account from '../src/models/Account.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import Purchase from '../src/models/Purchase.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-vendor-plan-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
  const cashier = await User.create({ username: 'cashier', name: 'Cashier', passwordHash: 'unused', role: 'cashier', permissions: ['purchases'] });
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
  return { server, request: as(admin), asCashier: as(cashier) };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// Three suppliers like the paper sheet: Alpha owes 300 + 500, Beta 200, Gamma 1000.
async function suppliers(request) {
  const [alpha, beta, gamma] = await Promise.all(['Alpha Pharma', 'Beta Medical', 'Gamma Supplies'].map((name) => Supplier.create({ name })));
  const evc = await Account.create({ name: 'EVC Plus' });
  const invoices = {};
  for (const [s, amounts] of [[alpha, [300, 500]], [beta, [200]], [gamma, [1000]]]) {
    invoices[s.name] = [];
    for (const amount of amounts) {
      const r = await request('/purchases', { supplierId: s.id, amount, amountPaid: 0 });
      assert.equal(r.status, 201, JSON.stringify(r));
      invoices[s.name].push(r.data.id);
    }
  }
  return { alpha, beta, gamma, evc, invoices };
}

test('VENDOR BALANCES -- list owed, save allocations, pay them all at once', { timeout: 90000 }, async () => {
  const { server, request, asCashier } = await setup('vplan');
  try {
    const { alpha, beta, gamma, evc, invoices } = await suppliers(request);

    const sheet = await request('/purchases/payment-plan');
    assert.equal(sheet.status, 200, JSON.stringify(sheet));
    assert.deepEqual(sheet.data.balances.map((b) => [b.name, b.owed]), [['Alpha Pharma', 800], ['Beta Medical', 200], ['Gamma Supplies', 1000]]);
    assert.equal(sheet.data.totalOwed, 2000);
    assert.equal(sheet.data.plan, null);

    // Allocation over the balance is refused.
    assert.equal((await request('/purchases/payment-plan', { rows: [{ supplierId: beta.id, allocation: 200.01 }] }, 'PUT')).status, 400);

    // Cashier can prepare the sheet but not pay it.
    const saved = await asCashier('/purchases/payment-plan', {
      rows: [{ supplierId: alpha.id, allocation: 400 }, { supplierId: beta.id, allocation: 150 }, { supplierId: gamma.id, allocation: 0 }],
      note: 'Week 41',
    }, 'PUT');
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.match(saved.data.planNumber, /^VPLAN-\d{4}-\d{6}$/);
    assert.equal(saved.data.rows.length, 2, 'zero rows are dropped');
    assert.equal(saved.data.totalAllocated, 550);
    assert.equal((await asCashier('/purchases/payment-plan/pay', { paymentAccountId: evc.id })).status, 403);

    // Saving again edits the same open plan.
    const resaved = await request('/purchases/payment-plan', { rows: [{ supplierId: alpha.id, allocation: 400 }, { supplierId: beta.id, allocation: 50 }], note: 'Week 41' }, 'PUT');
    assert.equal(resaved.data.planNumber, saved.data.planNumber);
    assert.equal(resaved.data.totalAllocated, 450);

    const paid = await request('/purchases/payment-plan/pay', { paymentAccountId: evc.id });
    assert.equal(paid.status, 200, JSON.stringify(paid));
    assert.equal(paid.data.status, 'PAID');
    assert.equal(paid.data.totalPaid, 450);
    assert.ok(paid.data.rows.every((r) => /^BPAY-/.test(r.bulkNumber)));

    // Alpha: oldest invoice (300) cleared, then 100 off the 500.
    const [a1, a2, b1, g1] = await Promise.all([...invoices['Alpha Pharma'], ...invoices['Beta Medical'], ...invoices['Gamma Supplies']].map((id) => Purchase.findById(id)));
    assert.deepEqual([a1.balanceCents, a2.balanceCents, b1.balanceCents, g1.balanceCents], [0, 40000, 15000, 100000]);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, -45000);
    assert.equal(await AccountTransaction.countDocuments({ account: evc._id }), 2, 'one account transaction per supplier');

    // Nothing left to pay; the next save starts a new plan.
    assert.equal((await request('/purchases/payment-plan/pay', { paymentAccountId: evc.id })).status, 400);
    const after = await request('/purchases/payment-plan');
    assert.equal(after.data.totalOwed, 1550);
    assert.equal(after.data.plan.status, 'PAID');
    const next = await request('/purchases/payment-plan', { rows: [{ supplierId: gamma.id, allocation: 100 }] }, 'PUT');
    assert.notEqual(next.data.planNumber, saved.data.planNumber);
  } finally {
    await teardown(server);
  }
});

test('VENDOR BALANCES -- a failed payment rolls back every supplier', { timeout: 90000 }, async () => {
  const { server, request } = await setup('vplan_rollback');
  try {
    const { alpha, beta, evc } = await suppliers(request);
    await request('/purchases/payment-plan', { rows: [{ supplierId: alpha.id, allocation: 100 }, { supplierId: beta.id, allocation: 100 }] }, 'PUT');
    // Deactivated account: nothing is paid, plan stays open.
    await Account.updateOne({ _id: evc._id }, { isActive: false });
    assert.equal((await request('/purchases/payment-plan/pay', { paymentAccountId: evc.id })).status, 400);
    const sheet = await request('/purchases/payment-plan');
    assert.equal(sheet.data.totalOwed, 2000);
    assert.equal(sheet.data.plan.status, 'OPEN');
  } finally {
    await teardown(server);
  }
});

test('SUPPLIER SUMMARY -- one line per supplier, invoices kept together', { timeout: 90000 }, async () => {
  const { server, request } = await setup('supplier_summary');
  try {
    const { alpha, invoices } = await suppliers(request);
    await request(`/purchases/${invoices['Alpha Pharma'][0]}/payments`, { amount: 100, paymentAccountId: (await Account.findOne()).id });
    await request(`/purchases/${invoices['Gamma Supplies'][0]}/void`, { reason: 'test' });
    const sum = await request('/purchases/suppliers-summary');
    assert.equal(sum.status, 200, JSON.stringify(sum));
    assert.deepEqual(sum.data.map((s) => [s.name, s.invoiceCount, s.voidedCount, s.total, s.paid, s.owed]), [
      ['Alpha Pharma', 2, 0, 800, 100, 700],
      ['Beta Medical', 1, 0, 200, 0, 200],
      ['Gamma Supplies', 0, 1, 0, 0, 0],
    ]);
    const grouped = await request('/purchases?sort=supplier');
    assert.deepEqual(grouped.data.map((p) => p.supplierName), ['Alpha Pharma', 'Alpha Pharma', 'Beta Medical', 'Gamma Supplies']);
    const onlyAlpha = await request(`/purchases?supplier=${alpha.id}`);
    assert.equal(onlyAlpha.data.length, 2);
  } finally {
    await teardown(server);
  }
});

test('SAVED SHEETS -- every plan is listed and can be opened again', { timeout: 90000 }, async () => {
  const { server, request } = await setup('vplan_history');
  try {
    const { alpha, beta, evc } = await suppliers(request);
    await request('/purchases/payment-plan', { rows: [{ supplierId: alpha.id, allocation: 100 }] }, 'PUT');
    const paid = await request('/purchases/payment-plan/pay', { paymentAccountId: evc.id });
    await request('/purchases/payment-plan', { rows: [{ supplierId: beta.id, allocation: 50 }] }, 'PUT');

    const list = await request('/purchases/payment-plans');
    assert.equal(list.status, 200, JSON.stringify(list));
    assert.deepEqual(list.data.map((p) => [p.status, p.supplierCount, p.totalPaid, p.totalAllocated]), [['OPEN', 1, 0, 50], ['PAID', 1, 100, 100]]);

    const one = await request(`/purchases/payment-plans/${paid.data.id}`);
    assert.equal(one.data.planNumber, paid.data.planNumber);
    assert.equal(one.data.rows[0].supplierName, 'Alpha Pharma');
    assert.match(one.data.rows[0].bulkNumber, /^BPAY-/);
    assert.equal((await request('/purchases/payment-plans/nope')).status, 404);
  } finally {
    await teardown(server);
  }
});

test('SUPPLIER STATEMENT -- invoices with their serials, payments with receipt numbers, running balance', { timeout: 90000 }, async () => {
  const { server, request } = await setup('supplier_statement');
  try {
    const supplier = await Supplier.create({ name: 'Delta Pharma' });
    const evc = await Account.create({ name: 'EVC Plus' });
    const a = await request('/purchases', { supplierId: supplier.id, amount: 300, amountPaid: 0, supplierInvoiceNumber: 'INV-501' });
    const b = await request('/purchases', { supplierId: supplier.id, amount: 500, amountPaid: 0, supplierInvoiceNumber: 'INV-502' });
    const voided = await request('/purchases', { supplierId: supplier.id, amount: 999, amountPaid: 0, supplierInvoiceNumber: 'INV-X' });
    await request(`/purchases/${voided.data.id}/void`, { reason: 'test' });

    // Through the sheet, with the receipt serial they wrote by hand: spans both invoices.
    const saved = await request('/purchases/payment-plan', { rows: [{ supplierId: supplier.id, allocation: 400, receiptNo: 'R-0077' }] }, 'PUT');
    assert.equal(saved.data.rows[0].receiptNo, 'R-0077');
    const paid = await request('/purchases/payment-plan/pay', { paymentAccountId: evc.id });
    assert.equal(paid.status, 200, JSON.stringify(paid));
    const bulk = await request(`/purchases/bulk-payments/${paid.data.rows[0].bulkPayment}`);
    assert.equal(bulk.data.receiptNo, 'R-0077');
    // A single payment with its own receipt.
    const single = await request(`/purchases/${b.data.id}/payments`, { amount: 50, paymentAccountId: evc.id, receiptNo: 'R-0078' });
    assert.equal(single.data.payment.receiptNo, 'R-0078');

    const st = await request(`/purchases/suppliers/${supplier.id}/statement`);
    assert.equal(st.status, 200, JSON.stringify(st));
    assert.deepEqual(st.data.totals, { bought: 800, paid: 450, remaining: 350, invoiceCount: 2, paymentCount: 2 });
    assert.deepEqual(
      st.data.lines.map((l) => [l.kind, l.serialNo, l.goods, l.paid, l.balance]),
      [
        ['INVOICE', 'INV-501', 300, 0, 300],
        ['INVOICE', 'INV-502', 500, 0, 800],
        ['PAYMENT', 'R-0077', 0, 400, 400],
        ['PAYMENT', 'R-0078', 0, 50, 350],
      ],
      'the 400 split over two invoices is one line; the voided invoice is left out'
    );
    assert.ok(a.data.id);
  } finally {
    await teardown(server);
  }
});
