import { useEffect, useState } from 'react';
import { Store, Globe2, ArrowLeft, ChevronDown } from 'lucide-react';
import client, { getSelectedBranch, setSelectedBranch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sidebar strip showing where this screen is working. The Super Admin is
// either in the all-branches overview (with "Open a branch") or inside one
// branch (its name and a way back); everyone else just sees their branch.
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
      <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]">
        <Store className="h-4 w-4 text-brand-400" />
        <span className="truncate text-sm font-semibold text-white">{branches[0]?.name}</span>
      </div>
    );
  }

  const inside = branches.find((b) => String(b.id) === selected && b.active);

  const go = (id) => {
    setSelectedBranch(id);
    // Every page reloads for the newly chosen place.
    window.location.href = id ? '/dashboard' : '/super-dashboard';
  };

  if (!inside) {
    return (
      <div className="mx-3 mb-2 rounded-xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06]">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
          <Globe2 className="h-3.5 w-3.5" /> All branches
        </span>
        <label className="relative mt-1 block">
          <select
            value=""
            onChange={(e) => e.target.value && go(e.target.value)}
            className="w-full cursor-pointer appearance-none bg-transparent pr-6 text-sm font-semibold text-white outline-none"
          >
            <option value="" className="text-neutral-900">
              Open a branch…
            </option>
            {branches
              .filter((b) => b.active)
              .map((b) => (
                <option key={b.id} value={String(b.id)} className="text-neutral-900">
                  {b.name}
                </option>
              ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        </label>
      </div>
    );
  }

  return (
    <div className="mx-3 mb-2 rounded-xl bg-brand-600/15 px-3 py-2.5 ring-1 ring-brand-500/30">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-300">
        <Store className="h-3.5 w-3.5" /> Working in branch
      </span>
      <p className="mt-0.5 truncate text-sm font-bold text-white">{inside.name}</p>
      <button
        type="button"
        onClick={() => go('')}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
      >
        <ArrowLeft className="h-3 w-3" /> Back to all branches
      </button>
    </div>
  );
}
