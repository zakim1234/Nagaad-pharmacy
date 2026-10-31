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

// The Super Admin, from the all-branches overview, writes to every branch at
// once and to anyone in any branch; each branch's Close Day deletes only its
// own messages.
test('CHAT SUPER ADMIN -- all branches at once, one-to-one with anyone, per-branch deletion', { timeout: 90000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/chat_super_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-chat-super-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const hodan = await Branch.create({ name: 'Hodan Branch' });
  const bakaal = await Branch.create({ name: 'Bakaal Branch' });
  const owner = await User.create({ username: 'owner', name: 'Owner', passwordHash: 'unused', role: 'admin', isSuperAdmin: true });
  const cumar = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos'], branch: hodan._id });
  const cali = await User.create({ username: 'cali', name: 'Cali', passwordHash: 'unused', role: 'admin', branch: bakaal._id });
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
    // The overview lists everyone of every branch, with their branch.
    const contacts = await overview('/chat/contacts');
    assert.equal(contacts.status, 200, JSON.stringify(contacts));
    assert.equal(contacts.data.group.name, 'All branches');
    assert.deepEqual(contacts.data.people.map((p) => [p.name, p.branchName]).sort(), [['Cali', 'Bakaal Branch'], ['Cumar', 'Hodan Branch']]);

    // One announcement reaches both branches' group chats.
    assert.equal((await overview('/chat/messages', { to: 'all', text: 'Stock count on Friday' })).status, 201);
    assert.equal(await ChatMessage.countDocuments(), 2, 'one copy per branch');
    for (const [user] of [[cumar], [cali]]) {
      const group = await as(user)('/chat/messages?with=all');
      assert.deepEqual(group.data.map((m) => [m.fromName, m.text, m.broadcast]), [['Owner', 'Stock count on Friday', true]]);
    }
    assert.equal((await overview('/chat/messages?with=all')).data.length, 1, 'the owner sees it once');

    // Private message to Cumar (Hodan); Cali cannot see it; Cumar replies.
    assert.equal((await overview('/chat/messages', { to: cumar.id, text: 'How are sales today?' })).status, 201);
    assert.equal((await as(cali)(`/chat/messages?with=${owner.id}`)).data.length, 0);
    assert.equal((await as(cumar)('/chat/contacts')).data.people.find((p) => p.name === 'Owner').unread, 1);
    assert.equal((await as(cumar)('/chat/messages', { to: owner.id, text: 'Good, 40 dollars so far' })).status, 201);
    assert.equal((await overview('/chat/contacts')).data.people.find((p) => p.name === 'Cumar').unread, 1);
    const dm = await overview(`/chat/messages?with=${cumar.id}`);
    assert.deepEqual(dm.data.map((m) => m.text), ['How are sales today?', 'Good, 40 dollars so far']);

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
