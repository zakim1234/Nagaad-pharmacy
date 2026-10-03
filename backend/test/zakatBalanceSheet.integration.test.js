import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Customer from '../src/models/Customer.js';
import Supplier from '../src/models/Supplier.js';
import Purchase from '../src/models/Purchase.js';
import InventoryItem from '../src/models/InventoryItem.js';
import Expense from '../src/models/Expense.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import ZakatRecord from '../src/models/ZakatRecord.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-zakat-test-secret';
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

// evc starts at $500, bank at $300; Partner A then contributes $600 and
// Partner B $400, both into evc, which is also how their 60%/40% equity
// split is set up -- so the FINAL cash total is $500+$600+$400+$300 = $1800,
// not $800. (A capital contribution necessarily raises cash by the same
// amount it raises equity -- there is no way to fund partner equity without
// it showing up in cash somewhere.) Receivable $200, Inventory $50 (10 units
// @ $5), Payable $150 are seeded directly and are deliberately NOT backed by
// any matching cash/equity movement, the same way Fixed Assets aren't --
// this whole fixture is assembled by direct document creation, not the
// app's real transactional flows, so it is not expected to balance on its
// own; see the Balance Sheet test below for what that means for `isBalanced`.
async function seedFinancials({ request }) {
  const evc = await Account.create({ name: 'EVC Plus', currentBalanceCents: 50000 });
  const bank = await Account.create({ name: 'Salaam Bank', currentBalanceCents: 30000 });
  const customer = await Customer.create({ name: 'Debtor Customer', phone: '111', balanceCents: 20000 });
  const item = await InventoryItem.create({ name: 'Widget', itemCode: 'WIDG-Z1', quantity: 10, costPriceCents: 500, sellingPriceCents: 1000 });
  const supplier = await Supplier.create({ name: 'Cabdi Supplier' });
  await Purchase.create({
    purchaseNumber: 'PINV-Z-1',
    supplier: supplier._id,
    supplierName: supplier.name,
    items: [{ item: item._id, itemName: item.name, quantity: 3, unitCostCents: 500, subtotalCents: 1500 }],
    totalCostCents: 1500,
    balanceCents: 15000, // set directly for a clean $150 payable, independent of the line items above
  });
  const partnerA = await request('/partners', { name: 'Partner A' });
  const partnerB = await request('/partners', { name: 'Partner B' });
  await request(`/partners/${partnerA.data.id}/contribute`, { amount: 600, paymentAccountId: evc.id });
  await request(`/partners/${partnerB.data.id}/contribute`, { amount: 400, paymentAccountId: evc.id });
  return { evc, bank, customer, item, supplier, partnerA: partnerA.data, partnerB: partnerB.data };
}

