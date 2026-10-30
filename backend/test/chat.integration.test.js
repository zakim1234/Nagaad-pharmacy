import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import ChatMessage from '../src/models/ChatMessage.js';
import { closeDay } from '../src/services/dayCloseService.js';

// Users chat in a group and one-to-one; Close Day deletes every message.
test('CHAT -- group and one-to-one messages, unread counts, all deleted at Close Day', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/chat_${Date.now()}?replicaSet=stocktest`);
  process.env.JWT_SECRET = 'isolated-chat-secret';
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  const admin = await User.create({ username: 'admin', name: 'Admin', passwordHash: 'unused' });
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
    // Cumar writes to everyone and to the admin only.
    assert.equal((await as(cumar)('/chat/messages', { to: 'all', text: '' })).status, 400);
    assert.equal((await as(cumar)('/chat/messages', { to: 'all', text: 'Zinc is almost finished' })).status, 201);
    assert.equal((await as(cumar)('/chat/messages', { to: admin.id, text: 'Can I give a discount?' })).status, 201);

    // The admin sees 1 unread in the group and 1 from Cumar.
    const c1 = await as(admin)('/chat/contacts');
    assert.equal(c1.status, 200, JSON.stringify(c1));
    assert.equal(c1.data.group.unread, 1);
    assert.equal(c1.data.people.find((p) => p.name === 'Cumar').unread, 1);
    assert.equal(c1.data.unread, 2);

    // Reading the conversation marks it read; Cali cannot see the private one.
    const dm = await as(admin)(`/chat/messages?with=${cumar.id}`);
    assert.deepEqual(dm.data.map((m) => [m.fromName, m.text, m.mine]), [['Cumar', 'Can I give a discount?', false]]);
    assert.equal((await as(admin)('/chat/contacts')).data.people.find((p) => p.name === 'Cumar').unread, 0);
    assert.equal((await as(cali)(`/chat/messages?with=${cumar.id}`)).data.length, 0);
    assert.equal((await as(cali)('/chat/messages?with=all')).data.length, 1, 'the group message is for everyone');

    // Close Day: nothing is kept.
    await closeDay({ user: admin });
    assert.equal(await ChatMessage.countDocuments(), 0);
    assert.equal((await as(admin)('/chat/contacts')).data.unread, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
