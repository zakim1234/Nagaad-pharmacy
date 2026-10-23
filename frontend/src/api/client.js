import axios from 'axios';

// VITE_API_URL is baked in at build time (see .env.development / .env.production).
// Falling back to the local backend keeps `vite`/`vite preview` usable even
// without an env file present.
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5010/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pos_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const branch = getSelectedBranch();
  // No branch chosen: the Super Admin's all-branches view (reports only) --
  // unless an overview page (Zakat, Commissions) is working on one branch
  // it picked itself.
  config.headers['X-Branch-Id'] = branch || pageBranch || 'all';
  return config;
});

// The branch the Super Admin chose to work in (ignored by the server for
// anyone else, who always works in their own branch).
// The Super Admin with no branch open: reports add every branch together.
export function isAllBranchesView(user) {
  return !!user?.isSuperAdmin && !getSelectedBranch() && !pageBranch;
}

// The branch an overview page (Zakat, Commissions) is working on, picked on
// the page itself; null = all branches, read-only. Cleared when the page closes.
let pageBranch = null;
export function setPageBranch(id) {
  pageBranch = id ? String(id) : null;
}

export function getSelectedBranch() {
  try {
    return localStorage.getItem('pos_branch') || '';
  } catch {
    return '';
  }
}
export function setSelectedBranch(id) {
  try {
    if (id) localStorage.setItem('pos_branch', id);
    else localStorage.removeItem('pos_branch');
  } catch {
    // storage unavailable: the server falls back to the first branch
  }
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

client.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    const message =
      error.response?.data?.message ||
      (error.request && !error.response
        ? 'Cannot reach the server. Please check your connection and try again.'
        : 'Something went wrong. Please try again.');
    return Promise.reject({ ...error, friendlyMessage: message });
  }
);

export default client;
