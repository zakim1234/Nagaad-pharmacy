import { useEffect, useState, useCallback } from 'react';
import QuotationsPage from '../quotations/QuotationsPage.jsx';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Printer,
  BarChart3,
  TrendingUp,
  Boxes,
  UserRound,
  Scale,
  Landmark,
  HandCoins,
  CreditCard,
  CalendarX,
  AlertTriangle,
  Undo2,
  PackageX,
  FileText,
  Receipt,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  Trophy,
  Layers,
  ShieldCheck,
  CalendarRange,
} from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ReportSection from '../../components/reports/ReportSection.jsx';
import ReportStatRow from '../../components/reports/ReportStatRow.jsx';
import EmptyReportState from '../../components/reports/EmptyReportState.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import PrintReportHeader, { formatRangeLabel } from '../../components/reports/PrintReportHeader.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import PrintReportFooter from '../../components/reports/PrintReportFooter.jsx';
import { COLORS, axisProps, gridProps, compactMoney, gradient, ChartTooltip, LegendDots, DonutChart } from '../../components/reports/chartKit.jsx';
import ProfitDrilldownModal from './ProfitDrilldownModal.jsx';
import ProfitLossReport from './ProfitLossReport.jsx';
import BalanceSheetReport from './BalanceSheetReport.jsx';
import {
  ExpenseReport,
  PaymentMethodReport,
  ExpiredProductsControls,
  ExpiredProductsReport,
  LowStockReport,
  SalesReturnReport,
  PurchaseReturnReport,
} from './FinancialReports.jsx';

const TABS = [
  { key: 'sales', label: 'Sales', title: 'Sales Report', orientation: 'portrait', icon: BarChart3, hint: 'Revenue, transactions and how customers paid' },
  { key: 'profit', label: 'Profit', title: 'Profit Report', orientation: 'portrait', icon: TrendingUp, hint: 'Gross profit and margin by item and category' },
  { key: 'payment-methods', label: 'Payment Methods', title: 'Payment Method Report', orientation: 'portrait', icon: CreditCard, hint: 'Money received per account' },
  { key: 'sales-returns', label: 'Sales Returns', title: 'Sales Return Report', orientation: 'landscape', icon: Undo2, hint: 'Items customers brought back' },
  { key: 'performance', label: 'User Performance', title: 'User Performance Report', orientation: 'portrait', icon: UserRound, hint: 'What one cashier sold and collected' },
  { key: 'quotations', label: 'Quotation', title: 'Quotation Report', orientation: 'landscape', icon: FileText, hint: 'Quotations issued and converted' },
  { key: 'pnl', label: 'Profit & Loss', title: 'Profit & Loss Report', orientation: 'portrait', icon: Scale, hint: 'Income, costs, expenses and net income' },
  { key: 'balance-sheet', label: 'Balance Sheet', title: 'Balance Sheet', orientation: 'portrait', icon: Landmark, hint: 'Assets, liabilities and equity on a date' },
  { key: 'expenses', label: 'Expenses', title: 'Expense Report', orientation: 'portrait', icon: HandCoins, hint: 'Spending by category and day' },
  { key: 'inventory', label: 'Inventory', title: 'Inventory Report', orientation: 'landscape', icon: Boxes, hint: 'Stock value, health and expiry right now' },
  { key: 'low-stock', label: 'Low Stock', title: 'Low Stock Report', orientation: 'landscape', icon: AlertTriangle, hint: 'Items at or below their minimum' },
  { key: 'expired', label: 'Expired Products', title: 'Expired Products Report', orientation: 'landscape', icon: CalendarX, hint: 'Expired and soon-to-expire batches' },
  { key: 'purchase-returns', label: 'Purchase Returns', title: 'Purchase Return Report', orientation: 'landscape', icon: PackageX, hint: 'Stock sent back to suppliers' },
];

const GROUPS = [
  { label: 'Sales', keys: ['sales', 'profit', 'payment-methods', 'sales-returns', 'performance', 'quotations'] },
  { label: 'Finance', keys: ['pnl', 'balance-sheet', 'expenses'] },
  { label: 'Inventory', keys: ['inventory', 'low-stock', 'expired', 'purchase-returns'] },
];

// Reports that describe the current state of stock rather than a date range.
const NO_DATE_TABS = ['inventory', 'expired', 'low-stock'];
// Tab key -> API path, where they differ.
const ENDPOINTS = { performance: 'user-performance', expired: 'expired-products' };

