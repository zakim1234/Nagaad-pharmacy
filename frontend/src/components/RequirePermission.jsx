import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';

// Frontend hiding is a UX convenience, not the security boundary -- the
// backend's requirePermission middleware re-checks every request
// regardless of what this renders. This exists so a direct URL visit
// (typed, bookmarked, or reached after a permission was revoked) shows a
// clear message instead of a broken/empty page or a raw 403 from the API.
export default function RequirePermission({ module, adminOnly, roles, superAdmin, children }) {
  const { user } = useAuth();

  const allowed = superAdmin ? !!user?.isSuperAdmin : roles ? roles.includes(user?.role) : adminOnly ? user?.role === 'admin' : hasPermission(user, module);
  // No permission: back to their own home (My Report for anyone not admin).
  if (!allowed) return <Navigate to="/dashboard" replace />;

  return children;
}
