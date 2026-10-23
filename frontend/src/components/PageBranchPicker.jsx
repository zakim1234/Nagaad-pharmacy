import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import client, { setPageBranch } from '../api/client.js';

// For the Super Admin's own pages (Zakat, Commissions): choose which branch
// to work on without opening it. "All branches" shows everything together,
// to look at only. Renders its children again (fresh) whenever the branch
// changes, and lets go of the branch when the page closes.
export default function PageBranchPicker({ children }) {
  const [branches, setBranches] = useState(null);
  const [branchId, setBranchId] = useState('');

  useEffect(() => {
    client
      .get('/branches')
      .then((r) => {
        const open = r.data.data.filter((b) => b.active);
        setBranches(open);
        const first = open[0] ? String(open[0].id) : '';
        setPageBranch(first || null);
        setBranchId(first);
      })
      .catch(() => setBranches([]));
    return () => setPageBranch(null);
  }, []);

  if (branches === null) return null;

  const choose = (id) => {
    setPageBranch(id || null);
    setBranchId(id);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 no-print">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Store className="h-4 w-4 text-brand-600" /> Branch
        </span>
        <select
          value={branchId}
          onChange={(e) => choose(e.target.value)}
          className="min-w-52 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 outline-none focus:border-brand-500"
        >
          {branches.map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
          <option value="">All branches (view only)</option>
        </select>
        <span className="text-xs text-slate-500">{branchId ? 'Everything below is for this branch.' : 'All branches together — choose a branch to pay or make changes.'}</span>
      </div>
      <div key={branchId || 'all'}>{children}</div>
    </div>
  );
}
