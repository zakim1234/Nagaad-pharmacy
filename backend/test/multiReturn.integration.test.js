import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Sale from '../src/models/Sale.js';
import { closeDay } from '../src/services/dayCloseService.js';

test('TEST RT7-RT14 -- multi-item atomic return: combined value, rollback on invalid row, stock/WAC/debt/account reconciled exactly once', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/multireturn_test_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-multireturn-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const account = await Account.create({ name: 'EVC' });
  const customer = await Customer.create({ name: 'Multi Return Customer' });
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
    // The master prompt's own worked example: Amoxicillin 12@$5, Paracetamol
    // 5@$2, Bandage 3@$1 -- sold on one invoice, then a combined multi-item
    // return of all of them should total exactly $73.
    await request('/stock', {
      rows: [
        { name: 'Amoxicillin', quantity: 20, costPrice: 2, sellingPrice: 5, expiryDate: '2035-01-01' },
        { name: 'Paracetamol', quantity: 20, costPrice: 1, sellingPrice: 2, expiryDate: '2035-01-01' },
        { name: 'Bandage', quantity: 20, costPrice: 0.5, sellingPrice: 1, expiryDate: '2035-01-01' },
      ],
    });
    const amox = await InventoryItem.findOne({ name: 'Amoxicillin' });
    const para = await InventoryItem.findOne({ name: 'Paracetamol' });
    const band = await InventoryItem.findOne({ name: 'Bandage' });

    const draft = await request('/sales', {
      customerId: customer.id,
      items: [
        { itemId: amox.id, quantity: 12, unitPrice: 5 },
        { itemId: para.id, quantity: 5, unitPrice: 2 },
        { itemId: band.id, quantity: 3, unitPrice: 1 },
      ],
      paidAmount: 73,
      paymentAccountId: account.id,
    });
    assert.equal(draft.status, 201, JSON.stringify(draft));
    await closeDay({ user: admin });
    const sale = await Sale.findById(draft.data.id);

    // Sanity: everything sold, nothing returned yet.
    assert.equal((await InventoryItem.findById(amox.id)).quantity, 8); // 20-12
    assert.equal((await InventoryItem.findById(para.id)).quantity, 15); // 20-5
    assert.equal((await InventoryItem.findById(band.id)).quantity, 17); // 20-3
    const accountBefore = (await Account.findById(account.id)).currentBalanceCents;

    // TEST RT9: one invalid row (returning MORE than sold) must roll back
    // the ENTIRE combined return -- none of the valid rows should apply either.
    const invalidAttempt = await request(`/sales/${sale._id}/return`, {
      items: [
        { itemId: amox.id, quantity: 12 },
        { itemId: para.id, quantity: 5 },
        { itemId: band.id, quantity: 999 }, // invalid: exceeds sold quantity
      ],
      reason: 'should fail entirely',
    });
    assert.equal(invalidAttempt.status, 409, JSON.stringify(invalidAttempt));
    // Nothing changed: not even the valid Amoxicillin/Paracetamol rows applied.
    assert.equal((await InventoryItem.findById(amox.id)).quantity, 8);
    assert.equal((await InventoryItem.findById(para.id)).quantity, 15);
    assert.equal((await InventoryItem.findById(band.id)).quantity, 17);
    assert.equal((await Account.findById(account.id)).currentBalanceCents, accountBefore);
    assert.equal((await Sale.findById(sale._id)).returns.length, 0);

    // TEST RT8 + RT7 + RT10-RT13: one valid combined return of all three items.
    const combinedReturn = await request(`/sales/${sale._id}/return`, {
      items: [
        { itemId: amox.id, quantity: 12 },
        { itemId: para.id, quantity: 5 },
        { itemId: band.id, quantity: 3 },
      ],
      reason: 'customer changed mind',
    });
    assert.equal(combinedReturn.status, 200, JSON.stringify(combinedReturn));
    assert.equal(combinedReturn.data.returns.length, 1); // ONE return record for all three items
    const ret = combinedReturn.data.returns[0];
    assert.equal(ret.items.length, 3);
    // RT7: combined return value = 12*5 + 5*2 + 3*1 = 60+10+3 = 73.
    assert.equal(ret.amount, 73);

    // RT10: stock restored for ALL returned items.
    assert.equal((await InventoryItem.findById(amox.id)).quantity, 20);
    assert.equal((await InventoryItem.findById(para.id)).quantity, 20);
    assert.equal((await InventoryItem.findById(band.id)).quantity, 20);

    // RT11 + RT12: invoice balance and customer debt recalculated correctly
    // -- invoice was fully paid ($73), fully returned, so outstanding is $0
    // and nothing is owed; account gets refunded the paid portion exactly once.
    const saleAfter = await Sale.findById(sale._id);
    assert.equal(saleAfter.totalCents, 0);
    assert.equal(saleAfter.outstandingCents, 0);

    // RT13: account reconciled exactly once (one refund of the full $73 paid amount).
    const accountAfter = await Account.findById(account.id);
    assert.equal(accountAfter.currentBalanceCents, accountBefore - 7300); // refund reduces the account (money going back out)

    // RT14: WAC preserved correctly -- returned units blended back in using
    // the invoice's OWN historical per-unit cost snapshot, not today's price.
    const amoxAfter = await InventoryItem.findById(amox.id);
    assert.equal(saleAfter.items.find((i) => String(i.item) === String(amox.id)).costPriceCents, 200); // historical WAC at sale time, untouched
    assert.equal(amoxAfter.costPriceCents, 200); // returning at the exact WAC it was sold at doesn't move the average

    // RT16/RT17 equivalent at the data layer: the combined return is
    // reachable via GET /sales/:id/receipt for reprint at any time later.
    const receipt = await request(`/sales/${sale._id}/receipt`, null, 'GET');
    assert.equal(receipt.status, 200);
    assert.equal(receipt.data.returns[0].items.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
});
