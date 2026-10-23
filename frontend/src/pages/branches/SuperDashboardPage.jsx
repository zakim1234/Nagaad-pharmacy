import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Store, Users, ArrowRight, ArrowUpRight, Lock, Unlock, AlertTriangle, Globe2, Receipt, Clock, CheckCircle2 } from 'lucide-react';
import client, { setSelectedBranch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { ChartTooltip, axisProps, compactMoney } from '../../components/reports/chartKit.jsx';

// Branch series in the house colours: red first, then black and greys.
const SERIES = ['#dc2626', '#171717', '#737373', '#a3a3a3', '#d4d4d4', '#991b1b', '#404040'];

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
// branch ranked side by side, the last 14 days, alerts and the latest sales.
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
  const active = branches.filter((b) => b.active);
  const openDays = active.filter((b) => b.dayStatus === 'OPEN').length;
  const ranked = [...branches].sort((a, b) => b.monthSales - a.monthSales);
  const monthTotal = Math.max(1, branches.reduce((s, b) => s + b.monthSales, 0));
  const companyDaily = days.map((d, i) => ({ day: d.slice(5), sales: branches.reduce((s, b) => s + (b.daily[i] || 0), 0) }));
  const stacked = days.map((d, i) => Object.fromEntries([['day', d.slice(5)], ...branches.map((b) => [b.name, b.daily[i] || 0])]));
  const margin = totals.monthSales > 0 ? Math.round((totals.monthProfit / totals.monthSales) * 100) : 0;
  const alertBranches = branches.filter((b) => b.alerts.lowStock + b.alerts.expired + b.alerts.nearExpiry > 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
            {greeting()}
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {active.length} branch{active.length === 1 ? '' : 'es'} · {openDays} open today · {totals.staff} staff
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/all-branches" className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800">
            <Globe2 className="h-4 w-4" /> Compare branches
          </Link>
          <Link to="/branches" className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:border-neutral-300">
            <Store className="h-4 w-4" /> Branches
          </Link>
          <Link to="/users" className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:border-neutral-300">
            <Users className="h-4 w-4" /> Users
          </Link>
        </div>
      </div>

      {/* Today + this month */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="relative overflow-hidden rounded-3xl bg-neutral-950 p-6 text-white xl:col-span-2 sm:p-7">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="relative grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-end">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Today · all branches</p>
              <p className="figure mt-2 text-5xl font-extrabold sm:text-6xl">{formatCurrency(totals.todaySales)}</p>
              <p className="mt-1 text-sm text-neutral-400">confirmed sales</p>
              <div className="mt-6 grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                <HeroFigure label="Profit" value={formatCurrency(totals.todayProfit)} />
                <HeroFigure label="Pending" value={formatCurrency(totals.pendingSales)} hint="not closed yet" />
                <HeroFigure label="Open days" value={`${openDays}/${active.length}`} />
              </div>
            </div>
            <div className="h-40">
              <p className="mb-1 text-right text-[10.5px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Last 14 days</p>
              <ResponsiveContainer width="100%" height="90%">
                <AreaChart data={companyDaily} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
                  <Area type="monotone" dataKey="sales" name="Sales" stroke="#ef4444" strokeWidth={2.5} fill="url(#heroFill)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <div className="grid gap-4">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-6">
            <p className="eyebrow">This month</p>
            <p className="figure mt-2 text-[34px] font-extrabold text-neutral-950">{formatCurrency(totals.monthSales)}</p>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-neutral-500">Gross profit</span>
              <span className="figure font-bold text-neutral-900">{formatCurrency(totals.monthProfit)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, margin))}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-neutral-400">{margin}% margin</p>
          </section>
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-neutral-200/80 bg-neutral-200/80">
            <SmallFigure label="Customers owe" value={formatCurrency(totals.customerDebt)} />
            <SmallFigure label="Stock at cost" value={formatCurrency(totals.stockValue)} />
          </section>
        </div>
      </div>

      {/* Branch ranking */}
      <section className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <div>
            <p className="eyebrow">Branches</p>
            <h2 className="mt-0.5 text-lg font-bold text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
              Ranked by this month's sales
            </h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-neutral-100 bg-neutral-50/70 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                <th className="w-12 px-6 py-2.5">#</th>
                <th className="px-3 py-2.5">Branch</th>
                <th className="px-3 py-2.5">Day</th>
                <th className="px-3 py-2.5 text-right">Today</th>
                <th className="px-3 py-2.5 text-right">Pending</th>
                <th className="px-3 py-2.5 text-right">This month</th>
                <th className="w-48 px-3 py-2.5">Share</th>
                <th className="px-6 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((b, i) => {
                const share = Math.round((b.monthSales / monthTotal) * 100);
                return (
                  <tr key={b.branchId} className={`border-b border-neutral-100 last:border-0 ${b.active ? '' : 'opacity-50'}`}>
                    <td className="px-6 py-3.5">
                      <span className={`figure flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${i === 0 ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>{i + 1}</span>
                    </td>
                    <td className="px-3 py-3.5">
                      <p className="font-semibold text-neutral-950">{b.name}</p>
                      <p className="text-xs text-neutral-400">
                        {b.staff} staff{!b.active && ' · closed branch'}
                      </p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${b.dayStatus === 'OPEN' ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'}`}>
                        {b.dayStatus === 'OPEN' ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {b.dayStatus === 'OPEN' ? 'Open' : 'Closed'}
                      </span>
                    </td>
                    <td className="figure px-3 py-3.5 text-right font-semibold text-neutral-900">{formatCurrency(b.todaySales)}</td>
                    <td className="figure px-3 py-3.5 text-right text-neutral-500">
                      {formatCurrency(b.pendingSales)}
                      {b.pendingCount > 0 && <span className="block text-[10px] text-neutral-400">{b.pendingCount} inv.</span>}
                    </td>
                    <td className="figure px-3 py-3.5 text-right font-bold text-neutral-950">{formatCurrency(b.monthSales)}</td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                          <div className={`h-full rounded-full ${i === 0 ? 'bg-brand-600' : 'bg-neutral-900'}`} style={{ width: `${share}%` }} />
                        </div>
                        <span className="figure w-9 text-right text-xs font-semibold text-neutral-500">{share}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      {b.active && (
                        <button onClick={() => openBranch(b.branchId)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:border-neutral-950 hover:bg-neutral-950 hover:text-white">
                          Open <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily sales by branch + alerts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 xl:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Last 14 days</p>
              <h2 className="mt-0.5 text-lg font-bold text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
                Confirmed sales by branch
              </h2>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-neutral-500">
              {branches.map((b, i) => (
                <span key={b.branchId} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} /> {b.name}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stacked} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="day" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#fafafa' }} />
                {branches.map((b, i) => (
                  <Bar key={b.branchId} dataKey={b.name} stackId="s" fill={SERIES[i % SERIES.length]} radius={i === branches.length - 1 ? [5, 5, 0, 0] : 0} maxBarSize={30} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200/80 bg-white p-6">
          <p className="eyebrow">Needs attention</p>
          <h2 className="mt-0.5 text-lg font-bold text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
            Stock alerts
          </h2>
          {alertBranches.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-neutral-300" />
              <p className="text-sm text-neutral-400">Nothing low, expired or near expiry.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {alertBranches.map((b) => (
                <li key={b.branchId}>
                  <button onClick={() => openBranch(b.branchId, '/inventory')} className="group flex w-full items-center justify-between rounded-2xl border border-neutral-100 px-4 py-3 text-left hover:border-neutral-300">
                    <span>
                      <span className="block text-sm font-semibold text-neutral-900">{b.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                        {b.alerts.expired > 0 && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{b.alerts.expired} expired</span>}
                        {b.alerts.nearExpiry > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{b.alerts.nearExpiry} near expiry</span>}
                        {b.alerts.lowStock > 0 && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700">{b.alerts.lowStock} low stock</span>}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-900" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {alertBranches.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-neutral-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Opens that branch's inventory
            </p>
          )}
        </section>
      </div>

      {/* Latest sales */}
      <section className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white">
        <div className="flex items-center gap-2 px-6 pb-3 pt-5">
          <Receipt className="h-4 w-4 text-neutral-400" />
          <h2 className="text-lg font-bold text-neutral-950" style={{ fontFamily: 'var(--font-display)' }}>
            Latest sales
          </h2>
          <span className="text-sm text-neutral-400">all branches</span>
        </div>
        {data.recent.length === 0 ? (
          <p className="px-6 pb-8 pt-2 text-sm text-neutral-400">No sales yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
            {data.recent.map((s) => (
              <li key={`${s.branch}-${s.receiptNumber}`} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="rounded-md bg-neutral-950 px-2 py-0.5 text-[11px] font-semibold text-white">{s.branch}</span>
                  <span className="font-semibold text-neutral-900">{s.receiptNumber}</span>
                  <span className="truncate text-neutral-500">{s.customerName}</span>
                  {s.status === 'DRAFT' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      <Clock className="h-3 w-3" /> Pending
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-neutral-400">{formatDateTime(s.createdAt)}</span>
                  <span className="figure font-bold text-neutral-950">{formatCurrency(s.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HeroFigure({ label, value, hint }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="figure mt-1 text-lg font-bold text-white">{value}</p>
      {hint && <p className="text-[11px] text-neutral-500">{hint}</p>}
    </div>
  );
}

function SmallFigure({ label, value }) {
  return (
    <div className="bg-white p-5">
      <p className="eyebrow">{label}</p>
      <p className="figure mt-1.5 text-xl font-extrabold text-neutral-950">{value}</p>
    </div>
  );
}
