import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { CalendarDays, DollarSign, TrendingUp, Clock, Boxes, Wallet, Store, Users, ArrowRight, Lock, Unlock, AlertTriangle, Globe2, Receipt } from 'lucide-react';
import client, { setSelectedBranch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { ChartTooltip, axisProps, gridProps, compactMoney, PALETTE } from '../../components/reports/chartKit.jsx';
import logo from '../../images/logo.png';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const openBranch = (id, path = '/dashboard') => {
  setSelectedBranch(String(id));
  window.location.href = path;
};

// The Super Admin's own home: the whole company today and this month, every
// branch at a glance (open/closed day, staff, sales), the last 14 days per
// branch, alerts and the latest sales -- opening any branch is one click.
export default function SuperDashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get('/branches/overview')
      .then((r) => setData(r.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Could not load the dashboard.'));
  }, []);

  if (error) return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <PageSpinner />;

  const { totals, branches, days } = data;
  const chartData = days.map((d, i) => Object.fromEntries([['day', d.slice(5)], ...branches.map((b) => [b.name, b.daily[i]])]));
  const openDays = branches.filter((b) => b.active && b.dayStatus === 'OPEN').length;
  const alertBranches = branches.filter((b) => b.alerts.lowStock + b.alerts.expired + b.alerts.nearExpiry > 0);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-6 text-white shadow-lg shadow-black/20 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-600/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <img src={logo} alt={BUSINESS.name} className="h-16 w-auto shrink-0 object-contain drop-shadow-[0_0_6px_rgba(255,255,255,0.55)]" />
            <div>
              <p className="flex items-center gap-1.5 text-sm text-white/70">
                <CalendarDays className="h-4 w-4" />
                {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
                {greeting()}
                {user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
              </h1>
              <p className="mt-1 text-sm text-white/70">
                Super Admin · {branches.length} branch{branches.length === 1 ? '' : 'es'} · {openDays} open today · {totals.staff} staff
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/all-branches" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-sm hover:bg-brand-50">
                  <Globe2 className="h-4 w-4" /> Compare branches
                </Link>
                <Link to="/branches" className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25">
                  <Store className="h-4 w-4" /> Manage branches
                </Link>
                <Link to="/users" className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/25 hover:bg-white/25">
                  <Users className="h-4 w-4" /> Users
                </Link>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:w-80">
            <HeroStat label="Today's sales" value={formatCurrency(totals.todaySales)} hint={`${formatCurrency(totals.todayProfit)} profit`} />
            <HeroStat label="Pending today" value={formatCurrency(totals.pendingSales)} hint="Not yet closed" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={DollarSign} tone="red" label="This month's sales" value={formatCurrency(totals.monthSales)} hint="All branches" />
        <Kpi icon={TrendingUp} tone="dark" label="This month's profit" value={formatCurrency(totals.monthProfit)} hint="Gross, all branches" />
        <Kpi icon={Boxes} label="Stock value" value={formatCurrency(totals.stockValue)} hint="At cost, all branches" />
        <Kpi icon={Wallet} label="Customers owe" value={formatCurrency(totals.customerDebt)} hint="All branches" />
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Branches today</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((b, i) => (
            <div key={b.branchId} className={`rounded-2xl border bg-white p-4 shadow-sm ${b.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: PALETTE[i % PALETTE.length] }}>
                    <Store className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-bold text-slate-900">{b.name}</p>
                    <p className="text-xs text-slate-400">
                      {b.staff} staff{!b.active && ' · closed branch'}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.dayStatus === 'OPEN' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-900 text-white'}`}>
                  {b.dayStatus === 'OPEN' ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  Day {b.dayStatus === 'OPEN' ? 'open' : 'closed'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Mini label="Today" value={formatCurrency(b.todaySales)} />
                <Mini label="Pending" value={formatCurrency(b.pendingSales)} sub={`${b.pendingCount} inv.`} />
                <Mini label="Month" value={formatCurrency(b.monthSales)} />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Owed {formatCurrency(b.customerDebt)} · stock {formatCurrency(b.stockValue)}
                </span>
                {b.active && (
                  <button onClick={() => openBranch(b.branchId)} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700">
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
          <p className="text-sm font-semibold text-slate-900">Sales, last 14 days</p>
          <p className="mb-2 text-xs text-slate-400">Confirmed sales per branch</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} />
                {branches.map((b, i) => (
                  <Area key={b.branchId} type="monotone" dataKey={b.name} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <AlertTriangle className="h-4 w-4 text-brand-600" /> Alerts
          </p>
          {alertBranches.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No stock alerts in any branch.</p>
          ) : (
            <ul className="space-y-2">
              {alertBranches.map((b) => (
                <li key={b.branchId} className="rounded-lg border border-slate-100 px-3 py-2">
                  <button onClick={() => openBranch(b.branchId, '/inventory')} className="text-sm font-semibold text-slate-800 hover:text-brand-600">
                    {b.name}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                    {b.alerts.lowStock > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{b.alerts.lowStock} low stock</span>}
                    {b.alerts.expired > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{b.alerts.expired} expired</span>}
                    {b.alerts.nearExpiry > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{b.alerts.nearExpiry} near expiry</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <p className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
          <Receipt className="h-4 w-4 text-slate-400" /> Latest sales, all branches
        </p>
        {data.recent.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No sales yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recent.map((s) => (
              <li key={`${s.branch}-${s.receiptNumber}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">{s.branch}</span>
                  <span className="font-medium text-slate-800">{s.receiptNumber}</span>
                  <span className="text-slate-500">{s.customerName}</span>
                  {s.status === 'DRAFT' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      <Clock className="h-3 w-3" /> Pending
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{formatDateTime(s.createdAt)}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{formatCurrency(s.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HeroStat({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
      <p className="text-[11px] uppercase tracking-wide text-white/60">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-white/60">{hint}</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint, tone }) {
  const box = tone === 'red' ? 'bg-brand-600 text-white' : tone === 'dark' ? 'bg-neutral-950 text-white' : 'border border-slate-200 bg-white';
  const sub = tone ? 'text-white/70' : 'text-slate-500';
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${box}`}>
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone ? 'bg-white/15' : 'bg-neutral-100 text-neutral-700'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <p className={`mt-3 text-xs font-medium ${sub}`}>{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className={`text-[11px] ${sub}`}>{hint}</p>
    </div>
  );
}

function Mini({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
