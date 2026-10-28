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
import Sale from '../src/models/Sale.js';
import { closeDay } from '../src/services/dayCloseService.js';

// Items can be returned from an invoice even after it was paid off by a debt
// payment: the money for the returned pieces is given back -- as cash from a
// chosen account (with the number) or into the customer's wallet.
test('RETURN AFTER PAYMENT -- paid invoice, return refunded as cash or to the wallet', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/return_after_pay_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-return-after-pay-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    const biotin = await InventoryItem.create({ name: 'biotin', itemCode: 'BIO-1', quantity: 100, costPriceCents: 500, sellingPriceCents: 1200 });
    const cumar = await Customer.create({ name: 'cumar', phone: '612334477' });
    const evc = await Account.create({ name: 'EVC Plus' });
    const bank = await Account.create({ name: 'Salaam Bank' });

    // 10 x $12 = $120: $100 paid at the sale, $20 on credit, paid off later.
    const sale = await request('/sales', { customerId: cumar.id, items: [{ itemId: biotin.id, quantity: 10 }], paidAmount: 100, paymentAccountId: evc.id });
    assert.equal(sale.status, 201, JSON.stringify(sale));
    await closeDay({ user: admin });
    assert.equal((await request(`/customers/${cumar.id}/payments`, { amount: 20, paymentAccountId: evc.id })).status, 201);
    assert.equal((await Sale.findById(sale.data.id)).outstandingCents, 0, 'fully paid');

    // Return 4 ($48) as cash from the bank to a number.
    const r1 = await request(`/sales/${sale.data.id}/return`, { items: [{ itemId: biotin.id, quantity: 4 }], refundTo: 'ACCOUNT', accountId: bank.id, reference: '615000999' });
    assert.equal(r1.status, 200, JSON.stringify(r1));
    const ret1 = r1.data.returns[0];
    assert.equal(ret1.amount, 48);
    assert.equal(ret1.refund, 48);
    assert.equal(ret1.refundTo, 'ACCOUNT');
    assert.equal(ret1.refundAccountName, 'Salaam Bank');
    assert.equal(ret1.refundReference, '615000999');
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, -4800, '$48 left the bank');
    assert.match((await AccountTransaction.findOne({ account: bank._id, type: 'REFUND' })).description, /615000999/);
    assert.equal((await InventoryItem.findById(biotin.id)).quantity, 94, 'stock back');

    // Return 2 more ($24) into the wallet.
    const r2 = await request(`/sales/${sale.data.id}/return`, { items: [{ itemId: biotin.id, quantity: 2 }], refundTo: 'WALLET' });
    assert.equal(r2.status, 200, JSON.stringify(r2));
    assert.equal(r2.data.returns[1].refundTo, 'WALLET');
    assert.equal((await Customer.findById(cumar.id)).walletBalanceCents, 2400);

    // The invoice still adds up: $48 for the 4 kept, all paid, nothing owed.
    const after = await Sale.findById(sale.data.id);
    assert.equal(after.totalCents, 4800);
    assert.equal(after.paidAmountCents + after.walletAmountCents + after.balanceAddedCents, after.totalCents);
    assert.equal(after.outstandingCents, 0);
    assert.equal((await Customer.findById(cumar.id)).balanceCents, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
