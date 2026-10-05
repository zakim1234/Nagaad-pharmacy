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
import PurchasePayment from '../src/models/PurchasePayment.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-bulk-payment-secret';
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

// The supplier from the request: $1,000 + $1,000 + $5,000 (voided) + $4,000, all unpaid.
async function abcPharma(request) {
  const supplier = await Supplier.create({ name: 'ABC Pharma Distributors' });
  const evc = await Account.create({ name: 'EVC Plus' });
  const bank = await Account.create({ name: 'Salaam Bank' });
  const ids = [];
  for (const amount of [1000, 1000, 5000, 4000]) {
    const r = await request('/purchases', { supplierId: supplier.id, amount, amountPaid: 0 });
    assert.equal(r.status, 201, JSON.stringify(r));
    ids.push(r.data.id);
  }
  assert.equal((await request(`/purchases/${ids[2]}/void`, { reason: 'test' })).status, 200);
  return { supplier, evc, bank, ids };
}

test('BULK PAYMENT -- 20% of the selected invoices, oldest first, one account transaction, one receipt', { timeout: 90000 }, async () => {
  const { server, request } = await setup('bulk_pay');
  try {
    const { supplier, evc, ids } = await abcPharma(request);

    const owed = await request('/purchases/bulk-payments/suppliers');
    assert.deepEqual(owed.data.map((s) => [s.name, s.owed, s.invoiceCount]), [['ABC Pharma Distributors', 6000, 3]]);
    const outstanding = await request(`/purchases/bulk-payments/outstanding?supplierId=${supplier.id}`);
    assert.deepEqual(outstanding.data.invoices.map((i) => i.id), [ids[0], ids[1], ids[3]]);
    assert.deepEqual(outstanding.data.voided.map((v) => v.id), [ids[2]]);

    const txnsBefore = await AccountTransaction.countDocuments({ account: evc._id });
    const res = await request('/purchases/bulk-payments', {
      supplierId: supplier.id,
      purchaseIds: [ids[3], ids[0], ids[1]],
      percentage: 20,
      amount: 1200,
      paymentAccountId: evc.id,
      note: 'October settlement',
    });
    assert.equal(res.status, 201, JSON.stringify(res));
    assert.match(res.data.bulkNumber, /^BPAY-\d{4}-\d{6}$/);
    assert.equal(res.data.amount, 1200);
    assert.equal(res.data.selectedOwed, 6000);
    assert.deepEqual(res.data.allocations.map((a) => [a.amount, a.newBalance, a.status]), [[1000, 0, 'Paid'], [200, 800, 'Partial']]);

    const [p1, p2, p4] = await Promise.all([Purchase.findById(ids[0]), Purchase.findById(ids[1]), Purchase.findById(ids[3])]);
    assert.equal(p1.balanceCents, 0);
    assert.equal(p2.balanceCents, 80000);
    assert.equal(p4.balanceCents, 400000, 'newest invoice untouched');

    assert.equal(await AccountTransaction.countDocuments({ account: evc._id }), txnsBefore + 1, 'ONE account transaction');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, -120000);
    const pays = await PurchasePayment.find({ bulkPayment: res.data.id });
    assert.equal(pays.length, 2, 'each invoice still records its own share');

    const receipt = await request(`/purchases/bulk-payments/${res.data.id}`);
    assert.equal(receipt.data.allocations.length, 2);
    assert.equal(receipt.data.note, 'October settlement');
  } finally {
    await teardown(server);
  }
});

test('BULK PAYMENT -- refuses voided invoices, other suppliers, and more than is owed', { timeout: 90000 }, async () => {
  const { server, request } = await setup('bulk_guard');
  try {
    const { supplier, evc, ids } = await abcPharma(request);
    const other = await Supplier.create({ name: 'Other Supplier' });
    const theirs = await request('/purchases', { supplierId: other.id, amount: 100, amountPaid: 0 });

    const base = { supplierId: supplier.id, paymentAccountId: evc.id };
    assert.equal((await request('/purchases/bulk-payments', { ...base, purchaseIds: [ids[0], ids[2]], amount: 100 })).status, 409, 'voided');
    assert.equal((await request('/purchases/bulk-payments', { ...base, purchaseIds: [ids[0], theirs.data.id], amount: 100 })).status, 400, 'other supplier');
    assert.equal((await request('/purchases/bulk-payments', { ...base, purchaseIds: [ids[0]], amount: 1000.01 })).status, 400, 'over owed');
    assert.equal((await request('/purchases/bulk-payments', { ...base, purchaseIds: [ids[0]], amount: 10, paymentDate: '2099-01-01' })).status, 400, 'future date');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0, 'nothing moved');
  } finally {
    await teardown(server);
  }
});

test('PAYMENT EDIT + DELETE -- corrections move money between accounts and recalc the invoice', { timeout: 90000 }, async () => {
  const { server, request, asCashier } = await setup('pay_edit');
  try {
    const { evc, bank, ids } = await abcPharma(request);
    const added = await request(`/purchases/${ids[3]}/payments`, { amount: 500, paymentAccountId: evc.id, note: 'first' });
    assert.equal(added.status, 201, JSON.stringify(added));
    const payId = added.data.payment.id;
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, -50000);

    // Cashiers cannot correct payments.
    assert.equal((await asCashier(`/purchases/${ids[3]}/payments/${payId}`, { amount: 600, paymentAccountId: evc.id }, 'PUT')).status, 403);

    // $500 from EVC was wrong: it was $700 from the bank, on Oct 1.
    const edited = await request(`/purchases/${ids[3]}/payments/${payId}`, { amount: 700, paymentAccountId: bank.id, paymentDate: '2026-10-01', note: 'corrected' }, 'PUT');
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.purchase.paidAmount, 700);
    assert.equal(edited.data.purchase.balanceDue, 3300);
    assert.equal(edited.data.payment.paymentAccountName, 'Salaam Bank');
    assert.equal(edited.data.payment.paymentDate.slice(0, 10), '2026-10-01');
    assert.ok(edited.data.payment.editedAt);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0, 'EVC refunded');
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, -70000, 'bank charged');

    // Cannot raise it past what the invoice owes.
    assert.equal((await request(`/purchases/${ids[3]}/payments/${payId}`, { amount: 4000.01, paymentAccountId: bank.id }, 'PUT')).status, 400);

    // Delete = the payment is reversed: money back to the bank, balance back up.
    const del = await request(`/purchases/${ids[3]}/payments/${payId}/reverse`, { reason: 'Deleted by staff' });
    assert.equal(del.status, 200, JSON.stringify(del));
    assert.equal(del.data.purchase.balanceDue, 4000);
    assert.equal(del.data.purchase.paymentStatus, 'Unpaid');
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, 0);
    assert.equal((await request(`/purchases/${ids[3]}/payments/${payId}`, { amount: 10, paymentAccountId: bank.id }, 'PUT')).status, 409, 'deleted payments cannot be edited');
  } finally {
    await teardown(server);
  }
});
