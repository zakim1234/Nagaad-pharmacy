import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import {
  RotateCcw,
  ChevronDown,
  CalendarCheck,
  DollarSign,
  TrendingUp,
  HandCoins,
  Wallet,
  Receipt,
  UserRound,
  Clock,
  Landmark,
  Calculator,
  CreditCard,
  LineChart as LineChartIcon,
} from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Textarea } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import TodayClosingPanel from './TodayClosingPanel.jsx';

const SALES_COLOR = '#dc2626';
const NET_COLOR = '#10b981';

function dayLabel(date) {
  return new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function timeLabel(date) {
  return new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function compactCurrency(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n}`;
}

// Daily Closing: one card per business day, rolling together every Close
// Day recorded that day (a day can be closed, reopened and closed again).
// Every figure comes from the saved DayClose snapshots -- what was recorded
// at closing time -- plus that day's posted expenses for the net result.
export default function CloseDayHistoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 30 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [reopenTarget, setReopenTarget] = useState(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopening, setReopening] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/day-close/daily', { params: { page, limit: 30 } })
      .then((res) => {
        setDays(res.data.data);
        setPagination(res.data.pagination);
        if (page === 1 && res.data.data.length > 0) setExpanded((e) => e ?? res.data.data[0].businessDate);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load daily closings.'))
      .finally(() => setLoading(false));
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  const confirmReopen = async () => {
    if (!reopenTarget) return;
    setReopening(true);
    try {
      await client.post(`/day-close/${reopenTarget.id}/reopen`, { reason: reopenReason });
      toast.success('Business day reopened. Account balances have been restored.');
      setReopenTarget(null);
      setReopenReason('');
      setPanelKey((k) => k + 1);
      await load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not reopen this closing.');
    } finally {
      setReopening(false);
    }
  };

  if (loading && days.length === 0) return <PageSpinner />;

  const totals = days.reduce(
    (t, d) => ({
      revenue: t.revenue + d.revenue,
      grossProfit: t.grossProfit + d.grossProfit,
      expenses: t.expenses + d.expenses,
      netProfit: t.netProfit + d.netProfit,
      invoices: t.invoices + d.invoiceCount,
    }),
    { revenue: 0, grossProfit: 0, expenses: 0, netProfit: 0, invoices: 0 }
  );
  const latest = days[0];
  const trend = [...days].reverse().map((d) => ({
    day: new Date(d.businessDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    sales: d.revenue,
    net: d.netProfit,
  }));

  return (
    <div className="space-y-5">
      {/* Hero: the most recent closed day */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-6 text-white shadow-lg shadow-black/20 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-600/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-sm text-white/70">
              <CalendarCheck className="h-4 w-4" /> Daily Closing
            </p>
            <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">
              {latest ? dayLabel(latest.businessDate) : 'No days closed yet'}
            </h1>
            <p className="mt-1 text-sm text-white/70">
              {latest
                ? `Last closed at ${timeLabel(latest.lastClosedAt)}${latest.closes.length > 1 ? ` · ${latest.closes.length} closings this day` : ''}`
                : 'Close the day to see its figures here.'}
            </p>
          </div>

          {latest && (
            <div className="grid shrink-0 grid-cols-3 gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur sm:min-w-[440px]">
              <HeroStat label="Sales" value={formatCurrency(latest.revenue)} hint={`${latest.invoiceCount} invoice(s)`} />
              <HeroStat label="Expenses" value={formatCurrency(latest.expenses)} hint={`${latest.expenseCount} expense(s)`} divider />
              <HeroStat
                label="Net Profit"
                value={formatCurrency(latest.netProfit)}
                hint={latest.revenue > 0 ? `${Math.round((latest.netProfit / latest.revenue) * 100)}% of sales` : '—'}
                divider
              />
            </div>
          )}
        </div>
      </section>

      {/* Today: status, pending invoices, Close Day / Open the Day */}
      <TodayClosingPanel onChanged={load} refreshKey={panelKey} />

      {days.length > 0 && (
        <>
          {/* Period summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard icon={DollarSign} tone="indigo" label="Total Sales" value={formatCurrency(totals.revenue)} hint={`${days.length} day(s) · ${totals.invoices} invoice(s)`} />
            <KpiCard icon={TrendingUp} tone="emerald" label="Gross Profit" value={formatCurrency(totals.grossProfit)} hint="sales minus cost of goods" />
            <KpiCard icon={HandCoins} tone="amber" label="Expenses" value={formatCurrency(totals.expenses)} hint="posted expenses on closed days" />
            <KpiCard
              icon={Wallet}
              tone={totals.netProfit < 0 ? 'rose' : 'teal'}
              label="Net Profit"
              value={formatCurrency(totals.netProfit)}
              hint="gross profit minus expenses"
              valueClass={totals.netProfit < 0 ? 'text-rose-600' : 'text-slate-900'}
            />
          </div>

          {/* Trend -- only meaningful once two or more days are closed */}
          {trend.length >= 2 && (
          <Panel
            title="Sales & Net Profit by Day"
            subtitle={`Last ${days.length} closed day(s)`}
            icon={LineChartIcon}
            actions={
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <LegendDot color={SALES_COLOR} label="Sales" />
                <LegendDot color={NET_COLOR} label="Net Profit" />
              </div>
            }
          >
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gDailySales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SALES_COLOR} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={SALES_COLOR} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gDailyNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={NET_COLOR} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={NET_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#eef2f7" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={compactCurrency} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#fecaca' }} />
                  <Area type="monotone" dataKey="sales" name="Sales" stroke={SALES_COLOR} strokeWidth={2.5} fill="url(#gDailySales)" activeDot={{ r: 5 }} />
                  <Area type="monotone" dataKey="net" name="Net Profit" stroke={NET_COLOR} strokeWidth={2.5} fill="url(#gDailyNet)" activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
          </Panel>
          )}
        </>
      )}

      {/* Day cards */}
      {days.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200/70 bg-white py-16 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
            <CalendarCheck className="h-6 w-6" />
          </div>
          <p className="text-sm text-slate-400">No days have been closed yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <DayCard
              key={d.businessDate}
              day={d}
              open={expanded === d.businessDate}
              onToggle={() => setExpanded(expanded === d.businessDate ? null : d.businessDate)}
              isAdmin={user?.role === 'admin'}
              onReopen={(c) => {
                setReopenTarget(c);
                setReopenReason('');
              }}
            />
          ))}
        </div>
      )}

      <Pagination {...pagination} onChange={setPage} />

      <Modal open={!!reopenTarget} onClose={() => (reopening ? null : setReopenTarget(null))} title="Reopen Business Day" size="sm">
        {reopenTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Reopening this business day will restore account balances to their pre-closing snapshot and reopen POS
              activity for this day. This action will be recorded in the audit log.
            </p>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">Closed {formatDateTime(reopenTarget.closedAt)}</p>
              {reopenTarget.accountBalancesBeforeReset.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {reopenTarget.accountBalancesBeforeReset.map((a) => (
                    <div key={a.account} className="flex justify-between text-xs text-slate-500">
                      <span>{a.accountName}</span>
                      <span>$0.00 &rarr; {formatCurrency(a.balanceBeforeReset)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Optional Reason</label>
              <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. Correcting invoices" maxLength={500} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setReopenTarget(null)} disabled={reopening}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmReopen} loading={reopening}>
                Confirm Reopen
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DayCard({ day, open, onToggle, isAdmin, onReopen }) {
  const date = new Date(day.businessDate);
  const margin = day.revenue > 0 ? Math.max(0, Math.min(100, Math.round((day.netProfit / day.revenue) * 100))) : 0;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm transition ${open ? 'border-brand-200 ring-1 ring-brand-100' : 'border-slate-200/70 hover:shadow-md'}`}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-4 p-4 text-left sm:p-5">
        {/* Date block */}
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-red-700 text-white shadow-md">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">{date.toLocaleDateString(undefined, { month: 'short' })}</span>
          <span className="text-2xl font-bold leading-none">{date.getDate()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900">{date.toLocaleDateString(undefined, { weekday: 'long' })}</p>
          <p className="text-sm text-slate-500">{date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="h-3.5 w-3.5" />
            {day.closes.length > 1 ? `${day.closes.length} closings · ` : ''}last closed {timeLabel(day.lastClosedAt)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${margin}%` }} />
            </div>
            <span className="text-[11px] font-medium text-slate-500">{margin}% net margin</span>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:w-auto lg:flex-[2]">
          <Metric label="Sales" value={formatCurrency(day.revenue)} hint={`${day.invoiceCount} invoice(s)`} strong />
          <Metric label="Gross Profit" value={formatCurrency(day.grossProfit)} />
          <Metric label="Expenses" value={formatCurrency(day.expenses)} valueClass="text-amber-600" />
          <Metric label="Net Profit" value={formatCurrency(day.netProfit)} valueClass={day.netProfit < 0 ? 'text-rose-600' : 'text-emerald-600'} strong />
        </div>

        <span className={`ml-auto inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${open ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}>
          {open ? 'Hide' : 'Details'} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 bg-slate-50/50 p-4 sm:p-5 lg:grid-cols-3">
          {/* Profit breakdown */}
          <DetailCard icon={Calculator} title="How the day added up">
            <div className="space-y-2 text-sm">
              <Line label="Sales" value={formatCurrency(day.revenue)} />
              <Line label="Cost of goods sold" value={`− ${formatCurrency(day.cogs)}`} muted />
              <Line label="Gross profit" value={formatCurrency(day.grossProfit)} bold divider />
              <Line label={`Expenses (${day.expenseCount})`} value={`− ${formatCurrency(day.expenses)}`} muted />
              <Line label="Net profit" value={formatCurrency(day.netProfit)} bold divider valueClass={day.netProfit < 0 ? 'text-rose-600' : 'text-emerald-600'} />
            </div>
          </DetailCard>

          {/* Money */}
          <DetailCard icon={Landmark} title="Where the money went">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat icon={Wallet} label="Cash received" value={formatCurrency(day.cashCollected)} tone="emerald" />
              <MiniStat icon={CreditCard} label="Credit given" value={formatCurrency(day.customerCredit)} tone="rose" />
            </div>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">By account</p>
            {day.paymentBreakdown.length === 0 ? (
              <p className="text-sm text-slate-400">No payments received into accounts.</p>
            ) : (
              <div className="space-y-2.5">
                {day.paymentBreakdown.map((p) => (
                  <div key={p.account}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">{p.accountName}</span>
                      <span className="font-semibold tabular-nums text-slate-800">{formatCurrency(p.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-700"
                        style={{ width: `${day.cashCollected > 0 ? (p.amount / day.cashCollected) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DetailCard>

          {/* Closings timeline */}
          <DetailCard icon={Clock} title={day.closes.length > 1 ? `${day.closes.length} closings this day` : 'Closing'}>
            <ol className="relative ml-1.5 border-l border-slate-200">
              {day.closes.map((c, i) => (
                <li key={c.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute -left-[6px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        {timeLabel(c.closedAt)}
                        {day.closes.length > 1 && <span className="text-xs font-normal text-slate-400">#{i + 1}</span>}
                        {c.reopened && <Badge color="amber">Reopened</Badge>}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-slate-400">
                        <UserRound className="h-3 w-3" /> {c.closedByName}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-slate-800">{formatCurrency(c.revenue)}</span>
                  </div>

                  {c.invoiceReferences.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.invoiceReferences.map((ref) => (
                        <span key={ref} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          <Receipt className="h-3 w-3 text-slate-400" /> {ref}
                        </span>
                      ))}
                    </div>
                  )}

                  {c.cashierBreakdown.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      {c.cashierBreakdown.map((cb) => (
                        <p key={cb.user || cb.userName} className="flex justify-between text-xs text-slate-500">
                          <span>{cb.userName}</span>
                          <span className="tabular-nums">{formatCurrency(cb.total)}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {c.reopened && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                      Reopened {formatDateTime(c.reopenedAt)} by {c.reopenedByName}
                      {c.reopenReason ? ` — ${c.reopenReason}` : ''}
                    </p>
                  )}

                  {isAdmin && c.canReopen && (
                    <Button variant="secondary" size="sm" className="mt-2" onClick={() => onReopen(c)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </DetailCard>
        </div>
      )}
    </div>
  );
}

const TONES = {
  indigo: { chip: 'from-red-500 to-red-700', glow: 'bg-brand-400/15', soft: 'bg-brand-50 text-brand-600' },
  emerald: { chip: 'from-neutral-700 to-neutral-950', glow: 'bg-neutral-400/15', soft: 'bg-emerald-50 text-emerald-600' },
  teal: { chip: 'from-neutral-700 to-neutral-950', glow: 'bg-neutral-400/15', soft: 'bg-teal-50 text-teal-600' },
  amber: { chip: 'from-neutral-400 to-neutral-600', glow: 'bg-neutral-300/20', soft: 'bg-amber-50 text-amber-600' },
  rose: { chip: 'from-red-500 to-red-700', glow: 'bg-rose-400/15', soft: 'bg-rose-50 text-rose-600' },
};

function KpiCard({ icon: Icon, tone, label, value, hint, valueClass = 'text-slate-900' }) {
  const t = TONES[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full ${t.glow} blur-xl`} />
      <div className={`relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${t.chip} text-white shadow-md`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="relative mt-4 text-sm font-medium text-slate-500">{label}</p>
      <p className={`relative mt-1 text-[26px] font-bold leading-tight tracking-tight tabular-nums ${valueClass}`}>{value}</p>
      {hint && <p className="relative mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function HeroStat({ label, value, hint, divider = false }) {
  return (
    <div className={divider ? 'border-l border-white/20 pl-3' : ''}>
      <p className="text-xs font-medium uppercase tracking-wider text-white/70">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs text-white/70">{hint}</p>
    </div>
  );
}

function Panel({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="px-5 pb-5 pt-2">{children}</div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
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

function Metric({ label, value, hint, valueClass = 'text-slate-800', strong = false }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-base font-bold' : 'text-sm font-semibold'} ${valueClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function DetailCard({ icon: Icon, title, children }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

function Line({ label, value, muted = false, bold = false, divider = false, valueClass = '' }) {
  return (
    <div className={`flex justify-between ${divider ? 'border-t border-dashed border-slate-200 pt-2' : ''}`}>
      <span className={muted ? 'text-slate-400' : bold ? 'font-semibold text-slate-700' : 'text-slate-600'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : ''} ${muted ? 'text-slate-400' : 'text-slate-800'} ${valueClass}`}>{value}</span>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${TONES[tone].soft}`}>
      <p className="flex items-center gap-1 text-[11px] font-medium opacity-80">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}
