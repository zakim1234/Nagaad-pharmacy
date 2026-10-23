import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import {
  Boxes,
  AlertTriangle,
  PackageX,
  CalendarClock,
  ArrowRight,
  ArrowUpRight,
  ShoppingCart,
  PackagePlus,
  BarChart3,
  CheckCircle2,
  LineChart as LineChartIcon,
  Pill,
} from 'lucide-react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { stockStatusBadge } from '../components/ui/Badge.jsx';
import { PageSpinner } from '../components/ui/Spinner.jsx';

// House colours: sales in black, profit in red.
const REVENUE_COLOR = '#171717';
const PROFIT_COLOR = '#dc2626';
const DISPLAY = { fontFamily: 'var(--font-display)' };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Compact axis labels ($1.2k, $3.4M) so long figures never crowd the chart.
function compactCurrency(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

// A branch's home: today, this month, stock health, the last 14 days and
// what needs attention -- in the white / black / red house style.
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
  const monthMargin = thisMonth.revenue > 0 ? Math.round((thisMonth.profit / thisMonth.revenue) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Greeting + actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-neutral-950" style={DISPLAY}>
            {greeting()}
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
          </h1>
          <p className="mt-1 text-sm text-neutral-500">Here's how the branch is doing today.</p>
        </div>
        {quickActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quickActions.map(({ to, label, icon: Icon, primary }) => (
              <Link
                key={to}
                to={to}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                  primary ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300'
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Today + this month */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="relative overflow-hidden rounded-3xl bg-neutral-950 p-6 text-white xl:col-span-2 sm:p-7">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" />
          <div className="relative grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-end">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Today</p>
              <p className="figure mt-2 text-5xl font-extrabold sm:text-6xl">{formatCurrency(cards.todaySales)}</p>
              <p className="mt-1 text-sm text-neutral-400">
                {cards.todaySalesCount} sale{cards.todaySalesCount === 1 ? '' : 's'}
              </p>
              <div className="mt-6 grid grid-cols-3 gap-4 border-t border-white/10 pt-4">
                <HeroFigure label="Profit" value={formatCurrency(cards.todayProfit)} />
                <HeroFigure label="Margin" value={margin === null ? '—' : `${margin}%`} />
                <HeroFigure label="Customers owe" value={formatCurrency(cards.customerDebt)} />
              </div>
            </div>
            <div className="h-40">
              <p className="mb-1 text-right text-[10.5px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Last 14 days</p>
              <ResponsiveContainer width="100%" height="90%">
                <AreaChart data={charts.dailySales} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="branchHero" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip content={<MoneyTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
                  <Area type="monotone" dataKey="revenue" name="Sales" stroke="#ef4444" strokeWidth={2.5} fill="url(#branchHero)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <div className="grid gap-4">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-6">
            <p className="eyebrow">This month</p>
            <p className="figure mt-2 text-[34px] font-extrabold text-neutral-950">{formatCurrency(thisMonth.revenue)}</p>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-neutral-500">Gross profit</span>
              <span className="figure font-bold text-neutral-900">{formatCurrency(thisMonth.profit)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, monthMargin))}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-neutral-400">{monthMargin}% margin</p>
          </section>
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-neutral-200/80 bg-neutral-200/80">
            <SmallFigure label="Last 14 days" value={formatCurrency(last14Revenue)} hint={`${formatCurrency(last14Profit)} profit`} />
            <SmallFigure label="Stock at cost" value={formatCurrency(cards.stockValue)} hint={`${cards.totalStockQuantity} units`} to="/inventory" />
          </section>
        </div>
      </div>

      {/* Stock health */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-neutral-200/80 bg-neutral-200/80 lg:grid-cols-4">
        <HealthTile label="Items" value={cards.totalInventoryItems} hint={`${cards.totalStockQuantity} units in stock`} icon={Boxes} />
        <HealthTile label="Low stock" value={cards.lowStockCount} hint="below minimum" icon={AlertTriangle} alert={cards.lowStockCount > 0} />
        <HealthTile label="Out of stock" value={cards.outOfStockCount} hint="need reorder" icon={PackageX} alert={cards.outOfStockCount > 0} />
        <HealthTile
          label="Near expiry / expired"
          value={`${cards.nearExpiryCount} / ${cards.expiredCount}`}
          hint="next 30 days / past date"
          icon={CalendarClock}
          alert={cards.nearExpiryCount + cards.expiredCount > 0}
        />
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" eyebrow="Last 14 days" title="Sales & profit" actions={<Legend />}>
          {charts.dailySales.length === 0 ? (
            <EmptyState icon={LineChartIcon} text="No sales in the last 14 days yet." />
          ) : (
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={charts.dailySales} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={REVENUE_COLOR} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={REVENUE_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PROFIT_COLOR} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={PROFIT_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#a3a3a3' }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a3a3a3' }} tickFormatter={compactCurrency} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#e5e5e5', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="revenue" name="Sales" stroke={REVENUE_COLOR} strokeWidth={2.5} fill="url(#gRevenue)" activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="profit" name="Profit" stroke={PROFIT_COLOR} strokeWidth={2.5} fill="url(#gProfit)" activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel eyebrow="Last 14 days" title="Best sellers">
          <TopSellingList rows={charts.topSelling} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" eyebrow="By month" title="Monthly trend" actions={<Legend />}>
          {charts.monthlySales.length === 0 ? (
            <EmptyState icon={BarChart3} text="Monthly figures will appear after your first sale." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={charts.monthlySales} barGap={4} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a3a3a3' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a3a3a3' }} tickFormatter={compactCurrency} axisLine={false} tickLine={false} width={56} />
                <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#fafafa' }} />
                <Bar dataKey="revenue" name="Sales" fill={REVENUE_COLOR} radius={[6, 6, 0, 0]} maxBarSize={26} />
                <Bar dataKey="profit" name="Profit" fill={PROFIT_COLOR} radius={[6, 6, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <AlertPanel
          title="Low stock"
          icon={AlertTriangle}
          link={{ to: '/inventory', label: 'View all' }}
          rows={lowStockRows}
          total={cards.lowStockCount}
          emptyText="Nothing low on stock right now."
          detail={(item) => `${item.quantity} ${item.unit} left · min ${item.lowStockThreshold}`}
          badge={(item) => stockStatusBadge(item.stockStatus).label}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AlertPanel
          title="Expired medicine"
          icon={PackageX}
          link={{ to: '/reports', label: 'Full report' }}
          rows={expiredRows}
          total={cards.expiredCount}
          emptyText="No expired items."
          detail={expiryDetail}
          badge="Expired"
          tone="red"
        />
        <AlertPanel
          title="Near expiry (30 days)"
          icon={CalendarClock}
          link={{ to: '/reports', label: 'Full report' }}
          rows={nearExpiryRows}
          total={cards.nearExpiryCount}
          emptyText="Nothing expiring in the next 30 days."
          detail={expiryDetail}
          badge="Near expiry"
          tone="amber"
        />
      </div>
    </div>
  );
}

function expiryDetail(item) {
  return `${item.quantity} ${item.unit}${item.expiryDate ? ` · ${formatDate(item.expiryDate)}` : ' · batch expiry'}`;
}

function HeroFigure({ label, value }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-500">{label}</p>
      <p className="figure mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function SmallFigure({ label, value, hint, to }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="figure mt-1.5 text-xl font-extrabold text-neutral-950">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="bg-white p-5 transition-colors hover:bg-neutral-50">
      {body}
    </Link>
  ) : (
    <div className="bg-white p-5">{body}</div>
  );
}

function HealthTile({ label, value, hint, icon: Icon, alert = false }) {
  return (
    <Link to="/inventory" className="group flex items-center gap-4 bg-white p-5 transition-colors hover:bg-neutral-50">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${alert ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-500'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="eyebrow block truncate">{label}</span>
        <span className={`figure block text-2xl font-extrabold leading-tight ${alert ? 'text-brand-700' : 'text-neutral-950'}`}>{value}</span>
        <span className="block truncate text-[11px] text-neutral-400">{hint}</span>
      </span>
    </Link>
  );
}

function Panel({ eyebrow, title, actions, className = '', children }) {
  return (
    <section className={`flex flex-col rounded-3xl border border-neutral-200/80 bg-white ${className}`}>
      <div className="flex items-end justify-between gap-3 px-6 pb-2 pt-5">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 className="mt-0.5 text-lg font-bold text-neutral-950" style={DISPLAY}>
            {title}
          </h2>
        </div>
        {actions}
      </div>
      <div className="flex-1 px-6 pb-6 pt-2">{children}</div>
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: REVENUE_COLOR }} /> Sales
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PROFIT_COLOR }} /> Profit
      </span>
    </div>
  );
}

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-neutral-100 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-neutral-700">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} /> {p.name}
          </span>
          <span className="font-semibold tabular-nums text-neutral-900">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function TopSellingList({ rows }) {
  if (rows.length === 0) return <EmptyState icon={BarChart3} text="No sales yet." />;
  const max = Math.max(...rows.map((r) => r.quantity), 1);
  return (
    <ul className="space-y-4">
      {rows.map((r, i) => (
        <li key={r.name} className="flex items-center gap-3">
          <span className={`figure flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${i === 0 ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}>
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold text-neutral-900">{r.name}</p>
              <p className="figure shrink-0 text-xs font-semibold text-neutral-500">{r.quantity} sold</p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div className={`h-full rounded-full ${i === 0 ? 'bg-brand-600' : 'bg-neutral-900'}`} style={{ width: `${(r.quantity / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const BADGE = {
  red: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-700',
  neutral: 'bg-neutral-100 text-neutral-700',
};

function AlertPanel({ title, icon: Icon, link, rows, total, emptyText, detail, badge, tone = 'neutral' }) {
  return (
    <section className="flex flex-col rounded-3xl border border-neutral-200/80 bg-white">
      <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5">
        <div className="flex items-center gap-2.5">
          <Icon className="h-4 w-4 text-neutral-400" />
          <h2 className="text-lg font-bold text-neutral-950" style={DISPLAY}>
            {title}
          </h2>
          {total > 0 && <span className={`figure rounded-full px-2 py-0.5 text-xs font-bold ${BADGE[tone]}`}>{total}</span>}
        </div>
        <Link to={link.to} className="flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-950">
          {link.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex-1 px-3 pb-3">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-neutral-300" />
            <p className="text-sm text-neutral-400">{emptyText}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-neutral-50">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
                  <Pill className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutral-900">{item.name}</p>
                  <p className="truncate text-xs text-neutral-400">
                    {item.itemCode} · {detail(item)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${BADGE[tone]}`}>{typeof badge === 'function' ? badge(item) : badge}</span>
              </li>
            ))}
            {total > rows.length && (
              <li className="flex items-center gap-1 px-3 pt-1 text-xs text-neutral-400">
                <ArrowUpRight className="h-3 w-3" /> {total - rows.length} more
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
      <Icon className="h-8 w-8 text-neutral-300" />
      <p className="text-sm text-neutral-400">{text}</p>
    </div>
  );
}
