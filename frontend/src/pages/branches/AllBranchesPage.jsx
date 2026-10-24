import { useEffect, useState } from 'react';
import { Globe2, Printer, AlertTriangle, ArrowRight } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import client, { setSelectedBranch } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import PrintReportHeader, { formatRangeLabel } from '../../components/reports/PrintReportHeader.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import { DonutChart, ChartTooltip, axisProps, gridProps, compactMoney, PALETTE } from '../../components/reports/chartKit.jsx';

const CARDS = [
  ['sales', 'Total sales'],
  ['purchases', 'Total purchases'],
  ['profit', 'Total profit'],
  ['stockValue', 'Total stock value'],
  ['customerDebt', 'Customer debt'],
  ['supplierDebt', 'Supplier debt'],
];

// Super Admin: every branch at once -- totals, each branch's row, charts and
// stock alerts. A branch row opens that branch (switches to it).
export default function AllBranchesPage() {
  const toast = useToast();
  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .get('/branches/dashboard', { params: from || to ? { from: from || undefined, to: to || undefined } : { range } })
      .then((res) => setData(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the branches dashboard.'))
      .finally(() => setLoading(false));
  }, [range, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const openBranch = (id) => {
    setSelectedBranch(String(id));
    window.location.href = '/dashboard';
  };

  if (!data) return <PageSpinner />;
  const rangeLabel = formatRangeLabel(data.range);
  const alerts = data.branches.filter((b) => b.alerts.lowStock + b.alerts.outOfStock + b.alerts.expired + b.alerts.nearExpiry > 0);

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-6 text-white shadow-lg shadow-black/20 no-print">
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-600/25 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
              <Globe2 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">All Branches</h1>
              <p className="text-sm text-white/70">
                {data.branches.length} branch{data.branches.length === 1 ? '' : 'es'} · {rangeLabel}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <SharePdfButton fileName={`All-Branches_${new Date().toISOString().slice(0, 10)}`} message={`All branches — ${rangeLabel}`} orientation="landscape" className="bg-white!" />
            <button onClick={() => printReport('landscape')} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-sm hover:bg-brand-50">
              <Printer className="h-4 w-4" /> Print
            </button>
          </div>
        </div>
      </section>

      <div className="no-print">
        <DateRangeFilter
          range={range}
          onRangeChange={(v) => {
            setRange(v);
            setFrom('');
            setTo('');
          }}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />
      </div>

      <div id="print-area" className={`space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none ${loading ? 'opacity-60' : ''}`}>
        <PrintReportHeader showOnScreen title="All Branches" rangeLabel={rangeLabel} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {CARDS.map(([key, label], i) => (
            <div
              key={key}
              className={`rounded-xl px-4 py-3 ${i === 2 ? 'bg-brand-600 text-white' : i === 3 ? 'bg-neutral-950 text-white' : 'border border-neutral-200 bg-white'}`}
              style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
            >
              <p className={`text-[11px] uppercase tracking-wider ${i === 2 || i === 3 ? 'text-white/70' : 'text-neutral-500'}`}>{label}</p>
              <p className="mt-1 text-2xl font-bold figure">{formatCurrency(data.totals[key])}</p>
              <p className={`text-[11px] ${i === 2 || i === 3 ? 'text-white/60' : 'text-neutral-400'}`}>All branches</p>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Branch performance</p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-neutral-900 text-left text-[10px] uppercase tracking-wider text-neutral-500">
                  <th className="px-2 py-2">Branch</th>
                  <th className="px-2 py-2 text-right">Sales</th>
                  <th className="px-2 py-2 text-right">Purchases</th>
                  <th className="px-2 py-2 text-right">Profit</th>
                  <th className="px-2 py-2 text-right">Stock value</th>
                  <th className="px-2 py-2 text-right">Customer debt</th>
                  <th className="px-2 py-2 text-right">Supplier debt</th>
                  <th className="px-2 py-2 no-print" />
                </tr>
              </thead>
              <tbody>
                {data.branches.map((b, i) => (
                  <tr key={b.branchId} onClick={() => openBranch(b.branchId)} className={`cursor-pointer border-b border-neutral-200 hover:bg-brand-50/50 ${i % 2 ? 'bg-neutral-50' : ''}`}>
                    <td className="px-2 py-2.5 font-semibold">
                      {b.name}
                      {!b.active && <span className="ml-2 text-[10px] font-semibold text-neutral-400">(closed)</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(b.sales)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(b.purchases)}</td>
                    <td className={`px-2 py-2.5 text-right font-semibold tabular-nums ${b.profit < 0 ? 'text-brand-600' : ''}`}>{formatCurrency(b.profit)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(b.stockValue)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(b.customerDebt)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(b.supplierDebt)}</td>
                    <td className="px-2 py-2.5 text-right no-print">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-600">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-900 font-bold">
                  <td className="px-2 py-2.5 uppercase tracking-wider">Total</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.sales)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.purchases)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-brand-700">{formatCurrency(data.totals.profit)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.stockValue)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.customerDebt)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.supplierDebt)}</td>
                  <td className="no-print" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-900">Sales by branch</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.branches} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="sales" name="Sales" fill={PALETTE[0]} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="purchases" name="Purchases" fill={PALETTE[5]} radius={[6, 6, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-900">Profit by branch</p>
            {data.branches.some((b) => b.profit > 0) ? (
              <DonutChart data={data.branches.filter((b) => b.profit > 0)} valueKey="profit" nameKey="name" centerLabel="Profit" />
            ) : (
              <p className="py-16 text-center text-sm text-neutral-400">No profit in this period yet.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">
            <AlertTriangle className="h-3.5 w-3.5 text-brand-600" /> Alerts (all branches)
          </p>
          {alerts.length === 0 ? (
            <p className="rounded-lg bg-neutral-50 px-3 py-3 text-sm text-neutral-500">No stock alerts in any branch.</p>
          ) : (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
              {alerts.map((b) => (
                <li key={b.branchId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="font-semibold">{b.name}</span>
                  <span className="flex flex-wrap gap-2 text-xs">
                    {b.alerts.lowStock > 0 && <AlertChip tone="amber">{b.alerts.lowStock} low stock</AlertChip>}
                    {b.alerts.outOfStock > 0 && <AlertChip tone="red">{b.alerts.outOfStock} out of stock</AlertChip>}
                    {b.alerts.expired > 0 && <AlertChip tone="red">{b.alerts.expired} expired</AlertChip>}
                    {b.alerts.nearExpiry > 0 && <AlertChip tone="amber">{b.alerts.nearExpiry} near expiry</AlertChip>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="no-print text-xs text-neutral-400">Click a branch row to open that branch (Stock, Seller, Accounts, Reports switch to it).</div>
    </div>
  );
}

function AlertChip({ tone, children }) {
  const cls = tone === 'red' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700';
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{children}</span>;
}
