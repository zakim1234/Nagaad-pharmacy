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
import InventoryLot from '../src/models/InventoryLot.js';
import Purchase from '../src/models/Purchase.js';
import Supplier from '../src/models/Supplier.js';
import { closeDay } from '../src/services/dayCloseService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-expenses-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const tokenFor = (u) => jwt.sign({ sub: String(u._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST', user = admin) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(user)}` },
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

test('EXPENSES -- deducts the account, validates input, is permission-gated, and voids cleanly', { timeout: 60000 }, async () => {
  const { admin, server, request } = await setup('expenses_basic');
  try {
    const evc = await Account.create({ name: 'EVC Plus', currentBalanceCents: 50000 }); // $500
    const inactive = await Account.create({ name: 'Old Wallet', isActive: false, currentBalanceCents: 1000 });
    const noAccess = await User.create({ username: 'noaccess', name: 'No Access', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    const clerk = await User.create({ username: 'clerk', name: 'Clerk', passwordHash: 'unused', role: 'cashier', permissions: ['expenses'] });

    // Permission gate: no 'expenses' module -> 403 on read and write.
    assert.equal((await request('/expenses', null, 'GET', noAccess)).status, 403);
    assert.equal((await request('/expenses', { category: 'Rent', amount: 10, paymentAccountId: evc.id }, 'POST', noAccess)).status, 403);

    // Validation.
    const good = { category: 'Salaries', amount: 50, paymentAccountId: evc.id, note: "Cumar's salary", date: '2026-09-15' };
    assert.equal((await request('/expenses', { ...good, category: 'Fun' })).status, 400);
    assert.equal((await request('/expenses', { ...good, amount: 0 })).status, 400);
    assert.equal((await request('/expenses', { ...good, amount: -5 })).status, 400);
    assert.equal((await request('/expenses', { ...good, amount: 'abc' })).status, 400);
    assert.equal((await request('/expenses', { ...good, paymentAccountId: undefined })).status, 400);
    assert.equal((await request('/expenses', { ...good, paymentAccountId: inactive.id })).status, 400);
    assert.equal((await request('/expenses', { ...good, date: 'not-a-date' })).status, 400);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 50000, 'rejected requests must not touch the balance');

    // Create: account balance drops by exactly the amount, one OUT EXPENSE transaction is linked.
    const created = await request('/expenses', good, 'POST', clerk);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.match(created.data.expenseNumber, /^EXP-\d{4}-000001$/);
    assert.equal(created.data.amount, 50);
    assert.equal(created.data.createdByName, 'Clerk');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 45000);
    const txns = await AccountTransaction.find({ referenceType: 'Expense' });
    assert.equal(txns.length, 1);
    assert.equal(txns[0].type, 'EXPENSE');
    assert.equal(txns[0].direction, 'OUT');
    assert.equal(txns[0].status, 'POSTED');
    assert.equal(txns[0].amountCents, 5000);
    assert.equal(String(txns[0].referenceId), created.data.id);
    assert.equal(txns[0].balanceAfterCents, 45000);

    // List + summary.
    await request('/expenses', { category: 'Rent', amount: 20.5, paymentAccountId: evc.id, date: '2026-09-10' });
    const list = await request('/expenses', null, 'GET');
    assert.equal(list.status, 200);
    assert.equal(list.data.expenses.length, 2);
    const byCategory = await request('/expenses?category=Rent', null, 'GET');
    assert.equal(byCategory.data.expenses.length, 1);
    assert.equal(byCategory.data.summary.totalFiltered, 20.5);
    assert.equal((await request('/expenses?category=Nope', null, 'GET')).status, 400);

    // Void is admin/manager only, even for a user who may create expenses.
    assert.equal((await request(`/expenses/${created.data.id}/void`, { reason: 'x' }, 'POST', clerk)).status, 403);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 45000 - 2050);

    const voided = await request(`/expenses/${created.data.id}/void`, { reason: 'Entered twice' });
    assert.equal(voided.status, 200, JSON.stringify(voided));
    assert.equal(voided.data.status, 'VOIDED');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 50000 - 2050, 'void returns the money');
    assert.equal((await request(`/expenses/${created.data.id}/void`, {})).status, 409, 'double void is rejected');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 50000 - 2050, 'double void must not move money again');

    // Voided expenses drop out of the default list and the reports.
    assert.equal((await request('/expenses', null, 'GET')).data.expenses.length, 1);
    assert.equal((await request('/expenses?includeVoided=true', null, 'GET')).data.expenses.length, 2);
    const report = await request('/reports/expenses?from=2026-09-01&to=2026-09-30', null, 'GET');
    assert.equal(report.status, 200, JSON.stringify(report));
    assert.equal(report.data.totalExpenses, 20.5);
    assert.deepEqual(report.data.byCategory.map((c) => [c.category, c.amount, c.percent]), [['Rent', 20.5, 100]]);
  } finally {
    await teardown(server);
  }
});

test('REPORTS -- payment methods, returns, stock and expiry reports', { timeout: 120000 }, async () => {
  const { admin, server, request } = await setup('expenses_reports');
  try {
    const customer = await Customer.create({ name: 'Walk-in', phone: '999' });
    const cash = await Account.create({ name: 'Cash Drawer' });
    const evc = await Account.create({ name: 'EVC Plus' });
    const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-1', quantity: 100, costPriceCents: 100, sellingPriceCents: 500 });

    // Two $25 sales (5 units @ $5, cost $1): one paid to Cash, one to EVC.
    const s1 = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 25, paymentAccountId: cash.id });
    const s2 = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 5 }], paidAmount: 25, paymentAccountId: evc.id });
    assert.equal(s1.status, 201, JSON.stringify(s1));
    assert.equal(s2.status, 201, JSON.stringify(s2));
    await closeDay({ user: admin });

    // Return 2 units from the first sale ($10 of revenue, $2 of cost).
    const ret = await request(`/sales/${s1.data.id}/return`, { items: [{ itemId: item.id, quantity: 2 }], reason: 'Damaged box' });
    assert.equal(ret.status, 200, JSON.stringify(ret));

    // $12.50 + $7.50 of expenses.
    assert.equal((await request('/expenses', { category: 'Rent', amount: 12.5, paymentAccountId: cash.id })).status, 201);
    assert.equal((await request('/expenses', { category: 'Transport', amount: 7.5, paymentAccountId: evc.id })).status, 201);

    // Payment methods: $25 posted into each account at Close Day.
    const pm = await request('/reports/payment-methods?range=year', null, 'GET');
    assert.equal(pm.status, 200, JSON.stringify(pm));
    assert.equal(pm.data.totalCollected, 50);
    assert.deepEqual(pm.data.methods.map((m) => [m.account, m.total, m.percent]).sort(), [['Cash Drawer', 25, 50], ['EVC Plus', 25, 50]]);

    // Sales returns reconcile with the invoice.
    const sr = await request('/reports/sales-returns?range=year', null, 'GET');
    assert.equal(sr.status, 200, JSON.stringify(sr));
    assert.equal(sr.data.totalReturns, 1);
    assert.equal(sr.data.totalReturnValue, 10);
    assert.equal(sr.data.returns[0].quantity, 2);
    assert.equal(sr.data.returns[0].reason, 'Damaged box');
    assert.equal(sr.data.returns[0].receiptNumber, s1.data.receiptNumber);

    // Purchase returns = voided purchases, by void date.
    const supplier = await Supplier.create({ name: 'Cabdi' });
    await Purchase.create({
      purchaseNumber: 'PINV-T-1', supplier: supplier._id, supplierName: 'Cabdi',
      items: [{ item: item._id, itemName: 'Widget', quantity: 4, unitCostCents: 250, subtotalCents: 1000 }],
      totalCostCents: 1000, status: 'voided', voidedAt: new Date(), voidedReason: 'Wrong goods',
    });
    await Purchase.create({
      purchaseNumber: 'PINV-T-2', supplier: supplier._id, supplierName: 'Cabdi',
      items: [{ item: item._id, itemName: 'Widget', quantity: 1, unitCostCents: 250, subtotalCents: 250 }],
      totalCostCents: 250, status: 'completed',
    });
    const pr = await request('/reports/purchase-returns?range=year', null, 'GET');
    assert.equal(pr.status, 200, JSON.stringify(pr));
    assert.equal(pr.data.totalReturns, 1);
    assert.equal(pr.data.totalReturnValue, 10);
    assert.equal(pr.data.returns[0].purchaseNumber, 'PINV-T-1');

    // Low stock: honours each item's own Minimum Stock; out-of-stock listed, inactive skipped.
    await InventoryItem.create({ name: 'Bandage', itemCode: 'BAND-1', quantity: 3, lowStockThreshold: 10, costPriceCents: 50, sellingPriceCents: 100 });
    await InventoryItem.create({ name: 'Gauze', itemCode: 'GAUZ-1', quantity: 0, lowStockThreshold: 5, costPriceCents: 50, sellingPriceCents: 100 });
    await InventoryItem.create({ name: 'Plaster', itemCode: 'PLAS-1', quantity: 8, lowStockThreshold: 5, costPriceCents: 50, sellingPriceCents: 100 });
    await InventoryItem.create({ name: 'Retired', itemCode: 'RET-1', quantity: 1, lowStockThreshold: 5, status: 'inactive', costPriceCents: 50, sellingPriceCents: 100 });
    const low = await request('/reports/low-stock', null, 'GET');
    assert.equal(low.status, 200, JSON.stringify(low));
    assert.deepEqual(low.data.items.map((i) => [i.itemName, i.status, i.minimumStock]), [['Gauze', 'OUT', 5], ['Bandage', 'LOW', 10]]);
    assert.equal(low.data.lowCount, 1);
    assert.equal(low.data.outCount, 1);

    // Expiry: batch-level rows, plus a whole-item fallback for legacy stock with no lot.
    const day = 86400000;
    const amox = await InventoryItem.create({ name: 'Amoxicillin 500mg', itemCode: 'AMOX-1', quantity: 12, costPriceCents: 500, sellingPriceCents: 900, batchNumber: 'B-2201' });
    await InventoryLot.create({ item: amox._id, stockSerial: 'STK-OLD', unitCostCents: 500, originalQuantity: 12, remainingQuantity: 12, expiryDate: new Date(Date.now() - 5 * day) });
    await InventoryLot.create({ item: amox._id, stockSerial: 'STK-NEW', unitCostCents: 500, originalQuantity: 5, remainingQuantity: 5, expiryDate: new Date(Date.now() + 10 * day) });
    await InventoryLot.create({ item: amox._id, stockSerial: 'STK-EMPTY', unitCostCents: 500, originalQuantity: 5, remainingQuantity: 0, expiryDate: new Date(Date.now() - 2 * day) });
    await InventoryItem.create({ name: 'Old Syrup', itemCode: 'SYR-1', quantity: 4, costPriceCents: 300, sellingPriceCents: 600, expiryDate: new Date(Date.now() - day) });
    await InventoryItem.create({ name: 'Fresh Syrup', itemCode: 'SYR-2', quantity: 4, costPriceCents: 300, sellingPriceCents: 600, expiryDate: new Date(Date.now() + 200 * day) });

    const expired = await request('/reports/expired-products?mode=expired', null, 'GET');
    assert.equal(expired.status, 200, JSON.stringify(expired));
    assert.deepEqual(expired.data.items.map((i) => [i.itemName, i.batch, i.quantity, i.value]), [
      ['Amoxicillin 500mg', 'STK-OLD', 12, 60],
      ['Old Syrup', '', 4, 12],
    ]);
    assert.equal(expired.data.totalValue, 72);
    assert.equal(expired.data.totalQuantity, 16);

    const near = await request('/reports/expired-products?mode=near&days=30', null, 'GET');
    assert.deepEqual(near.data.items.map((i) => [i.itemName, i.batch, i.quantity]), [['Amoxicillin 500mg', 'STK-NEW', 5]]);
    assert.equal((await request('/reports/expired-products?mode=near&days=0', null, 'GET')).status, 400);
    assert.equal((await request('/reports/expired-products?mode=near&days=abc', null, 'GET')).status, 400);
  } finally {
    await teardown(server);
  }
});

test('PRODUCT FIELDS -- generic name, manufacturer, batch, barcode and Minimum Stock', { timeout: 60000 }, async () => {
  const { server, request } = await setup('expenses_fields');
  try {
    const body = { name: 'Amoxicillin 500mg', costPrice: 2, sellingPrice: 4, genericName: 'Amoxicillin', manufacturer: 'Pfizer', batchNumber: 'B-2201', barcode: '6001234567890', lowStockThreshold: 15 };
    const created = await request('/inventory', body);
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.genericName, 'Amoxicillin');
    assert.equal(created.data.manufacturer, 'Pfizer');
    assert.equal(created.data.batchNumber, 'B-2201');
    assert.equal(created.data.barcode, '6001234567890');
    assert.equal(created.data.lowStockThreshold, 15);

    // Barcodes must be unique across items (they identify a product at the scanner).
    const dup = await request('/inventory', { ...body, name: 'Other', batchNumber: '' });
    assert.equal(dup.status, 409, JSON.stringify(dup));
    // ...but blank barcodes never collide.
    assert.equal((await request('/inventory', { name: 'No code A', costPrice: 1, sellingPrice: 2 })).status, 201);
    assert.equal((await request('/inventory', { name: 'No code B', costPrice: 1, sellingPrice: 2 })).status, 201);

    // Minimum Stock defaults when omitted and rejects nonsense.
    const defaulted = await request('/inventory', { name: 'Default min', costPrice: 1, sellingPrice: 2 });
    assert.equal(defaulted.data.lowStockThreshold, 5);
    assert.equal((await request('/inventory', { name: 'Bad min', costPrice: 1, sellingPrice: 2, lowStockThreshold: -1 })).status, 400);
    assert.equal((await request('/inventory', { name: 'Bad min 2', costPrice: 1, sellingPrice: 2, lowStockThreshold: 2.5 })).status, 400);

    // Update, including barcode uniqueness against other items but not itself.
    const updated = await request(`/inventory/${created.data.id}`, { manufacturer: 'GSK', barcode: '6001234567890', lowStockThreshold: 3 }, 'PUT');
    assert.equal(updated.status, 200, JSON.stringify(updated));
    assert.equal(updated.data.manufacturer, 'GSK');
    assert.equal(updated.data.lowStockThreshold, 3);
    const clash = await request(`/inventory/${defaulted.data.id}`, { barcode: '6001234567890' }, 'PUT');
    assert.equal(clash.status, 409);

    // Search finds items by barcode and generic name.
    const byBarcode = await request('/inventory?search=6001234567890', null, 'GET');
    assert.equal(byBarcode.data.length, 1);
    const byGeneric = await request('/inventory?search=amoxicillin', null, 'GET');
    assert.equal(byGeneric.data.length, 1);
  } finally {
    await teardown(server);
  }
});
