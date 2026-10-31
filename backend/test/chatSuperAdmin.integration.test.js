import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Branch from '../src/models/Branch.js';
import ChatMessage from '../src/models/ChatMessage.js';
import { runWithBranch } from '../src/services/branchContext.js';
import { closeDay } from '../src/services/dayCloseService.js';

// The Super Admin talks only to the branch admins -- all at once or one by
// one; an admin never talks to another branch's admin; each branch's Close
// Day deletes only its own messages.
test('CHAT SUPER ADMIN -- only with branch admins; admins not across branches', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/chat_super_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-chat-super-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const hodan = await Branch.create({ name: 'Hodan Branch' });
  const bakaal = await Branch.create({ name: 'Bakaal Branch' });
  const owner = await User.create({ username: 'owner', name: 'Owner', passwordHash: 'unused', role: 'admin', isSuperAdmin: true });
  const hodanAdmin = await User.create({ username: 'cali', name: 'Cali', passwordHash: 'unused', role: 'admin', branch: hodan._id });
  const bakaalAdmin = await User.create({ username: 'faarax', name: 'Faarax', passwordHash: 'unused', role: 'admin', branch: bakaal._id });
  const cumar = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos'], branch: hodan._id });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const as = (user, branchId) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}`, ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}) },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const overview = as(owner, 'all');
  try {
    // The Super Admin sees only the admins, with their branch.
    const contacts = await overview('/chat/contacts');
    assert.equal(contacts.status, 200, JSON.stringify(contacts));
    assert.equal(contacts.data.group.name, 'All admins');
    assert.deepEqual(contacts.data.people.map((p) => [p.name, p.branchName]).sort(), [['Cali', 'Hodan Branch'], ['Faarax', 'Bakaal Branch']]);
    assert.equal((await overview('/chat/messages', { to: cumar.id, text: 'hi' })).status, 403, 'not with staff');

    // To all admins at once: each admin gets it privately; staff do not.
    assert.equal((await overview('/chat/messages', { to: 'all', text: 'Close the accounts tomorrow' })).status, 201);
    for (const admin of [hodanAdmin, bakaalAdmin]) {
      const dm = await as(admin)(`/chat/messages?with=${owner.id}`);
      assert.deepEqual(dm.data.map((m) => [m.fromName, m.text, m.broadcast]), [['Owner', 'Close the accounts tomorrow', true]]);
    }
    assert.equal((await as(cumar)('/chat/messages?with=all')).data.length, 0, 'staff do not see it');
    assert.equal((await overview('/chat/messages?with=all')).data.length, 1, 'shown once to the owner');

    // One admin replies; the owner sees it from any view.
    assert.equal((await as(hodanAdmin)('/chat/messages', { to: owner.id, text: 'Will do' })).status, 201);
    assert.equal((await overview('/chat/contacts')).data.people.find((p) => p.name === 'Cali').unread, 1);
    assert.deepEqual((await as(owner, bakaal._id)(`/chat/messages?with=${hodanAdmin.id}`)).data.map((m) => m.text), ['Close the accounts tomorrow', 'Will do']);

    // Admins never chat across branches; staff never with the Super Admin.
    assert.ok(!(await as(hodanAdmin)('/chat/contacts')).data.people.some((p) => p.name === 'Faarax'));
    assert.equal((await as(hodanAdmin)('/chat/messages', { to: bakaalAdmin.id, text: 'hi' })).status, 403);
    assert.equal((await as(cumar)('/chat/messages', { to: owner.id, text: 'hi' })).status, 403);

    // Hodan's Close Day deletes Hodan's messages only.
    await runWithBranch(hodan._id, () => closeDay({ user: owner }));
    assert.equal(await ChatMessage.countDocuments({ branch: hodan._id }), 0);
    assert.equal(await ChatMessage.countDocuments({ branch: bakaal._id }), 1, "Bakaal's copy stays until Bakaal closes");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
