import jwt from 'jsonwebtoken';
import User from '../models/User.js';
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
    next();
  } catch (err) {
    next(err);
  }
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
