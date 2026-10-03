import { useEffect, useState, useCallback } from 'react';
import QuotationsPage from '../quotations/QuotationsPage.jsx';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ReportSection from '../../components/reports/ReportSection.jsx';
import ReportStatRow from '../../components/reports/ReportStatRow.jsx';
import EmptyReportState from '../../components/reports/EmptyReportState.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import PrintReportHeader, { formatRangeLabel } from '../../components/reports/PrintReportHeader.jsx';
import PrintReportFooter from '../../components/reports/PrintReportFooter.jsx';
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
  { key: 'quotations', label: 'Quotation', title: 'Quotation Report', orientation: 'landscape' },
  { key: 'sales', label: 'Sales', title: 'Sales Report', orientation: 'portrait' },
  { key: 'profit', label: 'Profit', title: 'Profit Report', orientation: 'portrait' },
  { key: 'inventory', label: 'Inventory', title: 'Inventory Report', orientation: 'landscape' },
  { key: 'performance', label: 'User Performance', title: 'User Performance Report', orientation: 'portrait' },
  { key: 'pnl', label: 'Profit & Loss', title: 'Profit & Loss Report', orientation: 'portrait' },
  { key: 'balance-sheet', label: 'Balance Sheet', title: 'Balance Sheet', orientation: 'portrait' },
  { key: 'expenses', label: 'Expenses', title: 'Expense Report', orientation: 'portrait' },
  { key: 'payment-methods', label: 'Payment Methods', title: 'Payment Method Report', orientation: 'portrait' },
  { key: 'expired', label: 'Expired Products', title: 'Expired Products Report', orientation: 'landscape' },
  { key: 'low-stock', label: 'Low Stock', title: 'Low Stock Report', orientation: 'landscape' },
  { key: 'sales-returns', label: 'Sales Returns', title: 'Sales Return Report', orientation: 'landscape' },
  { key: 'purchase-returns', label: 'Purchase Returns', title: 'Purchase Return Report', orientation: 'landscape' },
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
  const showDateFilters = !NO_DATE_TABS.includes(tab) && tab !== 'pnl' && tab !== 'balance-sheet';
  const rangeLabel = NO_DATE_TABS.includes(tab) ? 'As of today' : formatRangeLabel(data?.range);

  if (tab === 'quotations') return <div className="space-y-4"><Button variant="secondary" onClick={() => setTab('sales')}>← Other Reports</Button><QuotationsPage report /></div>;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 no-print">
        <PageHeader title="Reports" subtitle="Sales, profit, inventory and purchasing performance" />
        <Button variant="secondary" onClick={() => printReport(activeTab.orientation)}>
          <Printer className="h-4 w-4" /> Print Report
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'performance' && (
        <UserPerformancePicker userId={performanceUserId} onUserChange={setPerformanceUserId} />
      )}

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

      <div id="print-area">
        {tab !== 'pnl' && tab !== 'balance-sheet' && <PrintReportHeader title={activeTab.title} rangeLabel={rangeLabel} />}

        {tab === 'pnl' ? (
          <ProfitLossReport />
        ) : tab === 'balance-sheet' ? (
          <BalanceSheetReport />
        ) : tab === 'performance' && !performanceUserId ? (
          <EmptyReportState message="Select a user above to view their performance report." />
        ) : !ready ? (
          <PageSpinner />
        ) : (
          <>
            {tab === 'sales' && <SalesReport data={data} rangeParams={rangeParams} />}
            {tab === 'profit' && (
              <ProfitReport data={data} onDrilldown={(itemId, name) => setDrilldownItem({ id: itemId, name })} />
            )}
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

  return (
    <div className="space-y-6">
      <ReportSection title="Sales Overview">
        <ReportStatRow
          items={[
            { label: 'Total Sales', value: formatCurrency(data.totalSales) },
            { label: 'Cash Collected', value: formatCurrency(data.cashCollected), tone: 'text-emerald-600' },
            { label: 'Credit Sales', value: formatCurrency(data.creditSales), tone: 'text-amber-600' },
            { label: 'Outstanding Receivables', value: formatCurrency(data.outstandingReceivables), tone: 'text-rose-600' },
            { label: 'Number of Sales', value: data.numberOfSales },
            { label: 'Items Sold', value: data.itemsSold },
            { label: 'Average Sale Value', value: formatCurrency(data.averageSaleValue) },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="Sales Revenue Over Time">
          {data.byDay.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} name="Revenue" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Number of Transactions Over Time">
          {data.byDay.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Transactions" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Cash vs Credit Sales">
          {data.cashVsCredit.cash + data.cashVsCredit.credit === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Cash', value: data.cashVsCredit.cash },
                    { name: 'Credit', value: data.cashVsCredit.credit },
                  ]}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={80}
                  label={(e) => `${e.name}: ${formatCurrency(e.value)}`}
                >
                  <Cell fill="#10b981" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Revenue by Payment Account">
          {!data.paymentByAccount || data.paymentByAccount.length === 0 ? (
            <EmptyReportState message="No account payments found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.paymentByAccount}
                  dataKey="amount"
                  nameKey="account"
                  outerRadius={80}
                  label={(e) => `${e.account}: ${formatCurrency(e.amount)}`}
                >
                  {data.paymentByAccount.map((entry, i) => (
                    <Cell key={entry.account} fill={['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'][i % 6]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Top Items by Quantity Sold">
          {data.topByQuantity.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.topByQuantity} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="quantity" fill="#4f46e5" radius={[0, 4, 4, 0]} name="Qty Sold" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <ReportSection title={`Transactions (${sales?.length ?? '…'})`}>
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
                  <tr key={s.id}>
                    <Td className="font-medium text-slate-900">
                      <Link to={`/receipt/${s.id}`} className="text-indigo-600 hover:underline no-print">
                        {s.receiptNumber}
                      </Link>
                      <span className="hidden print:inline">{s.receiptNumber}</span>
                    </Td>
                    <Td>{formatDate(s.createdAt)}</Td>
                    <Td>{new Date(s.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Td>
                    <Td>{s.customerName}</Td>
                    <Td>{s.items.length}</Td>
                    <Td>{formatCurrency(s.total)}</Td>
                    <Td>{formatCurrency(s.paidAmount)}</Td>
                    <Td className={s.outstanding > 0 ? 'font-semibold text-rose-600' : ''}>{formatCurrency(s.outstanding)}</Td>
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
    <div className="space-y-6">
      <ReportSection title="Profit Overview">
        <ReportStatRow
          items={[
            { label: 'Revenue', value: formatCurrency(data.revenue) },
            { label: 'Cost of Goods Sold', value: formatCurrency(data.costOfGoodsSold) },
            { label: 'Gross Profit', value: formatCurrency(data.grossProfit), tone: 'text-emerald-600' },
            { label: 'Gross Margin', value: `${data.grossMarginPct}%`, tone: 'text-emerald-600' },
            { label: 'Units Sold', value: data.unitsSold },
          ]}
        />
      </ReportSection>

      <ReportSection title="Revenue vs COGS vs Profit Over Time">
        {data.byDay.length === 0 ? (
          <EmptyReportState message="No sales found for this date range." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={false} name="COGS" />
              <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="Top 10 Profit Contributors">
          {data.topProfitItems.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.topProfitItems} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="profit" fill="#10b981" radius={[0, 4, 4, 0]} name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Profit by Category">
          {data.profitByCategory.length === 0 ? (
            <EmptyReportState message="No sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.profitByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="profit" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Profit" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <ReportSection title="Profit by Item — click a row on screen to see the invoices behind it">
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
                <tr
                  key={i.itemId}
                  onClick={() => onDrilldown(i.itemId, i.name)}
                  className="cursor-pointer hover:bg-indigo-50"
                >
                  <Td className="font-medium text-slate-900">{i.name}</Td>
                  <Td>{formatCurrency(i.revenue)}</Td>
                  <Td>{formatCurrency(i.cost)}</Td>
                  <Td className={i.profit >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                    {formatCurrency(i.profit)}
                  </Td>
                  <Td>{i.marginPct}%</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>

      {data.lossItems.length > 0 && (
        <ReportSection title="Loss-Making Items">
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
                  <Td>{formatCurrency(i.revenue)}</Td>
                  <Td>{formatCurrency(i.cost)}</Td>
                  <Td className="font-semibold text-rose-600">{formatCurrency(i.profit)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </ReportSection>
      )}
    </div>
  );
}

function InventoryReport({ data }) {
  const distribution = [
    { name: 'Healthy', value: data.stockDistribution.healthy },
    { name: 'Low Stock', value: data.stockDistribution.lowStock },
    { name: 'Out of Stock', value: data.stockDistribution.outOfStock },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      <ReportSection title="Inventory Overview">
        <ReportStatRow
          items={[
            { label: 'Inventory Cost Value', value: formatCurrency(data.stockValueAtCost) },
            { label: 'Potential Retail Value', value: formatCurrency(data.stockValueAtSelling) },
            { label: 'Potential Gross Profit', value: formatCurrency(data.potentialGrossProfit), tone: 'text-emerald-600' },
            { label: 'Total Products', value: data.totalItems },
            { label: 'Total Units', value: data.totalQuantity },
            { label: 'Low Stock', value: data.lowStock.length, tone: 'text-amber-600' },
            { label: 'Out of Stock', value: data.outOfStock.length, tone: 'text-rose-600' },
            { label: 'Expiring / Expired', value: `${data.nearExpiry.length} / ${data.expired.length}`, tone: 'text-rose-600' },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="Stock Value by Category">
          {data.valueByCategory.length === 0 ? (
            <EmptyReportState message="No inventory items yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.valueByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
                <Bar dataKey="costValue" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Cost Value" />
                <Bar dataKey="sellingValue" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Retail Value" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Stock Health Distribution">
          {distribution.length === 0 ? (
            <EmptyReportState message="No inventory items yet." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={distribution} dataKey="value" nameKey="name" outerRadius={90} label={(e) => `${e.name}: ${e.value}`}>
                  {distribution.map((d) => (
                    <Cell key={d.name} fill={d.name === 'Healthy' ? '#10b981' : d.name === 'Low Stock' ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Most Valuable Inventory Items" className="lg:col-span-2">
          {data.mostValuableItems.length === 0 ? (
            <EmptyReportState message="No inventory items yet." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.mostValuableItems} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="stockValue" fill="#4f46e5" radius={[0, 4, 4, 0]} name="Stock Value" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title={`Low Stock (${data.lowStock.length})`}>
          <SimpleItemTable rows={data.lowStock} extraLabel="Threshold" extraKey="lowStockThreshold" />
        </ReportSection>
        <ReportSection title={`Out of Stock (${data.outOfStock.length})`}>
          <SimpleItemTable rows={data.outOfStock} />
        </ReportSection>
        <ReportSection title={`Expired (${data.expired.length})`}>
          <SimpleItemTable rows={data.expired} extraLabel="Expired On" extraKey="expiryDate" isDate />
        </ReportSection>
        <ReportSection title={`Near-Expiry (${data.nearExpiry.length})`}>
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
    <div className="mb-4 flex flex-wrap items-center gap-2 no-print">
      <label className="text-sm font-medium text-slate-600" htmlFor="perf-user-select">
        Select User
      </label>
      <select
        id="perf-user-select"
        value={userId}
        onChange={(e) => onUserChange(e.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
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
    <div className="space-y-6">
      <ReportSection title={`Performance — ${data.user.name} (${data.user.username})`}>
        <ReportStatRow
          items={[
            { label: 'Total Sales', value: formatCurrency(data.totalSales) },
            { label: 'Invoice Count', value: data.invoiceCount },
            { label: 'Items Sold', value: data.itemsSold },
            { label: 'Cash Collected', value: formatCurrency(data.cashCollected), tone: 'text-emerald-600' },
            { label: 'Wallet Collected', value: formatCurrency(data.walletCollected), tone: 'text-indigo-600' },
            { label: 'Credit Extended', value: formatCurrency(data.creditExtended), tone: 'text-amber-600' },
            { label: 'Average Sale Value', value: formatCurrency(data.averageSaleValue) },
          ]}
        />
      </ReportSection>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReportSection title="Sales Over Time">
          {data.byDay.length === 0 ? (
            <EmptyReportState message="No confirmed sales found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Line type="monotone" dataKey="totalSales" stroke="#4f46e5" strokeWidth={2} dot={false} name="Sales" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection title="Payments Collected by Account">
          {data.paymentByAccount.length === 0 ? (
            <EmptyReportState message="No account payments found for this date range." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.paymentByAccount}
                  dataKey="amount"
                  nameKey="account"
                  outerRadius={80}
                  label={(e) => `${e.account}: ${formatCurrency(e.amount)}`}
                >
                  {data.paymentByAccount.map((entry, i) => (
                    <Cell key={entry.account} fill={['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'][i % 6]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ReportSection>
      </div>

      <ReportSection title="Payments Collected by Account — Detail">
        <Table>
          <THead>
            <tr>
              <Th>Account</Th>
              <Th>Amount Collected</Th>
            </tr>
          </THead>
          <TBody>
            {data.paymentByAccount.length === 0 ? (
              <TableEmpty colSpan={2} message="No account payments found for this date range." />
            ) : (
              data.paymentByAccount.map((a) => (
                <tr key={a.account}>
                  <Td className="font-medium text-slate-900">{a.account}</Td>
                  <Td>{formatCurrency(a.amount)}</Td>
                </tr>
              ))
            )}
          </TBody>
        </Table>
      </ReportSection>
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
              <Td>{r.name}</Td>
              <Td>{r.itemCode || '—'}</Td>
              <Td>{r.quantity}</Td>
              {extraLabel && <Td>{isDate ? formatDate(r[extraKey]) : r[extraKey]}</Td>}
            </tr>
          ))
        )}
      </TBody>
    </Table>
  );
}
