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
    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 80, paymentAccountId: account.id, note: 'cash', applyToDebt: true });
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
    const deposit = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 30, paymentAccountId: account.id, applyToDebt: true });
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
    const customer = await Customer.create({ name: 'Cumar', phone: '444', walletAutoPay: true });
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
    const customer = await Customer.create({ name: 'Asha', phone: '555', walletAutoPay: true });
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
    const customer = await Customer.create({ name: 'Hodan', phone: '666', walletAutoPay: true });
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

test('WALLET CHOICE -- by default a deposit stays in the wallet; the debt is paid from it only when chosen', { timeout: 90000 }, async () => {
  const ctx = await setup('wallet_choice');
  const { server, request } = ctx;
  try {
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Choice Item', itemCode: 'CHOICE-1', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 }); // $10/unit
    const customer = await Customer.create({ name: 'Jilbo', phone: '888' });
    await giveDebt(ctx, customer, account, item, 10); // $100 debt
    assert.equal((await Customer.findById(customer.id)).balanceCents, 10000);

    // Deposit with no choice: all of it stays in the wallet, the debt stays.
    const kept = await request(`/customers/${customer.id}/wallet/deposit`, { amount: 60, paymentAccountId: account.id });
    assert.equal(kept.status, 201, JSON.stringify(kept));
    let c = await Customer.findById(customer.id);
    assert.deepEqual([c.walletBalanceCents, c.balanceCents], [6000, 10000]);

    // The customer agrees: pay 40 of the debt from the wallet.
    assert.equal((await request(`/customers/${customer.id}/wallet/pay-debt`, { amount: 70 })).status, 400, 'more than the wallet holds');
    const part = await request(`/customers/${customer.id}/wallet/pay-debt`, { amount: 40 });
    assert.equal(part.status, 200, JSON.stringify(part));
    assert.equal(part.data.applied, 40);
    c = await Customer.findById(customer.id);
    assert.deepEqual([c.walletBalanceCents, c.balanceCents], [2000, 6000]);

    // Turn auto-pay on: the next deposit goes to the debt by itself.
    const on = await request(`/customers/${customer.id}/wallet/auto-pay`, { enabled: true }, 'PUT');
    assert.equal(on.data.walletAutoPay, true);
    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 10, paymentAccountId: account.id });
    c = await Customer.findById(customer.id);
    assert.deepEqual([c.walletBalanceCents, c.balanceCents], [2000, 5000]);

    // Explicit "keep in wallet" wins over auto-pay.
    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 5, paymentAccountId: account.id, applyToDebt: false });
    c = await Customer.findById(customer.id);
    assert.deepEqual([c.walletBalanceCents, c.balanceCents], [2500, 5000]);
  } finally {
    await teardown(server);
  }
});

