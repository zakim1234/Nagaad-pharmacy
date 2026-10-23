import { useEffect, useState } from 'react';
import client from '../api/client.js';

// Branch id -> name, loaded only when `enabled` (the Super Admin's
// all-branches view, where records from every branch are listed together).
export function useBranchNames(enabled) {
  const [names, setNames] = useState({});
  useEffect(() => {
    if (!enabled) return;
    client
      .get('/branches')
      .then((r) => setNames(Object.fromEntries(r.data.data.map((b) => [String(b.id), b.name]))))
      .catch(() => setNames({}));
  }, [enabled]);
  return (id) => (id ? names[String(id)] || '—' : 'Company-wide');
}
