import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import { currentBranch } from '../services/branchContext.js';

// Chat between the people of one branch: a group chat for everyone and
// one-to-one chats. Messages only last until Close Day, which deletes them.
const router = Router();
router.use(requireAuth);

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const toDTO = (m, me) => ({
  id: m._id,
  from: m.from,
  fromName: m.fromName,
  to: m.to,
  text: m.text,
  mine: String(m.from) === String(me._id),
  createdAt: m.createdAt,
});

// The filter for one conversation: 'all' (the group) or one person.
function conversation(me, withId) {
  if (withId === 'all') return { to: null };
  if (!mongoose.isValidObjectId(withId)) throw new ApiError(400, 'Choose who to chat with.');
  return {
    $or: [
      { from: me._id, to: oid(withId) },
      { from: oid(withId), to: me._id },
    ],
  };
}

// GET /api/chat/contacts -- the people of this branch, with how many unread
// messages each has sent me, plus the group chat's unread count.
router.get('/contacts', asyncHandler(async (req, res) => {
  const me = req.user;
  const branch = currentBranch();
  const people = await User.find({
    _id: { $ne: me._id },
    active: { $ne: false },
    // This branch's people (and the Super Admin); everyone in single-shop mode.
    ...(branch ? { $or: [{ branch }, { isSuperAdmin: true }] } : {}),
  })
    .select('name role isSuperAdmin')
    .sort({ name: 1 })
    .lean();
  const unread = await ChatMessage.aggregate([
    { $match: { from: { $ne: me._id }, readBy: { $ne: me._id }, $or: [{ to: null }, { to: me._id }] } },
    { $group: { _id: { $cond: [{ $eq: ['$to', null] }, 'all', '$from'] }, n: { $sum: 1 } } },
  ]);
  const count = new Map(unread.map((u) => [String(u._id), u.n]));
  res.json({
    success: true,
    data: {
      group: { id: 'all', name: 'Everyone', unread: count.get('all') || 0 },
      people: people.map((p) => ({ id: p._id, name: p.name, role: p.isSuperAdmin ? 'Super Admin' : p.role, unread: count.get(String(p._id)) || 0 })),
      unread: [...count.values()].reduce((t, n) => t + n, 0),
    },
  });
}));

// GET /api/chat/messages?with=all|userId -- the conversation (last 200),
// marked as read for me.
router.get('/messages', asyncHandler(async (req, res) => {
  const me = req.user;
  const filter = conversation(me, String(req.query.with || 'all'));
  const messages = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const unreadIds = messages.filter((m) => String(m.from) !== String(me._id) && !(m.readBy || []).some((r) => String(r) === String(me._id))).map((m) => m._id);
  if (unreadIds.length) await ChatMessage.updateMany({ _id: { $in: unreadIds } }, { $addToSet: { readBy: me._id } });
  res.json({ success: true, data: messages.reverse().map((m) => toDTO(m, me)) });
}));

// POST /api/chat/messages { to: 'all' | userId, text }
router.post('/messages', asyncHandler(async (req, res) => {
  const me = req.user;
  const text = String(req.body.text || '').trim();
  if (!text) throw new ApiError(400, 'Write a message first.');
  if (text.length > 1000) throw new ApiError(400, 'Message is too long (1000 characters max).');
  const to = String(req.body.to || 'all');
  let toId = null;
  if (to !== 'all') {
    if (!mongoose.isValidObjectId(to)) throw new ApiError(400, 'Choose who to chat with.');
    const other = await User.findById(to).select('_id branch isSuperAdmin active');
    const branch = currentBranch();
    if (!other || other.active === false || (branch && !other.isSuperAdmin && String(other.branch) !== String(branch))) {
      throw new ApiError(400, 'That person is not in this branch.');
    }
    toId = other._id;
  }
  const m = await ChatMessage.create({ from: me._id, fromName: me.name, to: toId, text, readBy: [me._id] });
  res.status(201).json({ success: true, data: toDTO(m, me) });
}));

export default router;
