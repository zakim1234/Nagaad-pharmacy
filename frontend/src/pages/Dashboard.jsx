import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  Boxes,
  Wallet,
  AlertTriangle,
  PackageX,
  CalendarClock,
  ArrowRight,
  ArrowUpRight,
  ShoppingCart,
  PackagePlus,
  BarChart3,
  CalendarDays,
  Trophy,
  CheckCircle2,
  LineChart as LineChartIcon,
  Pill,
} from 'lucide-react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { BUSINESS } from '../constants/business.js';
import { stockStatusBadge } from '../components/ui/Badge.jsx';
import { PageSpinner } from '../components/ui/Spinner.jsx';
import logo from '../images/logo.png';

const REVENUE_COLOR = '#6366f1';
const PROFIT_COLOR = '#10b981';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// Compact axis labels ($1.2k, $3.4M) so long figures never crowd the chart.
function compactCurrency(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get('/dashboard')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Failed to load dashboard.'));
    client
      .get('/inventory/alerts/summary')
      .then((res) => setAlerts(res.data.data))
      .catch(() => {});
  }, []);

  if (error) return <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <PageSpinner />;

  const { cards, charts } = data;
  const lowStockRows = (alerts?.lowStock || []).slice(0, 5);
  const expiredRows = (alerts?.expired || []).slice(0, 5);
  const nearExpiryRows = (alerts?.nearExpiry || []).slice(0, 5);

  const quickActions = [
    { to: '/pos/new', label: 'New Sale', icon: ShoppingCart, module: 'pos', primary: true },
    { to: '/stock', label: 'Add Stock', icon: PackagePlus, module: 'stock' },
    { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports' },
  ].filter((a) => hasPermission(user, a.module));

  const margin = cards.todaySales > 0 ? Math.round((cards.todayProfit / cards.todaySales) * 100) : null;
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = charts.monthlySales.find((m) => m.month === thisMonthKey) || { revenue: 0, profit: 0 };
  const last14Revenue = charts.dailySales.reduce((s, d) => s + d.revenue, 0);
  const last14Profit = charts.dailySales.reduce((s, d) => s + d.profit, 0);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg shadow-indigo-500/20 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <img
              src={logo}
              alt={BUSINESS.name}
              className="h-16 w-auto shrink-0 object-contain drop-shadow-[0_0_1px_rgba(255,255,255,0.9)] drop-shadow-[0_0_6px_rgba(255,255,255,0.55)]"
            />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm text-indigo-100">
                <CalendarDays className="h-4 w-4" /> {todayLabel()}
              </p>
              <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">
                {greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
              </h1>
              <p className="mt-1 text-sm text-indigo-100">Here's what's happening at {BUSINESS.name} today.</p>
              {quickActions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {quickActions.map(({ to, label, icon: Icon, primary }) => (
                    <Link
                      key={to}
                      to={to}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                        primary
                          ? 'bg-white text-indigo-700 shadow-sm hover:bg-indigo-50'
                          : 'bg-white/15 text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/25'
                      }`}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur sm:min-w-[340px]">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-indigo-100">Today's Sales</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(cards.todaySales)}</p>
              <p className="mt-0.5 text-xs text-indigo-100">{cards.todaySalesCount} sale(s)</p>
            </div>
            <div className="border-l border-white/20 pl-3">
              <p className="text-xs font-medium uppercase tracking-wider text-indigo-100">Today's Profit</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(cards.todayProfit)}</p>
              <p className="mt-0.5 text-xs text-indigo-100">{margin === null ? 'No sales yet' : `${margin}% margin`}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Financial KPIs */}
      <div className="kpi-grid grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="This Month's Revenue" value={formatCurrency(thisMonth.revenue)} hint={`${formatCurrency(thisMonth.profit)} profit`} icon={DollarSign} tone="indigo" />
        <KpiCard label="Last 14 Days" value={formatCurrency(last14Revenue)} hint={`${formatCurrency(last14Profit)} profit`} icon={TrendingUp} tone="emerald" />
        <KpiCard label="Inventory Value" value={formatCurrency(cards.stockValue)} hint="at cost price" icon={Wallet} tone="sky" to="/inventory" />
        <KpiCard label="Outstanding Balance" value={formatCurrency(cards.customerDebt)} hint="owed by customers" icon={Wallet} tone="rose" to="/customers" />
      </div>

      {/* Inventory health */}
      <div className="kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HealthTile label="Total Items" value={cards.totalInventoryItems} hint={`${cards.totalStockQuantity} units in stock`} icon={Boxes} tone="slate" />
        <HealthTile label="Low Stock" value={cards.lowStockCount} hint="below minimum" icon={AlertTriangle} tone="amber" alert={cards.lowStockCount > 0} />
        <HealthTile label="Out of Stock" value={cards.outOfStockCount} hint="need reorder" icon={PackageX} tone="rose" alert={cards.outOfStockCount > 0} />
        <HealthTile
          label="Expiring / Expired"
          value={`${cards.nearExpiryCount} / ${cards.expiredCount}`}
          hint="next 30 days / past date"
          icon={CalendarClock}
          tone="orange"
          alert={cards.nearExpiryCount + cards.expiredCount > 0}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          className="chart-container lg:col-span-2"
          title="Sales & Profit"
          subtitle="Last 14 days"
          actions={<Legend />}
        >
          {charts.dailySales.length === 0 ? (
            <EmptyState icon={LineChartIcon} text="No sales in the last 14 days yet." />
          ) : (
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={charts.dailySales} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REVENUE_COLOR} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={REVENUE_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PROFIT_COLOR} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={PROFIT_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={compactCurrency} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#c7d2fe', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={REVENUE_COLOR} strokeWidth={2.5} fill="url(#gRevenue)" activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="profit" name="Profit" stroke={PROFIT_COLOR} strokeWidth={2.5} fill="url(#gProfit)" activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel className="chart-container" title="Top-Selling Items" subtitle="Last 14 days" icon={Trophy}>
          <TopSellingList rows={charts.topSelling} />
        </Panel>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="chart-container lg:col-span-2" title="Monthly Trend" subtitle="Revenue vs profit by month" actions={<Legend />}>
          {charts.monthlySales.length === 0 ? (
            <EmptyState icon={BarChart3} text="Monthly figures will appear after your first sale." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={charts.monthlySales} barGap={4} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={compactCurrency} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="revenue" name="Revenue" fill={REVENUE_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="profit" name="Profit" fill={PROFIT_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <AlertPanel
          title="Low Stock Alerts"
          icon={AlertTriangle}
          tone="amber"
          link={{ to: '/inventory', label: 'View all' }}
          rows={lowStockRows}
          total={cards.lowStockCount}
          emptyText="Nothing low on stock right now."
          detail={(item) => `${item.quantity} ${item.unit} left · min ${item.lowStockThreshold}`}
          badge={(item) => stockStatusBadge(item.stockStatus).label}
        />
      </div>

      {/* Expiry alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AlertPanel
          title="Expired Medicine"
          icon={PackageX}
          tone="rose"
          link={{ to: '/reports', label: 'Full report' }}
          rows={expiredRows}
          total={cards.expiredCount}
          emptyText="No expired items."
          detail={expiryDetail}
          badge="Expired"
        />
        <AlertPanel
          title="Near Expiry (30 days)"
          icon={CalendarClock}
          tone="orange"
          link={{ to: '/reports', label: 'Full report' }}
          rows={nearExpiryRows}
          total={cards.nearExpiryCount}
          emptyText="Nothing expiring in the next 30 days."
          detail={expiryDetail}
          badge="Near expiry"
        />
      </div>
    </div>
  );
}

function expiryDetail(item) {
  return `${item.quantity} ${item.unit}${item.expiryDate ? ` · ${formatDate(item.expiryDate)}` : ' · batch expiry'}`;
}

const TONES = {
  indigo: { chip: 'from-indigo-500 to-violet-500', soft: 'bg-indigo-50 text-indigo-600', glow: 'bg-indigo-400/15', ring: 'ring-indigo-200' },
  emerald: { chip: 'from-emerald-500 to-teal-500', soft: 'bg-emerald-50 text-emerald-600', glow: 'bg-emerald-400/15', ring: 'ring-emerald-200' },
  sky: { chip: 'from-sky-500 to-cyan-500', soft: 'bg-sky-50 text-sky-600', glow: 'bg-sky-400/15', ring: 'ring-sky-200' },
  rose: { chip: 'from-rose-500 to-pink-500', soft: 'bg-rose-50 text-rose-600', glow: 'bg-rose-400/15', ring: 'ring-rose-200' },
  amber: { chip: 'from-amber-400 to-orange-500', soft: 'bg-amber-50 text-amber-600', glow: 'bg-amber-400/15', ring: 'ring-amber-200' },
  orange: { chip: 'from-orange-500 to-red-500', soft: 'bg-orange-50 text-orange-600', glow: 'bg-orange-400/15', ring: 'ring-orange-200' },
  slate: { chip: 'from-slate-500 to-slate-700', soft: 'bg-slate-100 text-slate-600', glow: 'bg-slate-400/15', ring: 'ring-slate-200' },
};

function KpiCard({ label, value, hint, icon: Icon, tone, to }) {
  const t = TONES[tone];
  const body = (
    <>
      <div className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full ${t.glow} blur-xl`} />
      <div className="relative flex items-start justify-between">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${t.chip} text-white shadow-md`}>
          <Icon className="h-5 w-5" />
        </div>
        {to && <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-500" />}
      </div>
      <p className="relative mt-4 text-sm font-medium text-slate-500">{label}</p>
      <p className="relative mt-1 text-[26px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className="relative mt-1 text-xs text-slate-400">{hint}</p>}
    </>
  );
  const cls =
    'group relative block overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md';
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function HealthTile({ label, value, hint, icon: Icon, tone, alert = false }) {
  const t = TONES[tone];
  return (
    <Link
      to="/inventory"
      className={`flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md ${
        alert ? `border-transparent ring-1 ${t.ring}` : 'border-slate-200/70'
      }`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${alert ? t.soft : 'bg-slate-100 text-slate-500'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500">{label}</p>
        <p className="text-lg font-bold leading-tight tabular-nums text-slate-900">{value}</p>
        <p className="truncate text-[11px] text-slate-400">{hint}</p>
      </div>
    </Link>
  );
}

function Panel({ title, subtitle, icon: Icon, actions, className = '', children }) {
  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="flex-1 px-5 pb-5 pt-2">{children}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: REVENUE_COLOR }} /> Revenue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: PROFIT_COLOR }} /> Profit
      </span>
    </div>
  );
}

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-3.5 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="mb-1.5 font-semibold text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-800">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function TopSellingList({ rows }) {
  if (rows.length === 0) return <EmptyState icon={Trophy} text="No sales yet." />;
  const max = Math.max(...rows.map((r) => r.quantity), 1);
  const medal = ['bg-amber-100 text-amber-700', 'bg-slate-200 text-slate-700', 'bg-orange-100 text-orange-700'];
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.name}>
          <div className="flex items-center gap-3">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${medal[i] || 'bg-slate-100 text-slate-500'}`}>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-600">{r.quantity} sold</p>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(r.quantity / max) * 100}%` }} />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AlertPanel({ title, icon: Icon, tone, link, rows, total, emptyText, detail, badge }) {
  const t = TONES[tone];
  return (
    <div className="flex flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.soft}`}>
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
          {total > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.soft}`}>{total}</span>}
        </div>
        <Link to={link.to} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
          {link.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex-1 px-3 pb-3">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="text-sm text-slate-400">{emptyText}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Pill className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{item.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {item.itemCode} · {detail(item)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.soft}`}>{typeof badge === 'function' ? badge(item) : badge}</span>
              </li>
            ))}
            {total > rows.length && <li className="px-2 pt-1 text-xs text-slate-400">+ {total - rows.length} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}
