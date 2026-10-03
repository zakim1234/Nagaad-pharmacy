import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Supplier from '../src/models/Supplier.js';
import Customer from '../src/models/Customer.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Sale from '../src/models/Sale.js';
import { closeDay, openDay } from '../src/services/dayCloseService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-wac-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const user = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' }); // default role: admin
  const supplier = await Supplier.create({ name: 'ABC Pharma' });
  const account = await Account.create({ name: 'EVC' });
  const customer = await Customer.create({ name: 'Walk-in' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const token = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET);
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  return { user, supplier, account, customer, server, request };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
}

test('TEST 1-4, 7 -- sequential WAC receipts, zero-stock reset, and Stock Value Report', { timeout: 60000 }, async () => {
  const { supplier, account, server, request } = await setup('wac_sequential');
  try {
    // TEST 1: first receipt initializes WAC.
    const r1 = await request('/stock', { rows: [{ name: 'Amoxicillin', quantity: 10, costPrice: 1, sellingPrice: 5, expiryDate: '2035-01-01' }], supplierId: supplier.id });
    assert.equal(r1.status, 201, JSON.stringify(r1));
    let item = await InventoryItem.findOne({ name: 'Amoxicillin' });
    assert.equal(item.quantity, 10);
    assert.equal(item.costPriceCents, 100); // $1.00

    // TEST 2: 10@$1 + 10@$5 = 20@$3.
    const r2 = await request('/stock', { rows: [{ itemId: item.id, name: 'Amoxicillin', quantity: 10, costPrice: 5, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    assert.equal(r2.status, 201, JSON.stringify(r2));
    item = await InventoryItem.findById(item.id);
    assert.equal(item.quantity, 20);
    assert.equal(item.costPriceCents, 300); // $3.00

    // TEST 3: 20@$3 + 20@$0.50 = 40@$1.75.
    const r3 = await request('/stock', { rows: [{ itemId: item.id, name: 'Amoxicillin', quantity: 20, costPrice: 0.5, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    assert.equal(r3.status, 201, JSON.stringify(r3));
    item = await InventoryItem.findById(item.id);
    assert.equal(item.quantity, 40);
    assert.equal(item.costPriceCents, 175); // $1.75 -- the canonical worked example from the spec

    // Audit trail: the movement log recorded the before/after average for each receipt.
    assert.deepEqual(
      item.stockEvents.filter((e) => e.type === 'RECEIPT' || e.type === 'RESTOCK').map((e) => [e.averageCostBeforeCents, e.averageCostAfterCents]),
      [[0, 100], [100, 300], [300, 175]]
    );

    // TEST 7: Stock Value Report uses current WAC, not latest purchase price.
    const inv = await request('/reports/inventory', null, 'GET');
    assert.equal(inv.status, 200, JSON.stringify(inv));
    assert.equal(inv.data.stockValueAtCost, 70); // 40 * $1.75 = $70.00

    // TEST 4: zero-stock rule -- sell out the item entirely, then receive at
    // a different cost; the new average must NOT blend with the old $1.75.
    const customer2 = await Customer.create({ name: 'Zero Stock Buyer' });
    const draft = await request('/sales', { customerId: customer2.id, items: [{ itemId: item.id, quantity: 40 }], paidAmount: 0 });
    assert.equal(draft.status, 201, JSON.stringify(draft));
    await closeDay({ user: await User.findOne() });
    item = await InventoryItem.findById(item.id);
    assert.equal(item.quantity, 0);
    assert.equal(item.costPriceCents, 175); // unchanged by the sale itself (TEST 5, checked properly below too)

    await openDay({ user: await User.findOne() });
    const r4 = await request('/stock', { rows: [{ itemId: item.id, name: 'Amoxicillin', quantity: 10, costPrice: 2, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    assert.equal(r4.status, 201, JSON.stringify(r4));
    item = await InventoryItem.findById(item.id);
    assert.equal(item.costPriceCents, 200); // $2.00, NOT a mixture with the stale $1.75
  } finally {
    await teardown(server);
  }
});

test('TEST 5, 6, 8, 9 -- sale never changes WAC; finalized-sale historical snapshot is immutable; discount-aware profit', { timeout: 60000 }, async () => {
  const { supplier, account, customer, server, request } = await setup('wac_snapshot');
  try {
    const stock = await request('/stock', { rows: [{ name: 'Widget', quantity: 40, costPrice: 1.75, sellingPrice: 4, expiryDate: '2035-01-01' }], supplierId: supplier.id });
    assert.equal(stock.status, 201, JSON.stringify(stock));
    const item = await InventoryItem.findOne({ name: 'Widget' });
    assert.equal(item.costPriceCents, 175);

    // TEST 5: a normal sale/stock-out only changes quantity, never WAC.
    const draft = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 10, unitPrice: 4 }], paidAmount: 40, paymentAccountId: account.id });
    assert.equal(draft.status, 201, JSON.stringify(draft));
    const user = await User.findOne();
    await closeDay({ user });
    const afterSale = await InventoryItem.findById(item.id);
    assert.equal(afterSale.quantity, 30);
    assert.equal(afterSale.costPriceCents, 175); // unchanged

    // TEST 6 + TEST 8: finalized sale captured WAC=$1.75 as its historical
    // COGS/profit basis. Revenue $40, COGS 10*175=1750 ($17.50), profit $22.50.
    const sale = await Sale.findById(draft.data.id);
    assert.equal(sale.items[0].costPriceCents, 175);
    assert.equal(sale.costOfGoodsCents, 1750);
    assert.equal(sale.profitCents, 4000 - 1750); // $22.50

    // Now receive more stock, moving WAC to $3.00 (30@1.75 + 30@4.25 -> avg 3.00).
    await openDay({ user });
    const restock = await request('/stock', { rows: [{ itemId: item.id, name: 'Widget', quantity: 30, costPrice: 4.25, sellingPrice: 4, expiryDate: '2035-01-01' }] });
    assert.equal(restock.status, 201, JSON.stringify(restock));
    const afterRestock = await InventoryItem.findById(item.id);
    assert.equal(afterRestock.costPriceCents, 300); // (30*175+30*425)/60 = (5250+12750)/60=18000/60=300

    // The already-finalized September-19-equivalent invoice MUST STILL show
    // cost $1.75/unit and profit $22.50, unaffected by the later purchase.
    const staleSale = await Sale.findById(sale._id);
    assert.equal(staleSale.items[0].costPriceCents, 175);
    assert.equal(staleSale.costOfGoodsCents, 1750);
    assert.equal(staleSale.profitCents, 2250);

    // Profit Report must report the SAME historical numbers, not
    // recalculated using today's $3.00 average.
    const profit = await request('/reports/profit?range=year', null, 'GET');
    assert.equal(profit.status, 200, JSON.stringify(profit));
    assert.equal(profit.data.costOfGoodsSold, 17.5);
    assert.equal(profit.data.grossProfit, 22.5);
    const byItem = profit.data.profitByItem.find((i) => i.name === 'Widget');
    assert.equal(byItem.cost, 17.5);
    assert.equal(byItem.profit, 22.5);

    // Item Profit Report (per-item) agrees.
    const itemProfit = await request(`/reports/item-profit/${item.id}`, null, 'GET');
    assert.equal(itemProfit.status, 200, JSON.stringify(itemProfit));
    assert.equal(itemProfit.data.costOfGoodsSold, 17.5);
    assert.equal(itemProfit.data.grossProfit, 22.5);

    // TEST 9: discount interaction -- qty 2 @ $10, $2 line discount, WAC
    // snapshot $5 at sale time -> revenue $18, COGS $10, profit $8.
    const item2Stock = await request('/stock', { rows: [{ name: 'Discounted Thing', quantity: 2, costPrice: 5, sellingPrice: 10, expiryDate: '2035-01-01' }] });
    const item2 = await InventoryItem.findOne({ name: 'Discounted Thing' });
    const draft2 = await request('/sales', {
      customerId: customer.id,
      items: [{ itemId: item2.id, quantity: 2, unitPrice: 10, discount: 2 }],
      paidAmount: 18,
      paymentAccountId: account.id,
    });
    assert.equal(draft2.status, 201, JSON.stringify(draft2));
    await closeDay({ user });
    const sale2 = await Sale.findById(draft2.data.id);
    assert.equal(sale2.totalCents, 1800);
    assert.equal(sale2.profitCents, 1800 - 1000); // $8.00

    const drilldown = await request(`/reports/profit/items/${item2.id}?range=year`, null, 'GET');
    assert.equal(drilldown.status, 200, JSON.stringify(drilldown));
    const row = drilldown.data.invoices.find((r) => String(r.saleId) === String(sale2._id));
    assert.equal(row.revenue, 18);
    assert.equal(row.cost, 10);
    assert.equal(row.profit, 8);
  } finally {
    await teardown(server);
  }
});

test('TEST 10 -- customer return blends WAC at historical cost; original invoice stays intact', { timeout: 60000 }, async () => {
  const { supplier, account, customer, server, request } = await setup('wac_return');
  try {
    await request('/stock', { rows: [{ name: 'Returnable', quantity: 20, costPrice: 2, sellingPrice: 5, expiryDate: '2035-01-01' }], supplierId: supplier.id });
    let item = await InventoryItem.findOne({ name: 'Returnable' });
    // Move WAC to $4 with a second receipt so the return-time historical
    // sale cost ($2) is DIFFERENT from the item's cost at return time.
    await request('/stock', { rows: [{ itemId: item.id, name: 'Returnable', quantity: 20, costPrice: 6, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    item = await InventoryItem.findById(item.id);
    assert.equal(item.costPriceCents, 400); // (20*200+20*600)/40=400

    const draft = await request('/sales', { customerId: customer.id, items: [{ itemId: item.id, quantity: 10, unitPrice: 5 }], paidAmount: 50, paymentAccountId: account.id });
    const user = await User.findOne();
    await closeDay({ user });
    const sale = await Sale.findById(draft.data.id);
    assert.equal(sale.items[0].costPriceCents, 400); // WAC at sale time

    item = await InventoryItem.findById(item.id);
    assert.equal(item.quantity, 30); // 40 - 10
    assert.equal(item.costPriceCents, 400); // sale never changes WAC

    // Receive a THIRD batch, moving WAC again before the return.
    await request('/stock', { rows: [{ itemId: item.id, name: 'Returnable', quantity: 30, costPrice: 10, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    item = await InventoryItem.findById(item.id);
    // (30*400 + 30*1000)/60 = (12000+30000)/60 = 700
    assert.equal(item.costPriceCents, 700);

    // Now return 4 of the 10 units sold. Returned units go back in at the
    // ORIGINAL SALE cost ($4.00/unit), blended into the CURRENT average
    // ($7.00), not at today's WAC and not at the selling price.
    const ret = await request(`/sales/${sale._id}/return`, { items: [{ itemId: item.id, quantity: 4 }], reason: 'defective' });
    assert.equal(ret.status, 200, JSON.stringify(ret));
    item = await InventoryItem.findById(item.id);
    assert.equal(item.quantity, 64); // 60 + 4
    // (60*700 + 4*400) / 64 = (42000+1600)/64 = 43600/64 = 681.25 -> 681
    assert.equal(item.costPriceCents, 681);

    // The original invoice's OTHER (non-returned) line data remains intact
    // -- historical cost snapshot on the sale is untouched by the return
    // blend math (the return only changes the ITEM's average, never
    // rewrites the sale's own historical costPriceCents).
    const staleSale = await Sale.findById(sale._id);
    assert.equal(staleSale.items[0].costPriceCents, 400);
    assert.equal(staleSale.items[0].returnedQuantity, 4);

    // Audit trail recorded the return as a WAC-affecting movement.
    const returnEvent = item.stockEvents.find((e) => e.type === 'CUSTOMER_RETURN');
    assert.ok(returnEvent, 'expected a CUSTOMER_RETURN stock event');
    assert.equal(returnEvent.averageCostBeforeCents, 700);
    assert.equal(returnEvent.averageCostAfterCents, 681);
  } finally {
    await teardown(server);
  }
});

test('TEST 11, 12 -- Supplier Invoice archive and Purchase payment status never affect WAC', { timeout: 60000 }, async () => {
  const { supplier, account, server, request } = await setup('wac_isolation');
  try {
    await request('/stock', { rows: [{ name: 'Isolated Item', quantity: 10, costPrice: 3, sellingPrice: 6, expiryDate: '2035-01-01' }], supplierId: supplier.id });
    const item = await InventoryItem.findOne({ name: 'Isolated Item' });
    assert.equal(item.quantity, 10);
    assert.equal(item.costPriceCents, 300);

    // TEST 11: Supplier Invoice archive is pure archive -- must not touch
    // Inventory quantity, WAC, or Stock Value at all.
    const archive = await request('/supplier-invoice-archives', {
      serialNumber: 'SUP-SERIAL-001',
      supplierId: supplier.id,
      rows: [{ itemName: 'Isolated Item', quantity: 500, cost: 0.01 }], // wildly different qty/cost on purpose
      notes: 'paper invoice archive only',
    });
    assert.equal(archive.status, 201, JSON.stringify(archive));

    const afterArchive = await InventoryItem.findById(item.id);
    assert.equal(afterArchive.quantity, 10); // unchanged
    assert.equal(afterArchive.costPriceCents, 300); // unchanged

    // TEST 12: Purchase payment status transitions (Unpaid -> Partial ->
    // Paid) are pure financial/payment records and must never touch WAC.
    const purchase = await request('/purchases', { supplierId: supplier.id, amount: 200, amountPaid: 0, purchaseAccountId: account.id });
    assert.equal(purchase.status, 201, JSON.stringify(purchase));
    assert.equal(purchase.data.paymentStatus, 'Unpaid');
    let afterPurchase = await InventoryItem.findById(item.id);
    assert.equal(afterPurchase.costPriceCents, 300);

    const partial = await request(`/purchases/${purchase.data.id}/payments`, { amount: 80, paymentAccountId: account.id });
    assert.equal(partial.status, 201, JSON.stringify(partial));
    assert.equal(partial.data.purchase.paymentStatus, 'Partial');
    afterPurchase = await InventoryItem.findById(item.id);
    assert.equal(afterPurchase.costPriceCents, 300);

    const full = await request(`/purchases/${purchase.data.id}/payments`, { amount: 120, paymentAccountId: account.id });
    assert.equal(full.status, 201, JSON.stringify(full));
    assert.equal(full.data.purchase.paymentStatus, 'Paid');
    afterPurchase = await InventoryItem.findById(item.id);
    assert.equal(afterPurchase.quantity, 10); // Purchase never receives physical stock either
    assert.equal(afterPurchase.costPriceCents, 300);
  } finally {
    await teardown(server);
  }
});

test('TEST 13 -- concurrent Stock IN receipts for the same item: no lost update', { timeout: 60000 }, async () => {
  const { supplier, server, request } = await setup('wac_concurrency');
  try {
    // Starting: 10 @ $2.00.
    await request('/stock', { rows: [{ name: 'Contested Item', quantity: 10, costPrice: 2, sellingPrice: 5, expiryDate: '2035-01-01' }], supplierId: supplier.id });
    const item = await InventoryItem.findOne({ name: 'Contested Item' });
    assert.equal(item.quantity, 10);

    // Two concurrent receipts: 10 @ $4.00 and 10 @ $8.00.
    const [a, b] = await Promise.all([
      request('/stock', { rows: [{ itemId: item.id, name: 'Contested Item', quantity: 10, costPrice: 4, sellingPrice: 5, expiryDate: '2035-01-01' }] }),
      request('/stock', { rows: [{ itemId: item.id, name: 'Contested Item', quantity: 10, costPrice: 8, sellingPrice: 5, expiryDate: '2035-01-01' }] }),
    ]);
    assert.equal(a.status, 201, JSON.stringify(a));
    assert.equal(b.status, 201, JSON.stringify(b));

    const final = await InventoryItem.findById(item.id);
    // Neither receipt was lost: quantity reflects all three receipts.
    assert.equal(final.quantity, 30);
    // Total inventory value must reflect ALL THREE receipts regardless of
    // which order the two concurrent ones actually committed in:
    // 10*200 + 10*400 + 10*800 = 14000, / 30 = 466.66... -> 467.
    assert.equal(final.costPriceCents, 467);
  } finally {
    await teardown(server);
  }
});

test('TEST 14 -- existing/migrated item: costPriceCents is reused in place as the opening WAC, untouched until the next movement', { timeout: 60000 }, async () => {
  const { server, request } = await setup('wac_migration');
  try {
    // Simulates a pre-existing item from before this feature existed: its
    // costPriceCents already holds whatever the old "latest purchase price"
    // behavior last set. No migration script runs -- the field is reused in
    // place as the item's opening WAC per the spec's own Phase 18 guidance.
    const legacyItem = await InventoryItem.create({ itemCode: 'ITM-900001', name: 'Legacy Item', quantity: 50, costPriceCents: 200, sellingPriceCents: 500 });

    // Untouched by anything else happening in the system (no migration script exists or is needed).
    const reread = await InventoryItem.findById(legacyItem._id);
    assert.equal(reread.quantity, 50);
    assert.equal(reread.costPriceCents, 200);

    // Its NEXT stock movement blends correctly from that opening baseline:
    // 50@$2.00 + 10@$5.00 = 60 units, (10000+5000)/60 = 250.
    const receipt = await request('/stock', { rows: [{ itemId: legacyItem._id.toString(), name: 'Legacy Item', quantity: 10, costPrice: 5, sellingPrice: 5, expiryDate: '2035-01-01' }] });
    assert.equal(receipt.status, 201, JSON.stringify(receipt));
    const afterReceipt = await InventoryItem.findById(legacyItem._id);
    assert.equal(afterReceipt.quantity, 60);
    assert.equal(afterReceipt.costPriceCents, 250);
  } finally {
    await teardown(server);
  }
});
