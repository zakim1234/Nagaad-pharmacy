import { Router } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import ChatMessage from '../models/ChatMessage.js';
import User from '../models/User.js';
import Branch from '../models/Branch.js';

// Chat follows the chain of command:
//  - the Super Admin talks only to the branch admins: one by one, or to all
//    admins at once ("All admins");
//  - a branch admin talks to the Super Admin and to the staff of their own
//    branch: one by one, or to all of them at once ("All my staff") -- never
//    to another branch's admins;
//  - staff talk to their own branch's admins (and read "All my staff").
// Messages only last until each branch's Close Day, which deletes them.
const router = Router();
router.use(requireAuth);

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const roleOf = (u) => (u.isSuperAdmin ? 'super' : u.role === 'admin' ? 'admin' : 'staff');
const sameBranch = (a, b) => String(a.branch || '') === String(b.branch || '');
// The Super Admin's chat spans branches, whatever branch is open.
const scope = (me) => (roleOf(me) === 'super' ? { skipBranch: true } : {});

// May `me` and `other` chat one-to-one?
function canChat(me, other) {
  if (!other || other.active === false || String(other._id) === String(me._id)) return false;
  const a = roleOf(me);
  const b = roleOf(other);
  if (a === 'super') return b === 'admin';
  if (b === 'super') return a === 'admin';
  if (!sameBranch(me, other)) return false;
  return a === 'admin' || b === 'admin'; // staff only with their admins
}

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

const GROUPS = {
  super: { name: 'All admins', note: 'Every branch admin at once', canPost: true },
  admin: { name: 'All my staff', note: 'Everyone working in your branch', canPost: true },
  staff: { name: 'From the admin', note: 'Messages to all staff', canPost: false },
};

// GET /api/chat/contacts -- who I can chat with, with unread counts.
router.get('/contacts', asyncHandler(async (req, res) => {
  const me = req.user;
  const role = roleOf(me);
  const candidates = await User.find({ _id: { $ne: me._id }, active: { $ne: false } })
    .select('name role isSuperAdmin branch active')
    .sort({ name: 1 })
    .lean();
  const people = candidates.filter((u) => canChat(me, u));
  const branchName = new Map((await Branch.find().select('name').lean()).map((b) => [String(b._id), b.name]));

  const unread = await ChatMessage.aggregate([
    { $match: { from: { $ne: me._id }, readBy: { $ne: me._id }, $or: role === 'super' ? [{ to: me._id }] : [{ to: null }, { to: me._id }] } },
    { $group: { _id: { $cond: [{ $eq: ['$to', null] }, 'all', '$from'] }, n: { $sum: 1 } } },
  ]).option(scope(me));
  const count = new Map(unread.map((u) => [String(u._id), u.n]));
  const g = GROUPS[role];
  res.json({
    success: true,
    data: {
      role,
      group: { id: 'all', name: g.name, note: g.note, canPost: g.canPost, unread: role === 'super' ? 0 : count.get('all') || 0 },
      people: people.map((p) => ({
        id: p._id,
        name: p.name,
        role: p.isSuperAdmin ? 'Super Admin' : p.role,
        branchName: role === 'super' ? branchName.get(String(p.branch)) || '' : '',
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
  const role = roleOf(me);
  const withId = String(req.query.with || 'all');
  let messages;
  if (withId === 'all' && role === 'super') {
    // My messages to all admins: one line per message.
    const copies = await ChatMessage.find({ from: me._id, broadcastId: { $ne: '' } }).setOptions(scope(me)).sort({ createdAt: -1 }).limit(2000).lean();
    const seen = new Set();
    messages = copies.filter((m) => (seen.has(m.broadcastId) ? false : seen.add(m.broadcastId))).slice(0, 200);
  } else if (withId === 'all') {
    messages = await ChatMessage.find({ to: null }).sort({ createdAt: -1 }).limit(200).lean();
  } else {
    if (!mongoose.isValidObjectId(withId)) throw new ApiError(400, 'Choose who to chat with.');
    const other = await User.findById(withId).select('role isSuperAdmin branch active').lean();
    if (!canChat(me, other)) throw new ApiError(403, 'You cannot chat with this person.');
    messages = await ChatMessage.find({
      $or: [
        { from: me._id, to: oid(withId) },
        { from: oid(withId), to: me._id },
      ],
    })
      .setOptions(scope(me))
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  }
  const unreadIds = messages.filter((m) => String(m.from) !== String(me._id) && !(m.readBy || []).some((r) => String(r) === String(me._id))).map((m) => m._id);
  if (unreadIds.length) await ChatMessage.updateMany({ _id: { $in: unreadIds } }, { $addToSet: { readBy: me._id } }).setOptions(scope(me));
  res.json({ success: true, data: messages.reverse().map((m) => toDTO(m, me)) });
}));

// POST /api/chat/messages { to: 'all' | userId, text }
router.post('/messages', asyncHandler(async (req, res) => {
  const me = req.user;
  const role = roleOf(me);
  const text = String(req.body.text || '').trim();
  if (!text) throw new ApiError(400, 'Write a message first.');
  if (text.length > 1000) throw new ApiError(400, 'Message is too long (1000 characters max).');
  const to = String(req.body.to || 'all');

  if (to === 'all') {
    if (role === 'staff') throw new ApiError(403, 'Only an admin writes to all staff. Reply to your admin directly.');
    if (role === 'super') {
      // One private copy to every branch admin, in their branch (so their
      // branch's Close Day deletes it), all sharing one id.
      const admins = (await User.find({ role: 'admin', isSuperAdmin: { $ne: true }, active: { $ne: false } }).select('_id branch').lean()).filter((a) => canChat(me, { ...a, role: 'admin' }));
      if (!admins.length) throw new ApiError(400, 'There are no branch admins to write to yet.');
      const broadcastId = randomUUID();
      const copies = await ChatMessage.insertMany(
        admins.map((a) => ({ branch: a.branch || null, from: me._id, fromName: me.name, to: a._id, text, readBy: [me._id], broadcastId }))
      );
      return res.status(201).json({ success: true, data: toDTO(copies[0], me) });
    }
    // A branch admin to all their staff.
    const m = await ChatMessage.create({ from: me._id, fromName: me.name, to: null, text, readBy: [me._id] });
    return res.status(201).json({ success: true, data: toDTO(m, me) });
  }

  if (!mongoose.isValidObjectId(to)) throw new ApiError(400, 'Choose who to chat with.');
  const other = await User.findById(to).select('_id role isSuperAdmin branch active name').lean();
  if (!canChat(me, other)) throw new ApiError(403, 'You cannot chat with this person.');
  // A message between the Super Admin and an admin lives in the admin's branch.
  const branch = role === 'super' ? other.branch || null : roleOf(other) === 'super' ? me.branch || null : undefined;
  const m = await ChatMessage.create({
    ...(branch !== undefined ? { branch } : {}),
    from: me._id,
    fromName: me.name,
    to: other._id,
    text,
    readBy: [me._id],
  });
  res.status(201).json({ success: true, data: toDTO(m, me) });
}));

export default router;
