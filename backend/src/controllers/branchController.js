import mongoose from 'mongoose';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import { clearBranchCache } from '../middleware/auth.js';
import { runWithBranch } from '../services/branchContext.js';
import { seedDefaultAccounts } from '../utils/seedAccounts.js';

const toDTO = (b, users = null) => ({
  id: b._id,
  name: b.name,
  address: b.address,
  phone: b.phone,
  active: b.active,
  users,
  createdAt: b.createdAt,
});

// GET /api/branches -- the Super Admin gets every branch (with how many
// users each has); anyone else just their own.
export const listBranches = asyncHandler(async (req, res) => {
  if (!req.user.isSuperAdmin) {
    const own = req.user.branch ? await Branch.findById(req.user.branch) : null;
    return res.json({ success: true, data: own ? [toDTO(own)] : [], current: req.branchId });
  }
  const [branches, counts] = await Promise.all([
    Branch.find().sort({ createdAt: 1 }),
    User.aggregate([{ $match: { branch: { $ne: null } } }, { $group: { _id: '$branch', n: { $sum: 1 } } }]),
  ]);
  const byBranch = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ success: true, data: branches.map((b) => toDTO(b, byBranch.get(String(b._id)) || 0)), current: req.branchId });
});

function readFields(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(400, 'Branch name is required.');
  if (name.length > 100) throw new ApiError(400, 'Branch name is too long.');
  return { name, address: String(body.address || '').trim().slice(0, 200), phone: String(body.phone || '').trim().slice(0, 100) };
}

// POST /api/branches -- Super Admin: opens a new, empty branch (with the
// default payment accounts).
export const createBranch = asyncHandler(async (req, res) => {
  const fields = readFields(req.body);
  let branch;
  try {
    branch = await Branch.create(fields);
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, `A branch called "${fields.name}" already exists.`);
    throw err;
  }
  clearBranchCache();
  await runWithBranch(branch._id, () => seedDefaultAccounts());
  await logAudit({ user: req.user, action: 'branch.create', entityType: 'Branch', entityId: branch._id, details: fields });
  res.status(201).json({ success: true, data: toDTO(branch, 0) });
});

// PUT /api/branches/:id -- Super Admin: rename, contacts, open/close.
export const updateBranch = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Branch not found.');
  const branch = await Branch.findById(req.params.id);
  if (!branch) throw new ApiError(404, 'Branch not found.');
  Object.assign(branch, readFields({ ...branch.toObject(), ...req.body }));
  if (req.body.active !== undefined) {
    if (req.body.active === false && (await Branch.countDocuments({ active: true, _id: { $ne: branch._id } })) === 0) {
      throw new ApiError(400, 'At least one branch must stay open.');
    }
    branch.active = req.body.active === true;
  }
  try {
    await branch.save();
  } catch (err) {
    if (err?.code === 11000) throw new ApiError(409, `A branch called "${branch.name}" already exists.`);
    throw err;
  }
  clearBranchCache();
  await logAudit({ user: req.user, action: 'branch.update', entityType: 'Branch', entityId: branch._id, details: { name: branch.name, active: branch.active } });
  res.json({ success: true, data: toDTO(branch) });
});
