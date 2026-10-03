import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';

// Frontend hiding is a UX convenience, not the security boundary -- the
// backend's requirePermission middleware re-checks every request
// regardless of what this renders. This exists so a direct URL visit
// (typed, bookmarked, or reached after a permission was revoked) shows a
// clear message instead of a broken/empty page or a raw 403 from the API.
export default function RequirePermission({ module, adminOnly, children }) {
  const { user } = useAuth();

  const allowed = adminOnly ? user?.role === 'admin' : hasPermission(user, module);
  if (!allowed) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <p className="text-lg font-semibold text-rose-600">Ma lihi ogolaansho aad u gasho boggan.</p>
        <p className="mt-1 text-sm text-slate-400">You do not have permission to access this page.</p>
      </div>
    );
  }

  return children;
}
