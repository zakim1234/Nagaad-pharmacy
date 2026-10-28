import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Input, Label } from '../components/ui/Field.jsx';
import { BUSINESS } from '../constants/business.js';
import logo from '../images/logo.png';
import Spinner from '../components/ui/Spinner.jsx';

// How long the welcome screen stays after a successful sign-in.
const WELCOME_MS = 1800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState(false); // the full-screen loading after Sign In

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }
    setLoading(true);
    setWelcome(true);
    const started = Date.now();
    try {
      await login(username.trim(), password);
      await sleep(Math.max(0, WELCOME_MS - (Date.now() - started)));
      const redirectTo = location.state?.from || '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setWelcome(false);
      setError(err.friendlyMessage || 'Incorrect username or password.');
    } finally {
      setLoading(false);
    }
  };

  if (welcome) {
    return (
      <div className="busy-fade fixed inset-0 z-[95] flex flex-col items-center justify-center bg-white px-6 text-center" role="status" aria-live="polite">
        <span className="welcome-breathe flex h-24 w-24 items-center justify-center rounded-[28px] bg-white p-3 shadow-[0_12px_40px_-12px_rgba(47,107,189,0.35)] ring-1 ring-neutral-100">
          <img src={logo} alt={BUSINESS.name} className="h-full w-full object-contain" />
        </span>
        <p className="mt-6 text-[26px] font-extrabold tracking-tight text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
          {BUSINESS.name}
        </p>
        <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.24em] text-neutral-400">Inventory &amp; POS</p>
        <Spinner className="mt-10 h-14 w-14" />
        <p className="mt-5 text-sm font-medium text-neutral-500">Opening {BUSINESS.name}…</p>
        <div className="mt-4 h-1 w-44 overflow-hidden rounded-full bg-brand-100">
          <div className="welcome-progress h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ animationDuration: `${WELCOME_MS}ms` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-[#f6f6f4] lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden surface-blue p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-brand-700/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5">
            <img src={logo} alt={BUSINESS.name} className="h-full w-full object-contain" />
          </span>
          <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {BUSINESS.name}
          </span>
        </div>
        <div className="relative max-w-md">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-brand-400">Inventory &amp; POS</p>
          <h2 className="mt-3 text-[44px] font-extrabold leading-[1.05] tracking-tight">
            Every sale, every shelf, every branch.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-neutral-400">Sell, receive stock, close the day and see the whole business in one place.</p>
        </div>
        <p className="relative text-xs text-neutral-600">© {new Date().getFullYear()} {BUSINESS.name}</p>
      </div>

      {/* Sign-in */}
      <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Phones and tablets: the black brand panel becomes a header card. */}
        <div className="relative mb-8 overflow-hidden rounded-3xl surface-blue p-6 text-white lg:hidden">
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-600/30 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5">
              <img src={logo} alt={BUSINESS.name} className="h-full w-full object-contain" />
            </span>
            <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {BUSINESS.name}
            </span>
          </div>
          <p className="relative mt-5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-brand-400">Inventory &amp; POS</p>
          <p className="relative mt-1 text-2xl font-extrabold leading-tight tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Every sale, every shelf, every branch.
          </p>
        </div>
        <div className="mb-8">
          <p className="eyebrow">Welcome back</p>
          <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-neutral-950">Sign in</h1>
          <p className="mt-1 text-sm text-neutral-500">Use the username and password you were given.</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-3xl border border-neutral-200/80 bg-white p-7">
          {error && (
            <div className="mb-4 rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-medium text-brand-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <Label>Username</Label>
            <Input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </div>

          <div className="mb-5">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Sign In
          </Button>
        </form>
      </div>
      </div>
    </div>
  );
}