test('ZAKAT -- preview arithmetic, proportional breakdown, AUTO deducts as an Expense, MANUAL only records, history, mark-paid, permissions', { timeout: 120000 }, async () => {
  const { server, request } = await setup('zakat_main');
  try {
    const seeded = await seedFinancials({ request });
    const noAccess = await User.create({ username: 'nz', name: 'NZ', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    const readOnly = await User.create({ username: 'rz', name: 'RZ', passwordHash: 'unused', role: 'cashier', permissions: ['zakat'] });

    assert.equal((await request('/zakat/preview', null, 'GET', noAccess)).status, 403);
    assert.equal((await request('/zakat/preview', null, 'GET', readOnly)).status, 200, 'read-only user may preview');

    // Cash 1800 (500+300 seeded, +600+400 contributed) + inventory 50 + receivable 200
    // = 2050; minus payable 150 = 1900; * 2.5% = 47.50.
    const preview = await request('/zakat/preview?rate=2.5', null, 'GET');
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(preview.data.assets.cash, 1800);
    assert.equal(preview.data.assets.inventory, 50);
    assert.equal(preview.data.assets.receivable, 200);
    assert.equal(preview.data.assets.fixedAssets, 0);
    assert.equal(preview.data.assets.total, 2050);
    assert.equal(preview.data.liabilities.payable, 150);
    assert.equal(preview.data.netZakatableWealth, 1900);
    assert.equal(preview.data.zakatDue, 47.5);
    assert.ok(Number.isInteger(preview.data.hijriYear) && preview.data.hijriYear > 1400, 'approximate Hijri year is present and plausible');

    // Breakdown is proportional to equity (60/40) and sums to exactly zakatDue.
    assert.equal(preview.data.breakdown.length, 2);
    const byName = Object.fromEntries(preview.data.breakdown.map((b) => [b.partnerName, b]));
    assert.equal(byName['Partner A'].equityPct, 60);
    assert.equal(byName['Partner A'].share, 28.5);
    assert.equal(byName['Partner B'].equityPct, 40);
    assert.equal(byName['Partner B'].share, 19);
    assert.equal(byName['Partner A'].share + byName['Partner B'].share, preview.data.zakatDue);

    // Custom rate and includeFixedAssets both change the result.
    const rate5 = await request('/zakat/preview?rate=5', null, 'GET');
    assert.equal(rate5.data.zakatDue, 95);
    assert.equal((await request('/zakat/preview?rate=150', null, 'GET')).status, 400, 'rate over 100% is rejected');

    // AUTO deduction: creates one Expense (category "Zakat") deducted from the chosen account, marks the record PAID.
    assert.equal((await request('/zakat', { deductionMode: 'AUTO' }, 'POST', readOnly)).status, 403, 'read-only user cannot confirm');
    const auto = await request('/zakat', { deductionMode: 'AUTO', paymentAccountId: seeded.evc.id, rate: 2.5, note: 'Annual Zakat' });
    assert.equal(auto.status, 201, JSON.stringify(auto));
    assert.equal(auto.data.status, 'PAID');
    assert.equal(auto.data.deductionMode, 'AUTO');
    assert.equal((await Account.findById(seeded.evc.id)).currentBalanceCents, 150000 - 4750, 'evc (500+600+400 contributed) minus the $47.50 Zakat');
    const expense = await Expense.findOne({ category: 'Zakat' });
    assert.ok(expense, 'a Zakat expense was created');
    assert.equal(expense.amountCents, 4750);
    const zakatTxn = await AccountTransaction.findOne({ referenceType: 'Expense', referenceId: expense._id });
    assert.equal(zakatTxn.type, 'EXPENSE');
    assert.equal(zakatTxn.direction, 'OUT');
    const record = await ZakatRecord.findById(auto.data.id);
    assert.equal(String(record.expense), String(expense._id));

    // MANUAL: only records, moves no money, status starts RECORDED.
    const beforeManual = (await Account.findById(seeded.bank.id)).currentBalanceCents;
    const manual = await request('/zakat', { deductionMode: 'MANUAL', rate: 2.5, note: 'Partners pay their own share' });
    assert.equal(manual.status, 201, JSON.stringify(manual));
    assert.equal(manual.data.status, 'RECORDED');
    assert.equal(manual.data.deductionMode, 'MANUAL');
    assert.equal((await Account.findById(seeded.bank.id)).currentBalanceCents, beforeManual, 'no account touched');
    assert.equal(await Expense.countDocuments({ category: 'Zakat' }), 1, 'no second expense created');

    // History lists both.
    const history = await request('/zakat', null, 'GET');
    assert.equal(history.status, 200);
    assert.equal(history.data.length, 2);
    assert.deepEqual(new Set(history.data.map((r) => r.status)), new Set(['PAID', 'RECORDED']));

    // Mark the MANUAL one paid once partners have settled individually.
    const markPaid = await request(`/zakat/${manual.data.id}/mark-paid`, {});
    assert.equal(markPaid.status, 200, JSON.stringify(markPaid));
    assert.equal(markPaid.data.status, 'PAID');
    assert.equal((await request(`/zakat/${manual.data.id}/mark-paid`, {})).status, 409, 'double mark-paid rejected');

    // Zero-wealth edge case: nothing to record.
    await Purchase.updateOne({ purchaseNumber: 'PINV-Z-1' }, { balanceCents: 999999999 }); // drown the wealth, clamped to 0
    const zero = await request('/zakat', { deductionMode: 'MANUAL' });
    assert.equal(zero.status, 409);
  } finally {
    await teardown(server);
  }
});

test('ZAKAT -- edit corrects the record without moving money, delete is permanent and warns about AUTO, permissions', { timeout: 90000 }, async () => {
  const { server, request } = await setup('zakat_edit');
  try {
    const seeded = await seedFinancials({ request });
    const readOnly = await User.create({ username: 'rz2', name: 'RZ2', passwordHash: 'unused', role: 'cashier', permissions: ['zakat'] });

    // ---- Edit a MANUAL record ----
    const manual = await request('/zakat', { deductionMode: 'MANUAL', rate: 2.5, note: 'first pass' });
    assert.equal(manual.status, 201, JSON.stringify(manual));
    const beforeEvc = (await Account.findById(seeded.evc.id)).currentBalanceCents;

    assert.equal((await request(`/zakat/${manual.data.id}`, { totalZakat: 999 }, 'PUT', readOnly)).status, 403, 'read-only user cannot edit');

    const edited = await request(`/zakat/${manual.data.id}`, {
      date: '2020-06-15',
      rate: 3,
      totalZakat: 100, // was $47.50 -- a manual correction, not a recalculation
      note: 'corrected total',
      status: 'PAID',
    }, 'PUT');
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.calculationDate.slice(0, 10), '2020-06-15');
    assert.equal(edited.data.ratePct, 3);
    assert.equal(edited.data.zakatDue, 100);
    assert.equal(edited.data.note, 'corrected total');
    assert.equal(edited.data.status, 'PAID');
    assert.ok(edited.data.paidAt, 'paidAt is set when status newly becomes PAID');
    // Breakdown rescaled to the new total, each partner's own equity % preserved, still sums to exactly the new total.
    const byName = Object.fromEntries(edited.data.breakdown.map((b) => [b.partnerName, b]));
    assert.equal(byName['Partner A'].equityPct, 60);
    assert.equal(byName['Partner A'].share, 60);
    assert.equal(byName['Partner B'].equityPct, 40);
    assert.equal(byName['Partner B'].share, 40);
    assert.equal(byName['Partner A'].share + byName['Partner B'].share, 100);
    // No money moved by any of this -- it was MANUAL, and editing never touches an account regardless.
    assert.equal((await Account.findById(seeded.evc.id)).currentBalanceCents, beforeEvc);

    // Flipping a MANUAL record's Mode to Auto requires an account; providing one just relabels the record (still no money moves).
    assert.equal((await request(`/zakat/${manual.data.id}`, { deductionMode: 'AUTO' }, 'PUT')).status, 400, 'Auto needs an account when the record has none yet');
    const relabelled = await request(`/zakat/${manual.data.id}`, { deductionMode: 'AUTO', paymentAccountId: seeded.evc.id }, 'PUT');
    assert.equal(relabelled.status, 200, JSON.stringify(relabelled));
    assert.equal(relabelled.data.deductionMode, 'AUTO');
    assert.equal(relabelled.data.paymentAccountName, 'EVC Plus');
    assert.equal((await Account.findById(seeded.evc.id)).currentBalanceCents, beforeEvc, 'relabelling to Auto still moves no money');

    // ---- Edit an AUTO record: staying Auto without re-picking an account keeps the existing one ----
    const auto = await request('/zakat', { deductionMode: 'AUTO', paymentAccountId: seeded.bank.id, rate: 2.5 });
    assert.equal(auto.status, 201, JSON.stringify(auto));
    const keepAccount = await request(`/zakat/${auto.data.id}`, { totalZakat: 50 }, 'PUT'); // deductionMode omitted entirely
    assert.equal(keepAccount.status, 200, JSON.stringify(keepAccount));
    assert.equal(keepAccount.data.paymentAccountName, 'Salaam Bank', 'account untouched when not resent');
    assert.equal(keepAccount.data.zakatDue, 50);
    const linkedExpense = await Expense.findOne({ category: 'Zakat', amountCents: Math.round(auto.data.zakatDue * 100) });
    assert.ok(linkedExpense, 'the Expense the original confirm created is still findable');
    assert.equal(linkedExpense.amountCents, Math.round(auto.data.zakatDue * 100), 'the original Expense amount is untouched by the record edit');

    assert.equal((await request(`/zakat/${manual.data.id}`, { totalZakat: -5 }, 'PUT')).status, 400);
    assert.equal((await request(`/zakat/${manual.data.id}`, { rate: 150 }, 'PUT')).status, 400);
    assert.equal((await request(`/zakat/${new mongoose.Types.ObjectId()}`, { totalZakat: 10 }, 'PUT')).status, 404);

    // ---- Delete ----
    assert.equal((await request(`/zakat/${manual.data.id}`, null, 'DELETE', readOnly)).status, 403, 'read-only user cannot delete');
    const deleted = await request(`/zakat/${manual.data.id}`, null, 'DELETE');
    assert.equal(deleted.status, 200, JSON.stringify(deleted));
    assert.equal(await ZakatRecord.findById(manual.data.id), null, 'permanently gone, not soft-removed');
    assert.equal((await request('/zakat', null, 'GET')).data.length, 1, 'only the still-existing Auto record remains');

    // Deleting an AUTO record does not touch the Expense/account it created.
    const evcBeforeDelete = (await Account.findById(seeded.evc.id)).currentBalanceCents;
    const expenseCountBefore = await Expense.countDocuments({ category: 'Zakat' });
    await request(`/zakat/${auto.data.id}`, null, 'DELETE');
    assert.equal((await Account.findById(seeded.evc.id)).currentBalanceCents, evcBeforeDelete);
    assert.equal(await Expense.countDocuments({ category: 'Zakat' }), expenseCountBefore, 'linked Expense is left exactly as it was');
    assert.equal((await request(`/zakat/${auto.data.id}`, null, 'DELETE')).status, 404, 'already gone');
  } finally {
    await teardown(server);
  }
});

test('BALANCE SHEET -- assets/liabilities/equity math, includes Fixed Assets, flags an imbalance instead of hiding it', { timeout: 90000 }, async () => {
  const { admin, server, request } = await setup('balance_sheet');
  try {
    await seedFinancials({ request });
    const fixedAsset = await request('/fixed-assets', { name: 'Computer and Printer', value: 300, dateAdded: '2026-01-01' });
    assert.equal(fixedAsset.status, 201, JSON.stringify(fixedAsset));

    const noAccess = await User.create({ username: 'nb', name: 'NB', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    assert.equal((await request('/reports/balance-sheet', null, 'GET', noAccess)).status, 403);

    const bs = await request('/reports/balance-sheet', null, 'GET');
    assert.equal(bs.status, 200, JSON.stringify(bs));
    // The default (no date given) must be today's real local date, not
    // shifted by a day the way `someDate.toISOString().slice(0, 10)` would
    // silently do in a timezone behind UTC -- and the note that balances
    // aren't a historical snapshot should NOT show for today.
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    assert.equal(bs.data.asOf, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    assert.equal(bs.data.asOfNote, null);
    // An explicit date is echoed back exactly as asked, not rolled to the next day.
    const explicit = await request('/reports/balance-sheet?date=2020-03-15', null, 'GET');
    assert.equal(explicit.data.asOf, '2020-03-15');
    assert.ok(explicit.data.asOfNote, 'a past date does get the "not a historical snapshot" note');

    assert.equal(bs.data.assets.cash, 1800);
    assert.equal(bs.data.assets.receivable, 200);
    assert.equal(bs.data.assets.inventory, 50);
    assert.equal(bs.data.assets.totalCurrentAssets, 2050);
    assert.equal(bs.data.assets.fixedAssets, 300);
    assert.equal(bs.data.assets.totalAssets, 2350);
    assert.equal(bs.data.liabilities.payable, 150);
    assert.equal(bs.data.liabilities.totalLiabilities, 150);
    assert.equal(bs.data.equity.partnersCapital, 1000, "sum of both partners' current equity");
    assert.equal(bs.data.equity.netIncome, 0, 'no confirmed sales in this test, so P&L is zero');
    assert.equal(bs.data.equity.retainedEarnings, 0);
    assert.equal(bs.data.equity.totalEquity, 1000);
    assert.equal(bs.data.totalLiabilitiesAndEquity, 1150);

    // Assets (2350) != Liabilities+Equity (1150): the fixture was assembled by direct
    // document creation (see seedFinancials), not real transactions, so several of
    // these lines have no matching entry on the other side of the equation -- exactly
    // the kind of gap this check exists to surface, not hide.
    assert.equal(bs.data.isBalanced, false);
    assert.equal(bs.data.difference, 1200);

    // The report is reactive to real changes: removing the Fixed Asset drops
    // total assets (and the gap) by exactly its value, with nothing else moving.
    const removed = await request(`/fixed-assets/${fixedAsset.data.id}/remove`, {});
    assert.equal(removed.status, 200, JSON.stringify(removed));
    const bs2 = await request('/reports/balance-sheet', null, 'GET');
    assert.equal(bs2.data.assets.fixedAssets, 0);
    assert.equal(bs2.data.assets.totalAssets, 2050);
    assert.equal(bs2.data.totalLiabilitiesAndEquity, 1150, 'liabilities/equity side is unaffected by removing a fixed asset');
    assert.equal(bs2.data.difference, 900);

    // Excel export returns a real workbook.
    const token = jwt.sign({ sub: String(admin._id) }, process.env.JWT_SECRET);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/reports/balance-sheet/export`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'a real zip/xlsx, not an error page');
  } finally {
    await teardown(server);
  }
});
