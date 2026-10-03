import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import client, { setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('pos_token');
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
  }, [logout]);

  const refreshUser = useCallback(() => {
    if (!localStorage.getItem('pos_token')) return Promise.resolve(null);
    return client
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.data);
        return res.data.data;
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('pos_token');
    if (!token) {
      setLoading(false);
      return;
    }
    client
      .get('/auth/me')
      .then((res) => setUser(res.data.data))
      .catch(() => {
        localStorage.removeItem('pos_token');
      })
      .finally(() => setLoading(false));
  }, []);

  // Permission/role/active changes an admin makes elsewhere should take
  // effect without forcing a re-login -- requireAuth already re-fetches the
  // user fresh on every API call server-side, so this periodic refresh just
  // brings the frontend's copy (nav, route guards) into line with that
  // shortly after. Deactivation itself is enforced immediately by the next
  // real API call regardless of this timer.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(refreshUser, 60000);
    return () => clearInterval(interval);
  }, [user, refreshUser]);

  const login = async (username, password) => {
    const res = await client.post('/auth/login', { username, password });
    localStorage.setItem('pos_token', res.data.data.token);
    setUser(res.data.data.user);
    return res.data.data.user;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