test('CANCEL CUSTOMER PAYMENT -- debt comes back; money kept in the wallet or given back from the account', { timeout: 90000 }, async () => {
  const ctx = await setup('cancel_cust_payment');
  const { server, request } = ctx;
  try {
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Cancel Item', itemCode: 'CANCEL-1', quantity: 1000, costPriceCents: 100, sellingPriceCents: 1000 });
    const customer = await Customer.create({ name: 'Dr Jilbo', phone: '999' });
    await giveDebt(ctx, customer, account, item, 10); // $100 debt
    const balance = async () => (await Account.findById(account.id)).currentBalanceCents;
    const startBalance = await balance();

    // 1. A deposit that paid $60 of the debt -> cancel, keep the money in the wallet.
    await request(`/customers/${customer.id}/wallet/deposit`, { amount: 60, paymentAccountId: account.id, applyToDebt: true });
    let c = await Customer.findById(customer.id);
    assert.equal(c.balanceCents, 4000);
    const pay1 = await Payment.findOne({ customer: customer.id, type: 'debt_payment' });
    const kept = await request(`/customers/${customer.id}/payments/${pay1.id}/cancel`, { refundTo: 'WALLET', reason: 'wrong' });
    assert.equal(kept.status, 200, JSON.stringify(kept));
    c = await Customer.findById(customer.id);
    assert.deepEqual([c.balanceCents, c.walletBalanceCents], [10000, 6000], 'owes 100 again, 60 in the wallet');
    assert.equal(await balance(), startBalance + 6000, 'the deposit itself stays in the account');
    assert.equal((await Sale.findOne({ customer: customer.id })).outstandingCents, 10000);
    assert.equal((await request(`/customers/${customer.id}/payments/${pay1.id}/cancel`, {})).status, 409, 'only once');

    // 2. A normal debt payment of $30 -> cancel, money given back out of the account.
    const pay2 = await request(`/customers/${customer.id}/payments`, { amount: 30, paymentAccountId: account.id });
    assert.equal(pay2.status, 201, JSON.stringify(pay2));
    const pay2Doc = await Payment.findOne({ customer: customer.id, status: 'POSTED', type: 'debt_payment' });
    const back = await request(`/customers/${customer.id}/payments/${pay2Doc.id}/cancel`, { refundTo: 'ACCOUNT', reference: '615777888' });
    assert.equal(back.status, 200, JSON.stringify(back));
    assert.equal((await Payment.findById(pay2Doc.id)).refundReference, '615777888', 'the number it was sent to is kept');
    assert.equal(await balance(), startBalance + 6000, '30 came in and went back out');
    c = await Customer.findById(customer.id);
    assert.equal(c.balanceCents, 10000);

    // The statement leaves cancelled payments out.
    const st = await request(`/customers/${customer.id}/statement`, undefined, 'GET');
    assert.equal(st.status, 200, JSON.stringify(st));
    assert.equal(st.data.summary.totalPayments, 0);
    const hist = await request(`/customers/${customer.id}/history`, undefined, 'GET');
    assert.ok(hist.data.payments.every((p) => p.status === 'CANCELLED'));
    assert.ok(hist.data.timeline.some((t) => t.type === 'PAYMENT_CANCELLED'));
  } finally {
    await teardown(server);
  }
});


test('CANCEL PAID INVOICE -- paid later by a debt payment: allowed, the money goes to the wallet', { timeout: 90000 }, async () => {
  const ctx = await setup('cancel_paid_later');
  try {
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Bio', itemCode: 'BIO-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 2500 });
    const customer = await Customer.create({ name: 'Cash Payer', phone: '101' });
    const saleId = await giveDebt(ctx, customer, account, item, 1); // $25 owed
    const paid = await ctx.request(`/customers/${customer.id}/payments`, { amount: 25, paymentAccountId: account.id });
    assert.equal(paid.status, 201, JSON.stringify(paid));
    const accountBefore = (await Account.findById(account.id)).currentBalanceCents;

    const reversed = await ctx.request(`/sales/${saleId}/reverse`, { reason: 'customer changed mind' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed));
    const c = await Customer.findById(customer.id);
    assert.deepEqual([c.balanceCents, c.walletBalanceCents], [0, 2500], 'nothing owed, the $25 is in the wallet');
    assert.equal((await Account.findById(account.id)).currentBalanceCents, accountBefore, 'no cash left the account');
    assert.equal((await InventoryItem.findById(item.id)).quantity, 100, 'stock back');
  } finally {
    await teardown(ctx.server);
  }
});

test('CANCEL PAID INVOICE -- cash paid at the sale goes to the wallet, or is handed back when chosen', { timeout: 90000 }, async () => {
  const ctx = await setup('cancel_paid_cash');
  try {
    const account = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Bio', itemCode: 'BIO-2', quantity: 100, costPriceCents: 100, sellingPriceCents: 2000 });
    const a = await Customer.create({ name: 'Wallet Back', phone: '102' });
    const b = await Customer.create({ name: 'Cash Back', phone: '103' });
    const saleA = await ctx.request('/sales', { customerId: a.id, items: [{ itemId: item.id, quantity: 2 }], paidAmount: 40, paymentAccountId: account.id });
    const saleB = await ctx.request('/sales', { customerId: b.id, items: [{ itemId: item.id, quantity: 1 }], paidAmount: 20, paymentAccountId: account.id });
    await closeDay({ user: ctx.admin });
    const balance = async () => (await Account.findById(account.id)).currentBalanceCents;
    const start = await balance();

    assert.equal((await ctx.request(`/sales/${saleA.data.id}/reverse`, {})).status, 200);
    assert.equal((await Customer.findById(a.id)).walletBalanceCents, 4000, 'default: into the wallet');
    assert.equal(await balance(), start);

    assert.equal((await ctx.request(`/sales/${saleB.data.id}/reverse`, { refundTo: 'ACCOUNT' })).status, 200);
    assert.equal((await Customer.findById(b.id)).walletBalanceCents, 0);
    assert.equal(await balance(), start - 2000, 'handed back out of the account');
  } finally {
    await teardown(ctx.server);
  }
});

