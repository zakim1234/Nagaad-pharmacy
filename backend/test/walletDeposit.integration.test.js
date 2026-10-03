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
import CustomerWalletTransaction from '../src/models/CustomerWalletTransaction.js';
import Payment from '../src/models/Payment.js';
import CustomerLedger from '../src/models/CustomerLedger.js';
import Sale from '../src/models/Sale.js';
import { closeDay } from '../src/services/dayCloseService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-wallet-deposit-secret';
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
  return { admin, server, request };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// Puts $50 of debt on a customer: sells $50 of stock on credit, then Close
// Day confirms it (outstandingCents/balanceCents are only posted then).
async function giveDebt({ admin, request }, customer, account, item, amount) {
  const sale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: amount }], paidAmount: 0, paymentAccountId: account.id });
  assert.equal(sale.status, 201, JSON.stringify(sale));
  await closeDay({ user: admin });
  return sale.data.id;
}

test('WALLET DEPOSIT -- clears outstanding debt first (oldest invoice), leftover tops up the wallet', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('deposit_debt');
  try {
    const customer = await Customer.create({ name: 'Cuma', phone: '111' });
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-1', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 }); // $10/unit

    // $50 debt (5 units @ $10, $0 paid).
    await giveDebt({ admin, request }, customer, account, item, 5);
    assert.equal((await Customer.findById(customer.id)).balanceCents, 5000);

    // Deposit $80: $50 clears the debt, $30 left over goes to the wallet.
    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 80, paymentAccountId: account.id, note: 'cash' });
    assert.equal(deposit.status, 201, JSON.stringify(deposit));
    assert.equal(deposit.data.debtCleared, 50);
    assert.equal(deposit.data.walletCredited, 30);
    assert.equal(deposit.data.customer.balance, 0);
    assert.equal(deposit.data.customer.walletBalance, 30);

    const after = await Customer.findById(customer.id);
    assert.equal(after.balanceCents, 0);
    assert.equal(after.walletBalanceCents, 3000);
    assert.equal(after.totalPaidCents, 5000);

    // The cash landed in the account exactly once, for the full $80 -- not $80 + $50.
    const accountAfter = await Account.findById(account.id);
    assert.equal(accountAfter.currentBalanceCents, 8000);
    const txns = await AccountTransaction.find({ account: account.id, status: 'POSTED' }).sort({ createdAt: 1 });
    assert.equal(txns.length, 1);
    assert.equal(txns[0].type, 'DEPOSIT');
    assert.equal(txns[0].amountCents, 8000);

    // A Payment (debt_payment) and CustomerLedger entry were created for the debt-clearing portion.
    const payment = await Payment.findOne({ customer: customer.id, type: 'debt_payment' });
    assert.ok(payment, 'a Payment record exists for the auto-applied debt');
    assert.equal(payment.amountCents, 5000);
    assert.equal(payment.allocations.length, 1);
    assert.equal(String(payment.accountTransaction), String(txns[0]._id), 'points at the deposit\'s own transaction, not a second one');
    const ledger = await CustomerLedger.findOne({ payment: payment._id });
    assert.ok(ledger);
    assert.equal(ledger.amountCents, -5000);
    assert.match(ledger.description, /auto-applied/i);

    // A CustomerWalletTransaction records the $30 that reached the wallet, with a note describing the split.
    const walletTxn = await CustomerWalletTransaction.findOne({ customer: customer.id, type: 'DEPOSIT' });
    assert.ok(walletTxn);
    assert.equal(walletTxn.amountCents, 3000);
    assert.match(walletTxn.note, /applied to debt.*added to wallet/i);
  } finally {
    await teardown(server);
  }
});

test('WALLET DEPOSIT -- deposit smaller than the debt: all of it clears debt, nothing to the wallet', { timeout: 60000 }, async () => {
  const { admin, server, request } = await setup('deposit_partial');
  try {
    const customer = await Customer.create({ name: 'Khadra', phone: '222' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-2', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });

    await giveDebt({ admin, request }, customer, account, item, 5); // $50 debt
    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 30, paymentAccountId: account.id });
    assert.equal(deposit.status, 201, JSON.stringify(deposit));
    assert.equal(deposit.data.debtCleared, 30);
    assert.equal(deposit.data.walletCredited, 0);
    assert.equal(deposit.data.customer.balance, 20, 'still owes 50 - 30');
    assert.equal(deposit.data.customer.walletBalance, 0);
    assert.equal(deposit.data.transaction, null, 'no wallet transaction is created when nothing reaches the wallet');
    assert.equal(await CustomerWalletTransaction.countDocuments({ customer: customer.id }), 0);
  } finally {
    await teardown(server);
  }
});

test('WALLET DEPOSIT -- no debt: behaves exactly as before, entire deposit becomes wallet credit', { timeout: 60000 }, async () => {
  const { server, request } = await setup('deposit_no_debt');
  try {
    const customer = await Customer.create({ name: 'Omar', phone: '333' });
    const account = await Account.create({ name: 'Cash Drawer' });

    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 45, paymentAccountId: account.id });
    assert.equal(deposit.status, 201, JSON.stringify(deposit));
    assert.equal(deposit.data.debtCleared, 0);
    assert.equal(deposit.data.walletCredited, 45);
    assert.equal(deposit.data.customer.walletBalance, 45);
    assert.equal(await Payment.countDocuments({ customer: customer.id }), 0);
    assert.equal(await CustomerLedger.countDocuments({ customer: customer.id }), 0);
  } finally {
    await teardown(server);
  }
});

