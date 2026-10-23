import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Branch from '../models/Branch.js';
import { runWithBranch } from '../services/branchContext.js';
import { ApiError } from '../utils/ApiError.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'You are not logged in. Please log in again.');

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      throw new ApiError(401, 'Your session has expired. Please log in again.');
    }

    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user || !user.active) {
      throw new ApiError(401, 'Your account is no longer active. Please contact an administrator.');
    }

    req.user = user;
    // Every request runs in one branch: the user's own, or for the Super
    // Admin the branch they switched to (X-Branch-Id), else the first one.
    // With no branches at all, nothing is filtered (single-shop mode).
    const branches = await activeBranchIds();
    let branch = null;
    if (branches.length) {
      if (user.isSuperAdmin) {
        const wanted = String(req.headers['x-branch-id'] || '');
        if (wanted === 'all' && (isAllBranchesRead(req) || isCompanyWideWrite(req))) {
          // Reports for the whole company: nothing filtered, read-only.
          req.branchId = 'all';
          return runWithBranch(null, () => next());
        }
        if (wanted === 'all' && isOverviewOnlyWrite(req)) {
          throw new ApiError(400, 'You are viewing all branches. Open a branch first to make changes.');
        }
        branch = branches.includes(wanted) ? wanted : branches[0];
      } else {
        if (!user.branch || !branches.includes(String(user.branch))) {
          throw new ApiError(403, 'Your user is not assigned to an open branch. Please contact the Super Admin.');
        }
        branch = String(user.branch);
      }
    }
    req.branchId = branch;
    runWithBranch(branch, () => next());
  } catch (err) {
    next(err);
  }
}

// The Super Admin's "all branches" view covers reading reports only (and the
// lookups report screens use); anything else always runs in one branch, so
// nothing can ever be written without a branch.
const ALL_BRANCHES_READS = ['/api/reports', '/api/quotations', '/api/sales', '/api/customers/search', '/api/partners', '/api/commissions', '/api/zakat'];
function isAllBranchesRead(req) {
  return req.method === 'GET' && ALL_BRANCHES_READS.some((p) => req.originalUrl.startsWith(p));
}
// Year-end profit sharing is company-wide: from the overview it shares every
// branch's combined profit between all partners.
const COMPANY_WIDE_WRITES = ['/api/partners/profit-sharing'];
function isCompanyWideWrite(req) {
  return req.method !== 'GET' && COMPANY_WIDE_WRITES.some((p) => req.originalUrl.startsWith(p));
}
// Pages the overview shows read-only: a change there must name a branch,
// never silently land in the first one.
const OVERVIEW_ONLY = ['/api/partners', '/api/commissions', '/api/zakat'];
function isOverviewOnlyWrite(req) {
  return req.method !== 'GET' && OVERVIEW_ONLY.some((p) => req.originalUrl.startsWith(p));
}

// Open branch ids, oldest first; cached briefly (branches rarely change).
let branchCache = { at: 0, ids: [] };
export async function activeBranchIds({ fresh = false } = {}) {
  if (!fresh && Date.now() - branchCache.at < 5000) return branchCache.ids;
  const ids = (await Branch.find({ active: true }).sort({ createdAt: 1 }).select('_id')).map((b) => String(b._id));
  branchCache = { at: Date.now(), ids };
  return ids;
}
export function clearBranchCache() {
  branchCache = { at: 0, ids: [] };
}

// Only the Super Admin (all branches).
export function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) return next(new ApiError(403, 'Only the Super Admin can do this.'));
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
}

// Backend enforcement of per-user module permissions -- the actual security
// boundary. Frontend nav/route hiding is only a UX convenience; a request
// that reaches the server is always re-checked here against the live user
// record requireAuth just fetched, so a revoked permission takes effect on
// this user's very next request, no re-login required.
export function requirePermission(moduleKey) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'You are not logged in. Please log in again.'));
    if (req.user.role === 'admin' || req.user.permissions?.includes(moduleKey)) return next();
    return next(new ApiError(403, 'You do not have permission to access this module.'));
  };
}
