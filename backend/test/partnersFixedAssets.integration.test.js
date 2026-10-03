import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import AccountTransaction from '../src/models/AccountTransaction.js';
import Partner from '../src/models/Partner.js';
import FixedAsset from '../src/models/FixedAsset.js';

async function setup(dbName) {
  await mongoose.connect(`mongodb://127.0.0.1:27028/${dbName}_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-partners-test-secret';
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

test('PARTNERS -- create, contribute (funds an account + grows equity), withdraw (validated both ways), permissions, ledger', { timeout: 90000 }, async () => {
  const { server, request } = await setup('partners_basic');
  try {
    const noAccess = await User.create({ username: 'na', name: 'NA', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    const readOnly = await User.create({ username: 'ro', name: 'RO', passwordHash: 'unused', role: 'cashier', permissions: ['partners'] });
    const evc = await Account.create({ name: 'EVC Plus', currentBalanceCents: 10000 }); // $100
    const bank = await Account.create({ name: 'Salaam Bank', currentBalanceCents: 500 }); // $5

    // Permission gate: no 'partners' module -> 403 everywhere.
    assert.equal((await request('/partners', null, 'GET', noAccess)).status, 403);
    assert.equal((await request('/partners', { name: 'X' }, 'POST', noAccess)).status, 403);

    // A user with only 'partners' (not admin/manager) may read but not create/contribute/withdraw.
    assert.equal((await request('/partners', null, 'GET', readOnly)).status, 200);
    assert.equal((await request('/partners', { name: 'Abdikadir Nor Abdi' }, 'POST', readOnly)).status, 403);

    const created = await request('/partners', { name: '  Abdikadir  Nor Abdi ', phone: '61xxxxxxx' });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.currentEquity, 0);
    const partnerId = created.data.id;

    // Duplicate name (case-insensitive) rejected.
    assert.equal((await request('/partners', { name: 'abdikadir nor abdi' })).status, 409);

    // Contribute $30,000 via EVC Plus: account balance up, equity up, one AccountTransaction.
    const contribute = await request(`/partners/${partnerId}/contribute`, { amount: 30000, paymentAccountId: evc.id, note: 'Initial capital' });
    assert.equal(contribute.status, 201, JSON.stringify(contribute));
    assert.equal(contribute.data.partner.currentEquity, 30000);
    assert.equal(contribute.data.partner.totalContributed, 30000);
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 10000 + 3000000);
    const contribTxns = await AccountTransaction.find({ referenceType: 'Partner', type: 'PARTNER_CONTRIBUTION' });
    assert.equal(contribTxns.length, 1);
    assert.equal(contribTxns[0].amountCents, 3000000);
    assert.equal(contribTxns[0].direction, 'IN');

    // Readonly user cannot contribute even though they can view.
    assert.equal((await request(`/partners/${partnerId}/contribute`, { amount: 10, paymentAccountId: evc.id }, 'POST', readOnly)).status, 403);

    // Withdraw validation: cannot exceed equity, cannot exceed account balance -- neither touches anything.
    const overEquity = await request(`/partners/${partnerId}/withdraw`, { amount: 40000, paymentAccountId: evc.id });
    assert.equal(overEquity.status, 400, JSON.stringify(overEquity));
    const overAccount = await request(`/partners/${partnerId}/withdraw`, { amount: 100, paymentAccountId: bank.id }); // equity has room, account doesn't
    assert.equal(overAccount.status, 400, JSON.stringify(overAccount));
    assert.equal((await Partner.findById(partnerId)).currentEquityCents, 3000000, 'rejected withdrawals never touch equity');
    assert.equal((await Account.findById(bank.id)).currentBalanceCents, 500);

    // Valid withdrawal of $6,125.76.
    const withdraw = await request(`/partners/${partnerId}/withdraw`, { amount: 6125.76, paymentAccountId: evc.id, note: 'Personal draw' });
    assert.equal(withdraw.status, 200, JSON.stringify(withdraw));
    assert.equal(withdraw.data.partner.totalWithdrawn, 6125.76);
    assert.equal(withdraw.data.partner.currentEquity, 23874.24); // 30000 - 6125.76, computed in cents server-side to avoid float drift
    assert.equal((await Account.findById(evc.id)).currentBalanceCents, 10000 + 3000000 - 612576);
    const withdrawTxns = await AccountTransaction.find({ referenceType: 'Partner', type: 'PARTNER_WITHDRAWAL' });
    assert.equal(withdrawTxns.length, 1);
    assert.equal(withdrawTxns[0].direction, 'OUT');

    // Ledger has both entries with correct before/after equity snapshots.
    const ledger = await request(`/partners/${partnerId}/transactions`, null, 'GET');
    assert.equal(ledger.status, 200);
    assert.equal(ledger.data.length, 2);
    const [mostRecent, first] = ledger.data;
    assert.equal(mostRecent.type, 'WITHDRAWAL');
    assert.equal(mostRecent.equityBefore, 30000);
    assert.equal(mostRecent.equityAfter, 23874.24);
    assert.equal(first.type, 'CONTRIBUTION');
    assert.equal(first.equityBefore, 0);

    // List includes the partner with correct totals, and totalEquity sums across partners.
    const list = await request('/partners', null, 'GET');
    assert.equal(list.status, 200);
    assert.equal(list.data.partners.length, 1);
    assert.equal(list.data.partners[0].name, 'Abdikadir Nor Abdi');
    assert.equal(list.data.totalEquity, 23874.24);

    // Validation: amount, account required.
    assert.equal((await request(`/partners/${partnerId}/contribute`, { amount: 0, paymentAccountId: evc.id })).status, 400);
    assert.equal((await request(`/partners/${partnerId}/contribute`, { amount: 10 })).status, 400);

    // Edit: only name/phone/notes change -- the financial totals are untouched
    // no matter what a caller sends for them, and a read-only user can't edit.
    assert.equal((await request(`/partners/${partnerId}`, { name: 'Hacked' }, 'PUT', readOnly)).status, 403);
    const edited = await request(
      `/partners/${partnerId}`,
      { name: '  Cali   Abdikadir ', phone: '615000000', notes: 'Corrected spelling', totalContributedCents: 999999999, currentEquityCents: 0 },
      'PUT'
    );
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.name, 'Cali Abdikadir', 'trimmed and whitespace-collapsed, same as create');
    assert.equal(edited.data.phone, '615000000');
    assert.equal(edited.data.notes, 'Corrected spelling');
    assert.equal(edited.data.totalContributed, 30000, 'financial totals ignore whatever the request body sent for them');
    assert.equal(edited.data.currentEquity, 23874.24);
    assert.equal((await Partner.findById(partnerId)).currentEquityCents, 2387424, 'unchanged in the database too');

    // Editing to a name that collides with another partner is rejected; editing to its own unchanged name is fine.
    const second = await request('/partners', { name: 'Second Partner' });
    assert.equal((await request(`/partners/${second.data.id}`, { name: 'cali abdikadir' }, 'PUT')).status, 409);
    assert.equal((await request(`/partners/${partnerId}`, { name: 'Cali Abdikadir' }, 'PUT')).status, 200);
    assert.equal((await request(`/partners/${partnerId}`, { name: '' }, 'PUT')).status, 400);
    assert.equal((await request(`/partners/${new mongoose.Types.ObjectId()}`, { name: 'X' }, 'PUT')).status, 404);
  } finally {
    await teardown(server);
  }
});

test('FIXED ASSETS -- create, list, remove (soft), permissions', { timeout: 60000 }, async () => {
  const { server, request } = await setup('fixed_assets');
  try {
    const noAccess = await User.create({ username: 'na2', name: 'NA2', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
    const readOnly = await User.create({ username: 'ro2', name: 'RO2', passwordHash: 'unused', role: 'cashier', permissions: ['fixedAssets'] });

    assert.equal((await request('/fixed-assets', null, 'GET', noAccess)).status, 403);

    const created = await request('/fixed-assets', { name: 'Computer and Printer', value: 1370, dateAdded: '2026-09-01', notes: 'Office desk unit' });
    assert.equal(created.status, 201, JSON.stringify(created));
    assert.equal(created.data.value, 1370);
    assert.equal((await request('/fixed-assets', { name: 'Shelves', value: 8341.5 })).status, 201);

    assert.equal((await request('/fixed-assets', { name: 'x', value: 1 }, 'POST', readOnly)).status, 403, 'read-only user cannot create');
    const list = await request('/fixed-assets', null, 'GET', readOnly);
    assert.equal(list.status, 200);
    assert.equal(list.data.assets.length, 2);
    assert.equal(list.data.total, 1370 + 8341.5);

    assert.equal((await request('/fixed-assets', { name: '', value: 10 })).status, 400);
    assert.equal((await request('/fixed-assets', { name: 'Bad', value: -5 })).status, 400);

    const remove = await request(`/fixed-assets/${created.data.id}/remove`, { reason: 'Sold' });
    assert.equal(remove.status, 200, JSON.stringify(remove));
    const afterRemove = await request('/fixed-assets', null, 'GET');
    assert.equal(afterRemove.data.assets.length, 1);
    assert.equal(afterRemove.data.total, 8341.5);
    assert.equal((await request(`/fixed-assets/${created.data.id}/remove`, {})).status, 409, 'double remove rejected');
    assert.equal((await FixedAsset.findById(created.data.id)).isActive, false, 'kept, not deleted, for historical reconstruction');

    // Edit: updates the fields and the Fixed Assets total reflects it immediately.
    const shelves = (await request('/fixed-assets', null, 'GET')).data.assets[0];
    assert.equal((await request(`/fixed-assets/${shelves.id}`, { name: 'x', value: 1 }, 'PUT', readOnly)).status, 403, 'read-only user cannot edit');
    const edited = await request(`/fixed-assets/${shelves.id}`, { name: 'Shelving Units', value: 9000, dateAdded: '2026-01-01', notes: 'Renamed' }, 'PUT');
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.name, 'Shelving Units');
    assert.equal(edited.data.value, 9000);
    assert.equal(edited.data.notes, 'Renamed');
    const afterEdit = await request('/fixed-assets', null, 'GET');
    assert.equal(afterEdit.data.total, 9000, 'total recalculated from the edited value');
    assert.equal(afterEdit.data.assets[0].name, 'Shelving Units');

    assert.equal((await request(`/fixed-assets/${shelves.id}`, { name: '', value: 10 }, 'PUT')).status, 400);
    assert.equal((await request(`/fixed-assets/${shelves.id}`, { name: 'Bad', value: -5 }, 'PUT')).status, 400);
    assert.equal((await request(`/fixed-assets/${created.data.id}`, { name: 'x', value: 1 }, 'PUT')).status, 404, 'cannot edit a removed asset');
  } finally {
    await teardown(server);
  }
});