// A credit sale created while the wallet was empty, with money deposited
// before Close Day confirms it: Close Day must take the debt from the
// wallet instead of leaving the customer owing while holding credit.
test('WALLET AUTO-PAY -- Close Day covers a credit sale from wallet money deposited after the Draft', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('autopay_close');
  try {
    const customer = await Customer.create({ name: 'Cumar', phone: '444' });
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Biotin', itemCode: 'BIO-1', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });

    const sale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 0 }); // $50 credit
    assert.equal(sale.status, 201, JSON.stringify(sale));
    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 90, paymentAccountId: account.id });
    assert.equal(deposit.data.walletCredited, 90, 'Draft is not debt yet, so all of it reaches the wallet');

    await closeDay({ user: admin });

    const after = await Customer.findById(customer.id);
    assert.equal(after.balanceCents, 0, 'no debt left');
    assert.equal(after.walletBalanceCents, 4000, '$90 - $50');
    const confirmed = await Sale.findById(sale.data.id);
    assert.equal(confirmed.walletAmountCents, 5000);
    assert.equal(confirmed.outstandingCents, 0);
    assert.equal(confirmed.balanceAddedCents, 0);
    const walletTxn = await CustomerWalletTransaction.findOne({ customer: customer.id, type: 'SALE_PAYMENT' });
    assert.equal(walletTxn.amountCents, -5000);
    assert.match(walletTxn.note, /Applied to sale/);

    // Still reversible, and the reversal gives the $50 back to the wallet.
    const reversed = await request(`/sales/${sale.data.id}/reverse`, { reason: 'test' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed));
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 9000);
  } finally {
    await teardown(server);
  }
});

test('WALLET AUTO-PAY -- wallet smaller than the debt: all of it is used, the rest stays owed', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('autopay_partial');
  try {
    const customer = await Customer.create({ name: 'Asha', phone: '555' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-3', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });

    const sale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 0 });
    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 20, paymentAccountId: account.id });
    await closeDay({ user: admin });

    const after = await Customer.findById(customer.id);
    assert.equal(after.walletBalanceCents, 0);
    assert.equal(after.balanceCents, 3000);
    assert.equal((await Sale.findById(sale.data.id)).outstandingCents, 3000);
  } finally {
    await teardown(server);
  }
});

test('WALLET AUTO-PAY -- wallet money returned by a reversal pays the customer\'s other debt', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('autopay_reverse');
  try {
    const customer = await Customer.create({ name: 'Hodan', phone: '666' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-4', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });

    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 30, paymentAccountId: account.id });
    const walletSale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 3 }], paidAmount: 0, walletAmount: 30 });
    assert.equal(walletSale.status, 201, JSON.stringify(walletSale));
    const creditSale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 0 });
    await closeDay({ user: admin });
    assert.equal((await Customer.findById(customer.id)).balanceCents, 5000);

    const reversed = await request(`/sales/${walletSale.data.id}/reverse`, { reason: 'test' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed));

    const after = await Customer.findById(customer.id);
    assert.equal(after.walletBalanceCents, 0, 'the returned $30 went straight to the debt');
    assert.equal(after.balanceCents, 2000);
    assert.equal(after.totalPaidCents, 3000);
    assert.equal((await Sale.findById(creditSale.data.id)).outstandingCents, 2000);
    const payment = await Payment.findOne({ customer: customer.id, type: 'debt_payment' });
    assert.equal(payment.amountCents, 3000);
    assert.match(payment.notes, /from wallet/i);
    assert.ok(await CustomerLedger.findOne({ payment: payment._id, amountCents: -3000 }));
  } finally {
    await teardown(server);
  }
});

test('WALLET RETURN -- returning items from a wallet-paid invoice gives the money back to the wallet', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('wallet_return');
  try {
    const customer = await Customer.create({ name: 'Cumar', phone: '777' });
    const account = await Account.create({ name: 'Cash Drawer' });
    const item = await InventoryItem.create({ name: 'Amoxicillin', itemCode: 'AMX-1', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });

    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 100, paymentAccountId: account.id });
    const sale = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 0, walletAmount: 50 });
    assert.equal(sale.status, 201, JSON.stringify(sale));
    await closeDay({ user: admin });
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 5000);

    const ret = await request(`/sales/${sale.data.id}/return`, { items: [{ itemId: item.id, quantity: 2 }], reason: 'test' });
    assert.equal(ret.status, 200, JSON.stringify(ret));

    const after = await Customer.findById(customer.id);
    assert.equal(after.walletBalanceCents, 7000, '$20 back into the wallet');
    assert.equal(after.balanceCents, 0);
    const updated = await Sale.findById(sale.data.id);
    assert.equal(updated.walletAmountCents, 3000);
    assert.equal(updated.returns[0].walletRefundCents, 2000);
    assert.equal(updated.returns[0].refundCents, 0, 'no cash leaves the account');
    assert.equal(await AccountTransaction.countDocuments({ type: 'REFUND' }), 0, 'no refund posted to any account');
    assert.equal(ret.data.returns[0].walletRefund, 20);

    // A later full cancel gives back only the wallet amount still on the invoice.
    const reversed = await request(`/sales/${sale.data.id}/reverse`, { reason: 'test' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed));
    assert.equal((await Customer.findById(customer.id)).walletBalanceCents, 10000);
  } finally {
    await teardown(server);
  }
});