export default function ReportsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drilldownItem, setDrilldownItem] = useState(null);
  const [performanceUserId, setPerformanceUserId] = useState('');
  const [expiredMode, setExpiredMode] = useState('expired');
  const [nearDays, setNearDays] = useState(30);

  const rangeParams = from || to ? { from: from || undefined, to: to || undefined } : { range };
  const activeTab = TABS.find((t) => t.key === tab);

  const load = useCallback(() => {
    if (tab === 'quotations') return;
    if (tab === 'pnl' || tab === 'balance-sheet') return; // these reports own their filters and loading
    if (tab === 'performance' && !performanceUserId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params =
      tab === 'inventory' || tab === 'low-stock'
        ? {}
        : tab === 'expired'
        ? { mode: expiredMode, days: nearDays }
        : tab === 'performance'
        ? { ...rangeParams, userId: performanceUserId }
        : rangeParams;
    client
      .get(`/reports/${ENDPOINTS[tab] || tab}`, { params })
      .then((res) => setData({ ...res.data.data, __tab: tab }))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [tab, range, from, to, performanceUserId, expiredMode, nearDays]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const ready = data && data.__tab === tab && !loading;
  const ownsLayout = tab === 'pnl' || tab === 'balance-sheet' || tab === 'quotations';
  const showDateFilters = !NO_DATE_TABS.includes(tab) && !ownsLayout;
  const rangeLabel = NO_DATE_TABS.includes(tab) ? 'As of today' : formatRangeLabel(data?.range);
  const ActiveIcon = activeTab.icon;

  return (
    <div className="space-y-5">
      {/* Hero: which report is open, for which period */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-6 text-white shadow-lg shadow-black/20 no-print">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-600/25 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <ActiveIcon className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm text-white/70">Reports</p>
              <h1 className="text-2xl font-bold leading-tight">{activeTab.title}</h1>
              <p className="mt-0.5 text-sm text-white/70">{activeTab.hint}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!ownsLayout && rangeLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm ring-1 ring-white/25 backdrop-blur">
                <CalendarRange className="h-4 w-4" /> {rangeLabel}
              </span>
            )}
            {!ownsLayout && (
              <button
                onClick={() => printReport(activeTab.orientation)}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-sm transition hover:bg-brand-50"
              >
                <Printer className="h-4 w-4" /> Print Report
              </button>
            )}
            {!ownsLayout && (
              <SharePdfButton
                fileName={`${activeTab.title.replace(/\s+/g, '-')}_${new Date().toISOString().slice(0, 10)}`}
                message={`${activeTab.title} — ${rangeLabel}`}
                orientation={activeTab.orientation}
                className="bg-white!"
              />
            )}
          </div>
        </div>
      </section>

      {/* Report picker, grouped */}
      <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm lg:grid-cols-[2fr_1.1fr_1.5fr] no-print">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.keys.map((key) => {
                const t = TABS.find((x) => x.key === key);
                const Icon = t.icon;
                const active = tab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                        : 'border-slate-200 text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {tab === 'quotations' ? (
        <QuotationsPage report />
      ) : (
        <div>
          {tab === 'performance' && <UserPerformancePicker userId={performanceUserId} onUserChange={setPerformanceUserId} />}

          {tab === 'expired' && (
            <ExpiredProductsControls mode={expiredMode} onModeChange={setExpiredMode} days={nearDays} onDaysChange={setNearDays} />
          )}

          {showDateFilters && (
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
          )}

          <div
            id={ownsLayout ? undefined : 'print-area'}
            className={
              ownsLayout
                ? ''
                : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none'
            }
          >
            {!ownsLayout && <PrintReportHeader showOnScreen title={activeTab.title} rangeLabel={rangeLabel} />}

            {tab === 'pnl' ? (
              <ProfitLossReport />
            ) : tab === 'balance-sheet' ? (
              <BalanceSheetReport />
            ) : tab === 'performance' && !performanceUserId ? (
              <ReportSection>
                <EmptyReportState message="Select a user above to view their performance report." />
              </ReportSection>
            ) : !ready ? (
              <PageSpinner />
            ) : (
              <>
                {tab === 'sales' && <SalesReport data={data} rangeParams={rangeParams} />}
                {tab === 'profit' && <ProfitReport data={data} onDrilldown={(itemId, name) => setDrilldownItem({ id: itemId, name })} />}
                {tab === 'inventory' && <InventoryReport data={data} />}
                {tab === 'performance' && <UserPerformanceReport data={data} />}
                {tab === 'expenses' && <ExpenseReport data={data} />}
                {tab === 'payment-methods' && <PaymentMethodReport data={data} />}
                {tab === 'expired' && <ExpiredProductsReport data={data} />}
                {tab === 'low-stock' && <LowStockReport data={data} />}
                {tab === 'sales-returns' && <SalesReturnReport data={data} />}
                {tab === 'purchase-returns' && <PurchaseReturnReport data={data} />}
              </>
            )}

            {ready && <PrintReportFooter />}
          </div>
        </div>
      )}

      <ProfitDrilldownModal
        itemId={drilldownItem?.id}
        itemName={drilldownItem?.name}
        rangeParams={rangeParams}
        onClose={() => setDrilldownItem(null)}
      />
    </div>
  );
}

