import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Attaches req.user if a valid token is present, but never rejects the
// request when it is absent or invalid. Used for endpoints (like the very
// first user registration) that behave differently when authenticated.
export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select('-passwordHash');
    if (user && user.active) req.user = user;
    next();
  } catch {
    next();
  }
}
