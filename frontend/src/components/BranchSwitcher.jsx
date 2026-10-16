import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import client, { getSelectedBranch, setSelectedBranch } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

// Sidebar strip showing which branch this screen is working in. The Super
// Admin picks the branch here (every page then shows that branch); everyone
// else just sees their own branch's name.
export default function BranchSwitcher() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    if (!user) return;
    client
      .get('/branches')
      .then((res) => {
        setBranches(res.data.data);
        const chosen = getSelectedBranch();
        const valid = res.data.data.some((b) => String(b.id) === chosen && b.active);
        setCurrent(valid ? chosen : String(res.data.current || ''));
      })
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

  const change = (id) => {
    setSelectedBranch(id);
    setCurrent(id);
    // Every page reloads its data for the newly chosen branch.
    window.location.reload();
  };

  return (
    <label className="mx-3 mb-2 block rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-700">
        <Store className="h-3.5 w-3.5" /> Working in branch
      </span>
      <select
        value={current}
        onChange={(e) => change(e.target.value)}
        className="mt-1 w-full cursor-pointer bg-transparent text-sm font-bold text-neutral-900 outline-none"
      >
        {branches
          .filter((b) => b.active)
          .map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
      </select>
    </label>
  );
}
