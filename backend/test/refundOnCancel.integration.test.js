import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import InventoryItem from '../src/models/InventoryItem.js';
import { closeDay } from '../src/services/dayCloseService.js';

// Cancelling a confirmed invoice: everything paid on it (at the sale and
// later) goes to the wallet, or is handed back from a chosen account with the
// number it was sent to -- and shows on the Refunds report.
test('CANCEL INVOICE REFUND -- wallet or cash from a chosen account, listed on the report', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/refund_cancel_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-refund-cancel-secret';
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
    const item = await InventoryItem.create({ name: 'Zinc', itemCode: 'ZN-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 1000 });
    const customer = await Customer.create({ name: 'Cuma', phone: '111' });
    const evc = await Account.create({ name: 'EVC Plus' });
    const bank = await Account.create({ name: 'Salaam Bank' });

    // A: $50, $20 paid at the sale into EVC, $30 on credit paid later.
    const a = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 20, paymentAccountId: evc.id });
    assert.equal(a.status, 201, JSON.stringify(a));
    // B: $40, all paid at the sale into EVC.
    const b = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 4 }], paidAmount: 40, paymentAccountId: evc.id });
    assert.equal(b.status, 201, JSON.stringify(b));
    await closeDay({ user: admin });
    assert.equal((await request(`/customers/${customer.id}/payments`, { amount: 30, paymentAccountId: evc.id })).status, 201);

    // A -> cash back out of the bank (not the account it was paid into), all $50.
    const noAccount = await request(`/sales/${a.data.id}/reverse`, { refundTo: 'ACCOUNT', accountId: new mongoose.Types.ObjectId().toString() });
    assert.equal(noAccount.status, 400, 'an unknown account is refused');
    const ra = await request(`/sales/${a.data.id}/reverse`, { refundTo: 'ACCOUNT', accountId: bank.id, reference: '615777888', reason: 'Wrong item' });
    assert.equal(ra.status, 200, JSON.stringify(ra));
    assert.deepEqual(ra.data.cancelRefund, { to: 'ACCOUNT', amount: 50, accountName: 'Salaam Bank', reference: '615777888', byName: 'Admin' });
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, -5000, '$50 left the bank');
    const out = await AccountTransaction.findOne({ type: 'REFUND', account: bank._id });
    assert.equal(out.amountCents, 5000);
    assert.match(out.description, /615777888/);
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 0, 'nothing went to the wallet');

    // B -> the wallet.
    const rb = await request(`/sales/${b.data.id}/reverse`, { refundTo: 'WALLET' });
    assert.equal(rb.status, 200, JSON.stringify(rb));
    assert.equal(rb.data.cancelRefund.to, 'WALLET');
    assert.equal(rb.data.cancelRefund.amount, 40);
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 4000);

    // The customer statement keeps both cancelled invoices, marked: the sale,
    // its payments, the cancellation and the refund -- ending at 0 owed.
    const st = await request(`/customers/${customer.id}/statement`, null, 'GET');
    assert.equal(st.status, 200, JSON.stringify(st));
    const rowsOf = (rn) => st.data.ledger.filter((e) => e.reference === rn).map((e) => [e.type, e.debit, e.credit]);
    assert.deepEqual(rowsOf(b.data.receiptNumber), [
      ['SALE', 40, 0],
      ['CANCELLED', 0, 40],
      ['REFUND', 40, 0],
    ]);
    assert.ok(st.data.ledger.filter((e) => e.type === 'REFUND').some((e) => /Salaam Bank to 615777888/.test(e.description)));
    assert.ok(st.data.ledger.every((e) => e.type.endsWith('PAYMENT') || e.cancelled));
    assert.equal(st.data.ledger.at(-1).runningBalance, 0);
    assert.equal(st.data.summary.totalPayments, 0, 'nothing paid on invoices still standing');
    assert.equal(st.data.summary.cancelledInvoices, 2);
    assert.equal(st.data.summary.totalCancelled, 90);

    // The report: both, newest first, with totals; filters by kind and date.
    const rep = await request('/sales/refunds', null, 'GET');
    assert.equal(rep.status, 200, JSON.stringify(rep));
    assert.deepEqual(rep.data.rows.map((r) => [r.receiptNumber, r.to, r.amount, r.accountName, r.reference]), [
      [b.data.receiptNumber, 'WALLET', 40, '', ''],
      [a.data.receiptNumber, 'ACCOUNT', 50, 'Salaam Bank', '615777888'],
    ]);
    assert.deepEqual(rep.data.totals, { count: 2, amount: 90, wallet: 40, cash: 50 });
    assert.equal((await request('/sales/refunds?refundTo=ACCOUNT', null, 'GET')).data.rows.length, 1);
    assert.equal((await request('/sales/refunds?from=2000-01-01&to=2000-12-31', null, 'GET')).data.rows.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
