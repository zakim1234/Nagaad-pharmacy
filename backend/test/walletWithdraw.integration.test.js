import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Customer from '../src/models/Customer.js';
import Account from '../src/models/Account.js';
import AccountTransaction from '../src/models/AccountTransaction.js';

test('WALLET WITHDRAW -- money leaves the account and the wallet, with the number it went to', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/wallet_withdraw_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-wallet-withdraw-secret';
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
    const customer = await Customer.create({ name: 'Cuma', phone: '111' });
    const evc = await Account.create({ name: 'EVC Plus' });

    const dep = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 100, paymentAccountId: evc.id, reference: '615000111' });
    assert.equal(dep.status, 201, JSON.stringify(dep));
    assert.equal(dep.data.transaction.reference, '615000111');

    // More than the wallet holds is refused, nothing moves.
    const tooMuch = await request(`/customers/${customer.id}/wallet/withdraw`, { amount: 150, paymentAccountId: evc.id, reference: '615000111' });
    assert.equal(tooMuch.status, 400);
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 10000);

    const wd = await request(`/customers/${customer.id}/wallet/withdraw`, { amount: 30, paymentAccountId: evc.id, reference: '615000222', note: 'Customer asked for it back' });
    assert.equal(wd.status, 201, JSON.stringify(wd));
    assert.equal(wd.data.transaction.type, 'WITHDRAWAL');
    assert.equal(wd.data.transaction.amount, -30);
    assert.equal(wd.data.transaction.reference, '615000222');
    assert.equal(wd.data.transaction.accountName, 'EVC Plus');
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 7000);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 7000, 'paid out of the account');
    const out = await AccountTransaction.findOne({ type: 'WITHDRAWAL' });
    assert.equal(out.direction, 'OUT');
    assert.match(out.description, /615000222/);

    const hist = await request(`/customers/${customer.id}/wallet/history`, null, 'GET');
    assert.deepEqual(
      hist.data.transactions.map((t) => [t.type, t.amount, t.reference]),
      [
        ['WITHDRAWAL', -30, '615000222'],
        ['DEPOSIT', 100, '615000111'],
      ]
    );
    const byNumber = await request(`/customers/${customer.id}/wallet/history?q=000222`, null, 'GET');
    assert.equal(byNumber.data.transactions.length, 1);

    assert.equal((await request(`/customers/${customer.id}/wallet/withdraw`, { amount: 10 })).status, 400, 'account required');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