test('DELETE ITEM -- always allowed; its old invoices still return, cancel and close', { timeout: 90000 }, async () => {
  const ctx = await setup('delete_item');
  try {
    const account = await Account.create({ name: 'Cash' });
    const sold = await InventoryItem.create({ name: 'Gvagzol Supp', itemCode: 'GV-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 500 });
    const pending = await InventoryItem.create({ name: 'Pending Item', itemCode: 'PD-1', quantity: 50, costPriceCents: 100, sellingPriceCents: 300 });
    const customer = await Customer.create({ name: 'History Customer', phone: '201' });

    // A confirmed sale of `sold`, then the item is deleted.
    const saleId = await giveDebt(ctx, customer, account, sold, 4); // $20 owed
    const del = await ctx.request(`/inventory/${sold.id}`, undefined, 'DELETE');
    assert.equal(del.status, 200, JSON.stringify(del));
    assert.equal(await InventoryItem.countDocuments({ _id: sold.id }), 0);

    // Its invoice still returns and cancels.
    const ret = await ctx.request(`/sales/${saleId}/return`, { items: [{ itemId: sold.id, quantity: 1 }], reason: 'test' });
    assert.equal(ret.status, 200, JSON.stringify(ret));
    assert.equal((await Customer.findById(customer.id)).balanceCents, 1500);
    const rev = await ctx.request(`/sales/${saleId}/reverse`, { reason: 'test' });
    assert.equal(rev.status, 200, JSON.stringify(rev));
    assert.equal((await Customer.findById(customer.id)).balanceCents, 0);
  } finally {
    await teardown(ctx.server);
  }
});

test('DELETE ITEM -- on a pending invoice: Close Day still confirms it', { timeout: 90000 }, async () => {
  const ctx = await setup('delete_item_pending');
  try {
    const account = await Account.create({ name: 'Cash' });
    const item = await InventoryItem.create({ name: 'Pending Item', itemCode: 'PD-2', quantity: 50, costPriceCents: 100, sellingPriceCents: 300 });
    const customer = await Customer.create({ name: 'Pending Customer', phone: '202' });
    const draft = await ctx.request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 2 }], paidAmount: 0, paymentAccountId: account.id });
    assert.equal(draft.status, 201, JSON.stringify(draft));
    assert.equal((await ctx.request(`/inventory/${item.id}`, undefined, 'DELETE')).status, 200);
    await closeDay({ user: ctx.admin });
    assert.equal((await Sale.findById(draft.data.id)).status, 'CONFIRMED');
    assert.equal((await Customer.findById(customer.id)).balanceCents, 600);
  } finally {
    await teardown(ctx.server);
  }
});

test('DEBTORS STATEMENT -- only customers who owe, most owed first', { timeout: 90000 }, async () => {
  const ctx = await setup('debtors');
  try {
    const account = await Account.create({ name: 'Cash' });
    const item = await InventoryItem.create({ name: 'D', itemCode: 'D-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 1000 });
    const small = await Customer.create({ name: 'Small Debt', phone: '301' });
    const big = await Customer.create({ name: 'Big Debt', phone: '302' });
    await Customer.create({ name: 'No Debt', phone: '303' });
    const s1 = await ctx.request('/sales', { customerId: small.id, items: [{ itemId: item.id, quantity: 1 }], paidAmount: 0, paymentAccountId: account.id });
    const s2 = await ctx.request('/sales', { customerId: big.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 0, paymentAccountId: account.id });
    assert.equal(s1.status + s2.status, 402);
    await closeDay({ user: ctx.admin });

    const res = await ctx.request('/customers/debtors', undefined, 'GET');
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.deepEqual(res.data.customers.map((c) => [c.name, c.balance, c.unpaidInvoices]), [['Big Debt', 50, 1], ['Small Debt', 10, 1]]);
    assert.equal(res.data.totalOwed, 60);
  } finally {
    await teardown(ctx.server);
  }
});