function paymentStatusBadge(outstanding) {
  return outstanding > 0 ? { color: 'amber', label: 'Credit' } : { color: 'green', label: 'Paid' };
}

const dayTick = (d) => String(d).slice(5);

// A ranked list with proportional bars -- reads faster than a horizontal
// bar chart for "top N" lists, and prints cleanly.
function RankedBars({ rows, valueKey, nameKey = 'name', money = false, color = 'from-red-500 to-red-700', suffix = '' }) {
  const max = Math.max(...rows.map((r) => Math.abs(r[valueKey]) || 0), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={`${r[nameKey]}-${i}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-5 shrink-0 text-xs font-semibold text-slate-400">{i + 1}</span>
              <span className="truncate font-medium text-slate-700">{r[nameKey]}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800">
              {money ? formatCurrency(r[valueKey]) : r[valueKey]}
              {suffix}
            </span>
          </div>
          <div className="ml-7 mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${(Math.abs(r[valueKey]) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SalesReport({ data, rangeParams }) {
  const toast = useToast();
  const [sales, setSales] = useState(null);

  useEffect(() => {
    setSales(null);
    client
      .get('/sales', { params: { ...rangeParams, status: 'CONFIRMED', limit: 300 } })
      .then((res) => setSales(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load sales.'));
  }, [rangeParams.range, rangeParams.from, rangeParams.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const noSales = data.byDay.length === 0;

  return (
    <div className="space-y-5">
      <ReportSection title="Sales Overview" icon={BarChart3}>
        <ReportStatRow
          items={[
            { label: 'Total Sales', value: formatCurrency(data.totalSales), tone: 'text-neutral-900' },
            { label: 'Cash Collected', value: formatCurrency(data.cashCollected), tone: 'text-emerald-600' },
            { label: 'Credit Sales', value: formatCurrency(data.creditSales), tone: 'text-amber-600' },
            { label: 'Outstanding Receivables', value: formatCurrency(data.outstandingReceivables), tone: 'text-rose-600' },
            { label: 'Number of Sales', value: data.numberOfSales },
            { label: 'Items Sold', value: data.itemsSold },
            { label: 'Average Sale Value', value: formatCurrency(data.averageSaleValue) },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ReportSection title="Revenue Over Time" icon={LineChartIcon} className="chart-container lg:col-span-2">
          {noSales ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data.byDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>{gradient('gSalesRev', COLORS.revenue)}</defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={dayTick} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#fecaca' }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.revenue} strokeWidth={2.5} fill="url(#gSalesRev)" activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Cash vs Credit" icon={PieChartIcon} className="chart-container">
          {data.cashVsCredit.cash + data.cashVsCredit.credit === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <DonutChart
              data={[
                { name: 'Cash', value: data.cashVsCredit.cash, color: COLORS.profit },
                { name: 'Credit', value: data.cashVsCredit.credit, color: COLORS.cost },
              ]}
              valueKey="value"
              nameKey="name"
              centerLabel="Sales"
              height={180}
            />
          )}
        </ReportSection>

        <ReportSection title="Transactions per Day" icon={Receipt} className="chart-container">
          {noSales ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={dayTick} />
                <YAxis {...axisProps} allowDecimals={false} width={40} />
                <Tooltip content={<ChartTooltip money={false} />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="count" name="Transactions" fill={COLORS.count} radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Revenue by Payment Account" icon={CreditCard} className="chart-container">
          {!data.paymentByAccount || data.paymentByAccount.length === 0 ? (
            <EmptyReportState message="No account payments found for this date range." />
          ) : (
            <DonutChart data={data.paymentByAccount} valueKey="amount" nameKey="account" centerLabel="Received" height={180} />
          )}
        </ReportSection>

        <ReportSection title="Top Items by Quantity" icon={Trophy} className="chart-container">
          {data.topByQuantity.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <RankedBars rows={data.topByQuantity} valueKey="quantity" suffix=" sold" />
          )}
        </ReportSection>
      </div>

      <ReportSection title="Transactions" subtitle={sales ? `${sales.length} confirmed sale(s)` : 'Loading…'} icon={Receipt}>
        <Table>
          <THead>
            <tr>
              <Th>Invoice No</Th>
              <Th>Date</Th>
              <Th>Time</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th>Total</Th>
              <Th>Paid</Th>
              <Th>Balance</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <TBody>
            {sales === null ? (
              <TableLoading colSpan={9} />
            ) : sales.length === 0 ? (
              <TableEmpty colSpan={9} message="No sales found for this date range." />
            ) : (
              sales.map((s) => {
                const status = paymentStatusBadge(s.outstanding);
                return (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <Td className="font-medium text-slate-900">
                      <Link to={`/receipt/${s.id}`} className="text-brand-600 hover:underline no-print">
                        {s.receiptNumber}
                      </Link>
                      <span className="hidden print:inline">{s.receiptNumber}</span>
                    </Td>
                    <Td>{formatDate(s.createdAt)}</Td>
                    <Td>{new Date(s.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Td>
                    <Td>{s.customerName}</Td>
                    <Td>{s.items.length}</Td>
                    <Td className="font-semibold tabular-nums">{formatCurrency(s.total)}</Td>
                    <Td className="tabular-nums">{formatCurrency(s.paidAmount)}</Td>
                    <Td className={`tabular-nums ${s.outstanding > 0 ? 'font-semibold text-rose-600' : ''}`}>{formatCurrency(s.outstanding)}</Td>
                    <Td>
                      <Badge color={status.color}>{status.label}</Badge>
                    </Td>
                  </tr>
                );
              })
            )}
          </TBody>
        </Table>
      </ReportSection>
    </div>
  );
}

function ProfitReport({ data, onDrilldown }) {
  return (
    <div className="space-y-5">
      <ReportSection title="Profit Overview" icon={TrendingUp}>
        <ReportStatRow
          items={[
            { label: 'Revenue', value: formatCurrency(data.revenue), tone: 'text-neutral-900' },
            { label: 'Cost of Goods Sold', value: formatCurrency(data.costOfGoodsSold), tone: 'text-amber-600' },
            { label: 'Gross Profit', value: formatCurrency(data.grossProfit), tone: 'text-emerald-600' },
            { label: 'Gross Margin', value: `${data.grossMarginPct}%`, tone: 'text-emerald-600' },
            { label: 'Units Sold', value: data.unitsSold },
          ]}
        />
      </ReportSection>

      <ReportSection
        title="Revenue, Cost and Profit Over Time"
        icon={LineChartIcon}
        className="chart-container"
        actions={
          <LegendDots
            items={[
              { label: 'Revenue', color: COLORS.revenue },
              { label: 'COGS', color: COLORS.cost },
              { label: 'Profit', color: COLORS.profit },
            ]}
          />
        }
      >
        {data.byDay.length === 0 ? (
          <EmptyReportState message="No sales found for this date range." />
        ) : (
          <ResponsiveContainer width="100%" height={270}>
            <AreaChart data={data.byDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <defs>
                {gradient('gProfRev', COLORS.revenue)}
                {gradient('gProfProfit', COLORS.profit)}
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={dayTick} />
              <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#fecaca' }} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.revenue} strokeWidth={2.5} fill="url(#gProfRev)" />
              <Area type="monotone" dataKey="cost" name="COGS" stroke={COLORS.cost} strokeWidth={2} strokeDasharray="5 4" fill="none" />
              <Area type="monotone" dataKey="profit" name="Profit" stroke={COLORS.profit} strokeWidth={2.5} fill="url(#gProfProfit)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ReportSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportSection title="Top 10 Profit Contributors" icon={Trophy} className="chart-container">
          {data.topProfitItems.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <RankedBars rows={data.topProfitItems} valueKey="profit" money color="from-emerald-400 to-teal-500" />
          )}
        </ReportSection>

        <ReportSection title="Profit by Category" icon={Layers} className="chart-container">
          {data.profitByCategory.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.profitByCategory} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="category" {...axisProps} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="profit" name="Profit" fill={COLORS.revenue} radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <ReportSection title="Profit by Item" subtitle="Click a row to see the invoices behind it" icon={Receipt}>
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Revenue</Th>
              <Th>Cost</Th>
              <Th>Profit</Th>
              <Th>Margin</Th>
            </tr>
          </THead>
          <TBody>
            {data.profitByItem.length === 0 ? (
              <TableEmpty colSpan={5} message="No sales in this range." />
            ) : (
              data.profitByItem.map((i) => (
                <tr key={i.itemId} onClick={() => onDrilldown(i.itemId, i.name)} className="cursor-pointer hover:bg-brand-50/60">
                  <Td className="font-medium text-slate-900">{i.name}</Td>
                  <Td className="tabular-nums">{formatCurrency(i.revenue)}</Td>
                  <Td className="tabular-nums">{formatCurrency(i.cost)}</Td>
                  <Td>
                    <span className={`font-semibold tabular-nums ${i.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(i.profit)}</span>
                  </Td>
                  <Td>
                    <MarginPill pct={i.marginPct} />
                  </Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>

      {data.lossItems.length > 0 && (
        <ReportSection title="Loss-Making Items" subtitle="Sold for less than they cost" icon={AlertTriangle}>
          <Table>
            <THead>
              <tr>
                <Th>Item</Th>
                <Th>Revenue</Th>
                <Th>Cost</Th>
                <Th>Loss</Th>
              </tr>
            </THead>
            <TBody>
              {data.lossItems.map((i) => (
                <tr key={i.itemId}>
                  <Td className="font-medium text-slate-900">{i.name}</Td>
                  <Td className="tabular-nums">{formatCurrency(i.revenue)}</Td>
                  <Td className="tabular-nums">{formatCurrency(i.cost)}</Td>
                  <Td>
                    <span className="font-semibold tabular-nums text-rose-600">{formatCurrency(i.profit)}</span>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </ReportSection>
      )}
    </div>
  );
}

function MarginPill({ pct }) {
  const n = Number(pct) || 0;
  const cls = n < 0 ? 'bg-rose-50 text-rose-700' : n < 15 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>{pct}%</span>;
}

function InventoryReport({ data }) {
  const distribution = [
    { name: 'Healthy', value: data.stockDistribution.healthy, color: COLORS.profit },
    { name: 'Low Stock', value: data.stockDistribution.lowStock, color: COLORS.cost },
    { name: 'Out of Stock', value: data.stockDistribution.outOfStock, color: COLORS.loss },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5">
      <ReportSection title="Inventory Overview" icon={Boxes}>
        <ReportStatRow
          items={[
            { label: 'Inventory Cost Value', value: formatCurrency(data.stockValueAtCost), tone: 'text-neutral-900' },
            { label: 'Potential Retail Value', value: formatCurrency(data.stockValueAtSelling), tone: 'text-neutral-900' },
            { label: 'Potential Gross Profit', value: formatCurrency(data.potentialGrossProfit), tone: 'text-emerald-600' },
            { label: 'Total Products', value: data.totalItems },
            { label: 'Total Units', value: data.totalQuantity },
            { label: 'Low Stock', value: data.lowStock.length, tone: 'text-amber-600' },
            { label: 'Out of Stock', value: data.outOfStock.length, tone: 'text-rose-600' },
            { label: 'Expiring / Expired', value: `${data.nearExpiry.length} / ${data.expired.length}`, tone: 'text-rose-600' },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ReportSection
          title="Stock Value by Category"
          icon={Layers}
          className="chart-container lg:col-span-2"
          actions={
            <LegendDots
              items={[
                { label: 'Cost value', color: COLORS.muted },
                { label: 'Retail value', color: COLORS.revenue },
              ]}
            />
          }
        >
          {data.valueByCategory.length === 0 ? (
            <EmptyReportState message="No inventory items yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.valueByCategory} barGap={4} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="category" {...axisProps} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="costValue" name="Cost Value" fill={COLORS.muted} radius={[6, 6, 0, 0]} maxBarSize={32} />
                <Bar dataKey="sellingValue" name="Retail Value" fill={COLORS.revenue} radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Stock Health" icon={ShieldCheck} className="chart-container">
          {distribution.length === 0 ? (
            <EmptyReportState message="No inventory items yet." />
          ) : (
            <DonutChart data={distribution} valueKey="value" nameKey="name" money={false} centerLabel="Items" height={180} />
          )}
        </ReportSection>
      </div>

      <ReportSection title="Most Valuable Inventory Items" icon={Trophy} className="chart-container">
        {data.mostValuableItems.length === 0 ? (
          <EmptyReportState message="No inventory items yet." />
        ) : (
          <RankedBars rows={data.mostValuableItems} valueKey="stockValue" money />
        )}
      </ReportSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportSection title="Low Stock" subtitle={`${data.lowStock.length} item(s)`} icon={AlertTriangle}>
          <SimpleItemTable rows={data.lowStock} extraLabel="Threshold" extraKey="lowStockThreshold" />
        </ReportSection>
        <ReportSection title="Out of Stock" subtitle={`${data.outOfStock.length} item(s)`} icon={PackageX}>
          <SimpleItemTable rows={data.outOfStock} />
        </ReportSection>
        <ReportSection title="Expired" subtitle={`${data.expired.length} item(s)`} icon={CalendarX}>
          <SimpleItemTable rows={data.expired} extraLabel="Expired On" extraKey="expiryDate" isDate />
        </ReportSection>
        <ReportSection title="Near Expiry" subtitle={`${data.nearExpiry.length} item(s)`} icon={CalendarRange}>
          <SimpleItemTable rows={data.nearExpiry} extraLabel="Expires On" extraKey="expiryDate" isDate />
        </ReportSection>
      </div>
    </div>
  );
}

function UserPerformancePicker({ userId, onUserChange }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);

  useEffect(() => {
    client
      .get('/reports/users')
      .then((res) => setUsers(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load users.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm no-print sm:inline-flex">
      <UserRound className="h-4 w-4 text-brand-600" />
      <label className="text-sm font-medium text-slate-600" htmlFor="perf-user-select">
        User
      </label>
      <select
        id="perf-user-select"
        value={userId}
        onChange={(e) => onUserChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
      >
        <option value="">— Choose a user —</option>
        {(users || []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.username})
          </option>
        ))}
      </select>
    </div>
  );
}

function UserPerformanceReport({ data }) {
  return (
    <div className="space-y-5">
      <ReportSection title={`Performance — ${data.user.name}`} subtitle={`@${data.user.username}`} icon={UserRound}>
        <ReportStatRow
          items={[
            { label: 'Total Sales', value: formatCurrency(data.totalSales), tone: 'text-neutral-900' },
            { label: 'Invoice Count', value: data.invoiceCount },
            { label: 'Items Sold', value: data.itemsSold },
            { label: 'Cash Collected', value: formatCurrency(data.cashCollected), tone: 'text-emerald-600' },
            { label: 'Wallet Collected', value: formatCurrency(data.walletCollected), tone: 'text-neutral-900' },
            { label: 'Credit Extended', value: formatCurrency(data.creditExtended), tone: 'text-amber-600' },
            { label: 'Average Sale Value', value: formatCurrency(data.averageSaleValue) },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ReportSection title="Sales Over Time" icon={LineChartIcon} className="chart-container">
          {data.byDay.length === 0 ? (
            <EmptyReportState message="No confirmed sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.byDay} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>{gradient('gPerf', COLORS.revenue)}</defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="date" {...axisProps} tickFormatter={dayTick} />
                <YAxis {...axisProps} tickFormatter={compactMoney} width={56} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#fecaca' }} />
                <Area type="monotone" dataKey="totalSales" name="Sales" stroke={COLORS.revenue} strokeWidth={2.5} fill="url(#gPerf)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Payments Collected by Account" icon={CreditCard} className="chart-container">
          {data.paymentByAccount.length === 0 ? (
            <EmptyReportState message="No account payments found for this date range." />
          ) : (
            <DonutChart data={data.paymentByAccount} valueKey="amount" nameKey="account" centerLabel="Collected" height={190} />
          )}
        </ReportSection>
      </div>
    </div>
  );
}

function SimpleItemTable({ rows, extraLabel, extraKey, isDate }) {
  return (
    <Table>
      <THead>
        <tr>
          <Th>Item</Th>
          <Th>Item ID</Th>
          <Th>Quantity</Th>
          {extraLabel && <Th>{extraLabel}</Th>}
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <TableEmpty colSpan={extraLabel ? 4 : 3} message="Nothing to show." />
        ) : (
          rows.map((r) => (
            <tr key={r._id}>
              <Td className="font-medium text-slate-800">{r.name}</Td>
              <Td>{r.itemCode || '—'}</Td>
              <Td className="tabular-nums">{r.quantity}</Td>
              {extraLabel && <Td>{isDate ? formatDate(r[extraKey]) : r[extraKey]}</Td>}
            </tr>
          ))
        )}
      </TBody>
    </Table>
  );
}
