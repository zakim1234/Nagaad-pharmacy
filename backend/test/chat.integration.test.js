import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import ChatMessage from '../src/models/ChatMessage.js';
import { closeDay } from '../src/services/dayCloseService.js';

// Inside a branch: the admin writes to all staff or one by one; staff reply
// to the admin only; Close Day deletes every message.
test('CHAT -- admin to all staff and one by one; staff only with the admin; deleted at Close Day', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/chat_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-chat-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused', role: 'admin' });
  const cumar = await User.create({ username: 'cumar', name: 'Cumar', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
  const cali = await User.create({ username: 'cali', name: 'Cali', passwordHash: 'unused', role: 'cashier', permissions: ['pos'] });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const as = (user) => async (path, body, method = body != null ? 'POST' : 'GET') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET)}` },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, ...(await r.json()) };
  };
  try {
    // The admin sees the staff and "All my staff"; staff see only the admin.
    const adminContacts = await as(admin)('/chat/contacts');
    assert.equal(adminContacts.data.group.name, 'All my staff');
    assert.deepEqual(adminContacts.data.people.map((p) => p.name).sort(), ['Cali', 'Cumar']);
    const staffContacts = await as(cumar)('/chat/contacts');
    assert.deepEqual(staffContacts.data.people.map((p) => p.name), ['Admin'], 'staff do not chat with each other');
    assert.equal(staffContacts.data.group.canPost, false);

    // The admin writes to all staff; staff read it but cannot post there.
    assert.equal((await as(admin)('/chat/messages', { to: 'all', text: 'Close the shop at 9' })).status, 201);
    assert.equal((await as(cumar)('/chat/contacts')).data.group.unread, 1);
    assert.deepEqual((await as(cali)('/chat/messages?with=all')).data.map((m) => m.text), ['Close the shop at 9']);
    assert.equal((await as(cumar)('/chat/messages', { to: 'all', text: 'ok' })).status, 403);

    // One by one: Cumar replies to the admin; Cali cannot see it, nor write to Cumar.
    assert.equal((await as(cumar)('/chat/messages', { to: admin.id, text: 'Can I give a discount?' })).status, 201);
    assert.equal((await as(admin)('/chat/contacts')).data.people.find((p) => p.name === 'Cumar').unread, 1);
    assert.deepEqual((await as(admin)(`/chat/messages?with=${cumar.id}`)).data.map((m) => [m.fromName, m.text]), [['Cumar', 'Can I give a discount?']]);
    assert.equal((await as(admin)('/chat/contacts')).data.people.find((p) => p.name === 'Cumar').unread, 0, 'read');
    assert.equal((await as(cali)('/chat/messages', { to: cumar.id, text: 'hi' })).status, 403);
    assert.equal((await as(cali)(`/chat/messages?with=${cumar.id}`)).status, 403);

    // Two admins never chat with each other, even in the same branch, and an
    // admin's "All my staff" shows only their own messages.
    const admin2 = await User.create({ username: 'admin2', name: 'Admin Two', passwordHash: 'unused', role: 'admin' });
    assert.ok(!(await as(admin2)('/chat/contacts')).data.people.some((p) => p.name === 'Admin'));
    assert.equal((await as(admin2)('/chat/messages', { to: admin.id, text: 'hi' })).status, 403);
    assert.equal((await as(admin2)('/chat/messages?with=all')).data.length, 0);
    assert.equal((await as(admin2)('/chat/contacts')).data.unread, 0);

    // Close Day: nothing is kept.
    await closeDay({ user: admin });
    assert.equal(await ChatMessage.countDocuments(), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
