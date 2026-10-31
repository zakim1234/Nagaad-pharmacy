import { Router } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import Branch from '../models/Branch.js';
import { currentBranch } from '../services/branchContext.js';

// Chat. Inside a branch: a group chat for everyone in it and one-to-one
// chats with its people (and the Super Admin). The Super Admin, from the
// all-branches overview, can write to every branch at once ("All branches")
// and to anyone in any branch. Messages only last until each branch's Close
// Day, which deletes that branch's messages.
const router = Router();
router.use(requireAuth);

const oid = (v) => new mongoose.Types.ObjectId(String(v));
// The Super Admin on the all-branches overview (nothing is branch-filtered).
const isOverview = (req) => req.branchId === 'all' && !!req.user?.isSuperAdmin;

const toDTO = (m, me) => ({
  id: m._id,
  from: m.from,
  fromName: m.fromName,
  to: m.to,
  text: m.text,
  broadcast: !!m.broadcastId,
  mine: String(m.from) === String(me._id),
  createdAt: m.createdAt,
});

function oneToOne(me, withId) {
  if (!mongoose.isValidObjectId(withId)) throw new ApiError(400, 'Choose who to chat with.');
  return {
    $or: [
      { from: me._id, to: oid(withId) },
      { from: oid(withId), to: me._id },
    ],
  };
}

// GET /api/chat/contacts -- who I can chat with, with unread counts.
router.get('/contacts', asyncHandler(async (req, res) => {
  const me = req.user;
  const overview = isOverview(req);
  const branch = currentBranch();
  const [people, branches] = await Promise.all([
    User.find({
      _id: { $ne: me._id },
      active: { $ne: false },
      // In a branch: its people and the Super Admin. Overview / single shop: everyone.
      ...(branch && !overview ? { $or: [{ branch }, { isSuperAdmin: true }] } : {}),
    })
      .select('name role isSuperAdmin branch')
      .sort({ name: 1 })
      .lean(),
    overview ? Branch.find().select('name').lean() : [],
  ]);
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  // Group messages are unread only inside a branch; in the overview the
  // "All branches" chat is the Super Admin's own announcements.
  const unread = await ChatMessage.aggregate([
    { $match: { from: { $ne: me._id }, readBy: { $ne: me._id }, $or: overview ? [{ to: me._id }] : [{ to: null }, { to: me._id }] } },
    { $group: { _id: { $cond: [{ $eq: ['$to', null] }, 'all', '$from'] }, n: { $sum: 1 } } },
  ]);
  const count = new Map(unread.map((u) => [String(u._id), u.n]));
  res.json({
    success: true,
    data: {
      overview,
      group: overview
        ? { id: 'all', name: 'All branches', note: 'Every user and admin in every branch', unread: 0 }
        : { id: 'all', name: 'Everyone', note: 'Everyone in this branch', unread: count.get('all') || 0 },
      people: people.map((p) => ({
        id: p._id,
        name: p.name,
        role: p.isSuperAdmin ? 'Super Admin' : p.role,
        branchName: overview ? (p.isSuperAdmin ? 'All branches' : branchName.get(String(p.branch)) || '') : '',
        unread: count.get(String(p._id)) || 0,
      })),
      unread: [...count.values()].reduce((t, n) => t + n, 0),
    },
  });
}));

// GET /api/chat/messages?with=all|userId -- the conversation (last 200),
// marked as read for me.
router.get('/messages', asyncHandler(async (req, res) => {
  const me = req.user;
  const withId = String(req.query.with || 'all');
  let messages;
  if (withId === 'all' && isOverview(req)) {
    // My announcements to every branch: one line per announcement.
    const copies = await ChatMessage.find({ from: me._id, broadcastId: { $ne: '' } }).sort({ createdAt: -1 }).limit(1000).lean();
    const seen = new Set();
    messages = copies.filter((m) => (seen.has(m.broadcastId) ? false : seen.add(m.broadcastId))).slice(0, 200);
  } else {
    const filter = withId === 'all' ? { to: null } : oneToOne(me, withId);
    messages = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }
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
  const overview = isOverview(req);

  if (to === 'all') {
    if (overview) {
      // To every branch: one copy in each branch's group chat.
      const branches = await Branch.find({ active: { $ne: false } }).select('_id').lean();
      const broadcastId = randomUUID();
      const copies = await ChatMessage.insertMany(
        (branches.length ? branches : [{ _id: null }]).map((b) => ({ branch: b._id, from: me._id, fromName: me.name, to: null, text, readBy: [me._id], broadcastId }))
      );
      return res.status(201).json({ success: true, data: toDTO(copies[0], me) });
    }
    const m = await ChatMessage.create({ from: me._id, fromName: me.name, to: null, text, readBy: [me._id] });
    return res.status(201).json({ success: true, data: toDTO(m, me) });
  }

  if (!mongoose.isValidObjectId(to)) throw new ApiError(400, 'Choose who to chat with.');
  const other = await User.findById(to).select('_id branch isSuperAdmin active');
  const branch = currentBranch();
  if (!other || other.active === false) throw new ApiError(400, 'That person is not available.');
  if (!overview && branch && !other.isSuperAdmin && String(other.branch) !== String(branch)) {
    throw new ApiError(400, 'That person is not in this branch.');
  }
  // A Super Admin message from the overview lives in the other person's branch,
  // so they see it there and that branch's Close Day deletes it.
  const m = await ChatMessage.create({
    ...(overview ? { branch: other.branch || null } : {}),
    from: me._id,
    fromName: me.name,
    to: other._id,
    text,
    readBy: [me._id],
  });
  res.status(201).json({ success: true, data: toDTO(m, me) });
}));

export default router;
