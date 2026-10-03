import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import DayClose from '../src/models/DayClose.js';
import BusinessDay from '../src/models/BusinessDay.js';
import { closeDay } from '../src/services/dayCloseService.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-reopen-test-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' }); // default role: admin
  const cashier = await User.create({ username: 'cashier', name: 'Cashier', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
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
  return { admin, cashier, server, request };
}

async function teardown(server) {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
}

test('TEST R1-R7 -- Reopen: admin-only, restores snapshot, auditable, idempotent, logged, POS reopens', { timeout: 60000 }, async () => {
  const { admin, cashier, server, request } = await setup('reopen_basic');
  try {
    const evc = await Account.create({ name: 'EVC', currentBalanceCents: 50000 }); // $500
    const cash = await Account.create({ name: 'Cash', currentBalanceCents: 20000 }); // $200

    const { dayClose } = await closeDay({ user: admin });
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0);
    assert.equal((await Account.findById(cash.id)).currentBalanceCents, 0);
    const bd = await BusinessDay.findById('current');
    assert.equal(bd.status, 'CLOSED');

    // TEST R1: non-admin gets 403 from the backend independently of any UI.
    const blocked = await request(`/day-close/${dayClose._id}/reopen`, { reason: 'nope' }, 'POST', cashier);
    assert.equal(blocked.status, 403, JSON.stringify(blocked));
    assert.equal((await BusinessDay.findById('current')).status, 'CLOSED'); // unchanged

    // TEST R2 + R3 + R6: admin reopens -> OPEN, accounts restored exactly, reopen log populated.
    const reopened = await request(`/day-close/${dayClose._id}/reopen`, { reason: 'Correcting invoices' }, 'POST', admin);
    assert.equal(reopened.status, 200, JSON.stringify(reopened));
    assert.equal((await BusinessDay.findById('current')).status, 'OPEN');
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 50000);
    assert.equal((await Account.findById(cash.id)).currentBalanceCents, 20000);
    assert.equal(reopened.data.reopened, true);
    assert.equal(reopened.data.reopenReason, 'Correcting invoices');
    assert.equal(reopened.data.reopenedByName, 'Admin');
    assert.ok(reopened.data.reopenedAt);
    assert.equal(reopened.data.restoredAccounts.length, 2);

    // TEST R4: ledger contains an auditable restoration transaction per account.
    const restorationTxns = await AccountTransaction.find({ referenceType: 'DayClose', referenceId: dayClose._id, type: 'ADJUSTMENT' });
    assert.equal(restorationTxns.length, 2);
    const evcTxn = restorationTxns.find((t) => String(t.account) === String(evc.id));
    assert.equal(evcTxn.direction, 'IN');
    assert.equal(evcTxn.amountCents, 50000);
    assert.equal(evcTxn.balanceBeforeCents, 0);
    assert.equal(evcTxn.balanceAfterCents, 50000);
    assert.equal(evcTxn.status, 'POSTED');

    // TEST R5: double reopen rejected -- no double restoration.
    const doubleReopen = await request(`/day-close/${dayClose._id}/reopen`, {}, 'POST', admin);
    assert.equal(doubleReopen.status, 409, JSON.stringify(doubleReopen));
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 50000); // unchanged, not doubled to 100000

    // TEST R7: POS is usable again for a non-admin now that the day is OPEN.
    const customer = await request('/customers', { name: 'Reopen Test Customer' }, 'POST', admin);
    const item = await request('/stock', { rows: [{ name: 'Reopen Item', quantity: 10, costPrice: 1, sellingPrice: 5, expiryDate: '2035-01-01' }] }, 'POST', admin);
    const itemId = item.data.rows[0].item;
    const sale = await request('/sales', { customerId: customer.data.id, items: [{ itemId, quantity: 1 }], paidAmount: 0 }, 'POST', cashier);
    assert.equal(sale.status, 201, JSON.stringify(sale));
  } finally {
    await teardown(server);
  }
});

test('TEST R8, R9, R10 -- Close -> Reopen -> Close lifecycle, atomic rollback, historical-day conflict guard', { timeout: 60000 }, async () => {
  const { admin, server, request } = await setup('reopen_lifecycle');
  try {
    const evc = await Account.create({ name: 'EVC', currentBalanceCents: 30000 });

    const first = await closeDay({ user: admin });
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0);

    // TEST R10 (part 1): reopening the current (only, latest) close works fine.
    const reopen1 = await request(`/day-close/${first.dayClose._id}/reopen`, { reason: 'fix' }, 'POST', admin);
    assert.equal(reopen1.status, 200, JSON.stringify(reopen1));
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 30000);

    // Make a correction, then close again -- TEST R8: a brand-new DayClose is
    // created; the FIRST one's historical closing figures and its own
    // reopen audit trail are never overwritten.
    await Account.findByIdAndUpdate(evc.id, { $inc: { currentBalanceCents: 1000 } }); // simulate a correction
    const second = await closeDay({ user: admin });
    assert.notEqual(String(second.dayClose._id), String(first.dayClose._id));
    assert.equal(await DayClose.countDocuments(), 2);
    const firstReloaded = await DayClose.findById(first.dayClose._id);
    assert.equal(firstReloaded.reopened, true); // still recorded, untouched
    assert.equal(firstReloaded.reopenReason, 'fix'); // original reopen audit trail intact
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0); // reset again by the second close

    // TEST R10 (part 2): the FIRST (now historical, superseded) close can no
    // longer be reopened -- only the most recent one (`second`) can.
    const staleReopenAttempt = await request(`/day-close/${first.dayClose._id}/reopen`, { reason: 'should fail' }, 'POST', admin);
    assert.equal(staleReopenAttempt.status, 409, JSON.stringify(staleReopenAttempt));
    assert.match(staleReopenAttempt.message, /most recent/i);
    // TEST R9: that rejected attempt left everything completely untouched.
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 0);
    assert.equal((await BusinessDay.findById('current')).status, 'CLOSED');
    assert.equal(await AccountTransaction.countDocuments({ referenceType: 'DayClose', referenceId: first.dayClose._id }), 1); // only the original reopen's 1 txn, nothing new

    // Reopening the actually-current (second) close still works correctly.
    const reopen2 = await request(`/day-close/${second.dayClose._id}/reopen`, {}, 'POST', admin);
    assert.equal(reopen2.status, 200, JSON.stringify(reopen2));
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 31000);
  } finally {
    await teardown(server);
  }
});
