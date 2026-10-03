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
  return config;
});

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
