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
  // No branch chosen: the Super Admin's all-branches view (reports only).
  config.headers['X-Branch-Id'] = branch || 'all';
  // In the overview, the sidebar's "Show" selector can narrow what is read
  // to one branch (the server only honours it for the Super Admin's reads).
  const view = !branch && (config.method || 'get').toLowerCase() === 'get' ? getViewBranch() : null;
  if (view) config.params = { ...(config.params || {}), branch: view.id };
  return config;
});

// The branch the Super Admin chose to work in (ignored by the server for
// anyone else, who always works in their own branch).
// The Super Admin with no branch open: reports add every branch together.
export function isAllBranchesView(user) {
  return !!user?.isSuperAdmin && !getSelectedBranch();
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

// The overview's "Show" selector: null = all branches together, otherwise
// { id, name } of the one branch being looked at.
export function getViewBranch() {
  try {
    const v = JSON.parse(localStorage.getItem('pos_view_branch') || 'null');
    return v && v.id ? v : null;
  } catch {
    return null;
  }
}
export function setViewBranch(view) {
  try {
    if (view?.id) localStorage.setItem('pos_view_branch', JSON.stringify({ id: String(view.id), name: view.name }));
    else localStorage.removeItem('pos_view_branch');
  } catch {
    // storage unavailable: everything shows all branches
  }
}
// What the overview is showing: "All branches" or the one branch's name.
export function overviewScopeLabel() {
  return getViewBranch()?.name || 'All branches';
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
