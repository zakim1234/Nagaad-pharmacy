import bcrypt from 'bcryptjs';
import User, { PERMISSION_MODULES } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAudit } from '../services/auditService.js';
import Branch from '../models/Branch.js';

function toDTO(u) {
  return {
    id: u._id,
    username: u.username,
    name: u.name,
    role: u.role,
    permissions: u.role === 'admin' ? PERMISSION_MODULES : u.permissions || [],
    active: u.active,
    branch: u.branch?._id || u.branch || null,
    branchName: u.branch?.name || '',
    isSuperAdmin: !!u.isSuperAdmin,
    createdAt: u.createdAt,
  };
}

// With branches, a branch admin only sees and manages their own branch's
// users; the Super Admin manages everyone. Without branches: everyone.
function userScope(req) {
  if (!req.branchId || req.user.isSuperAdmin) return {};
  return { branch: req.user.branch, isSuperAdmin: { $ne: true } };
}

async function resolveUserBranch(req, requested) {
  if (!req.branchId) return null; // no branches
  if (!req.user.isSuperAdmin) return req.user.branch;
  const id = requested || req.branchId;
  const branch = await Branch.findById(id);
  if (!branch) throw new ApiError(400, 'Choose a valid branch for this user.');
  return branch._id;
}

function validatePermissions(permissions) {
  if (permissions === undefined) return undefined;
  if (!Array.isArray(permissions)) throw new ApiError(400, 'Permissions must be a list.');
  for (const p of permissions) {
    if (!PERMISSION_MODULES.includes(p)) throw new ApiError(400, `"${p}" is not a valid permission module.`);
  }
  return [...new Set(permissions)];
}

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find(userScope(req)).populate('branch', 'name').sort({ createdAt: -1 });
  res.json({ success: true, data: users.map(toDTO) });
});

export const createUser = asyncHandler(async (req, res) => {
  const { username, password, name, role = 'cashier', permissions } = req.body;
  if (!username || !username.trim()) throw new ApiError(400, 'Username is required.');
  if (!password || password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');
  if (!name || !name.trim()) throw new ApiError(400, 'Full name is required.');
  if (!['admin', 'manager', 'cashier', 'custom'].includes(role)) throw new ApiError(400, 'Invalid role.');

  const existing = await User.findOne({ username: username.trim().toLowerCase() });
  if (existing) throw new ApiError(409, 'That username is already taken.');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    username: username.trim().toLowerCase(),
    passwordHash,
    name: name.trim(),
    role,
    permissions: validatePermissions(permissions) || [],
    branch: await resolveUserBranch(req, req.body.branchId),
  });
  await user.populate('branch', 'name');

  await logAudit({ user: req.user, action: 'user.create', entityType: 'User', entityId: user._id, details: { username: user.username, role: user.role } });

  res.status(201).json({ success: true, data: toDTO(user) });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, ...userScope(req) });
  if (!user) throw new ApiError(404, 'User not found.');

  const { name, role, permissions, password } = req.body;
  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Full name cannot be empty.');
    user.name = name.trim();
  }
  if (role !== undefined) {
    if (!['admin', 'manager', 'cashier', 'custom'].includes(role)) throw new ApiError(400, 'Invalid role.');
    if (user._id.equals(req.user._id) && role !== 'admin' && user.role === 'admin') {
      throw new ApiError(400, 'You cannot remove your own admin role.');
    }
    user.role = role;
  }
  const validated = validatePermissions(permissions);
  if (validated !== undefined) user.permissions = validated;
  if (password !== undefined) {
    if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters.');
    user.passwordHash = await bcrypt.hash(password, 10);
  }

  if (req.body.branchId !== undefined && req.user.isSuperAdmin && !user.isSuperAdmin) user.branch = await resolveUserBranch(req, req.body.branchId);
  await user.save();
  await user.populate('branch', 'name');

  await logAudit({ user: req.user, action: 'user.update', entityType: 'User', entityId: user._id, details: { role: user.role } });

  res.json({ success: true, data: toDTO(user) });
});

// PATCH /api/users/:id/active -- activate/deactivate. requireAuth re-fetches
// the user fresh on every request, so a deactivated user loses access on
// their very next request (no lingering session/JWT window), while every
// historical sale/action they created stays exactly as it is.
export const setUserActive = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, ...userScope(req) });
  if (!user) throw new ApiError(404, 'User not found.');
  if (user._id.equals(req.user._id)) throw new ApiError(400, 'You cannot deactivate your own account.');

  user.active = !!req.body.active;
  await user.save();

  await logAudit({ user: req.user, action: user.active ? 'user.activate' : 'user.deactivate', entityType: 'User', entityId: user._id, details: {} });

  res.json({ success: true, data: toDTO(user) });
});

export const listPermissionModules = asyncHandler(async (req, res) => {
  res.json({ success: true, data: PERMISSION_MODULES });
});
