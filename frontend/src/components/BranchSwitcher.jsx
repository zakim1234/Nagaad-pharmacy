import { useEffect, useState } from 'react';
import { Store, Globe2, LogOut } from 'lucide-react';
import client, { getSelectedBranch, setSelectedBranch, getViewBranch, setViewBranch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sidebar strip showing where this screen is working. The Super Admin is
// either in the all-branches overview (only All Branches / Users / Branches
// in the menu) or inside one branch (that branch's full menu); everyone
// else just sees their own branch's name.
export default function BranchSwitcher() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const selected = getSelectedBranch();

  useEffect(() => {
    if (!user) return;
    client
      .get('/branches')
      .then((res) => setBranches(res.data.data))
      .catch(() => setBranches([]));
  }, [user]);

  if (!branches.length) return null; // single shop, no branches

  if (!user?.isSuperAdmin) {
    return (
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-semibold text-neutral-700">
        <Store className="h-4 w-4 text-brand-600" /> {branches[0]?.name}
      </div>
    );
  }

  const inside = branches.find((b) => String(b.id) === selected && b.active);

  const go = (id) => {
    setSelectedBranch(id);
    setViewBranch(null);
    // Every page reloads for the newly chosen place.
    window.location.href = id ? '/dashboard' : '/super-dashboard';
  };

  if (!inside) {
    const view = getViewBranch();
    // "Show": look at one branch's figures without leaving the overview.
    const show = (id) => {
      const b = branches.find((x) => String(x.id) === id);
      setViewBranch(b ? { id: b.id, name: b.name } : null);
      window.location.reload();
    };
    return (
      <div className="mx-3 mb-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
        <label className="block">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <Globe2 className="h-3.5 w-3.5" /> All branches · overview
          </span>
          <select value="" onChange={(e) => e.target.value && go(e.target.value)} className="mt-1 w-full cursor-pointer bg-transparent text-sm font-bold text-neutral-900 outline-none">
            <option value="">Open a branch…</option>
            {branches
              .filter((b) => b.active)
              .map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <label className="mt-2 block border-t border-neutral-200 pt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Show figures for</span>
          <select
            value={view ? String(view.id) : ''}
            onChange={(e) => show(e.target.value)}
            className={`mt-0.5 w-full cursor-pointer rounded-md px-1.5 py-1 text-sm font-semibold outline-none ${view ? 'bg-brand-600 text-white' : 'bg-white text-neutral-800'}`}
          >
            <option value="">All branches together</option>
            {branches
              .filter((b) => b.active)
              .map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name} only
                </option>
              ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        <Store className="h-3.5 w-3.5" /> Working in branch
      </span>
      <select value={String(inside.id)} onChange={(e) => go(e.target.value)} className="mt-1 w-full cursor-pointer bg-transparent text-sm font-bold text-neutral-900 outline-none">
        {branches
          .filter((b) => b.active)
          .map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
      </select>
      <button
        type="button"
        onClick={() => go('')}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
      >
        <LogOut className="h-3 w-3" /> Back to all branches
      </button>
    </div>
  );
}
