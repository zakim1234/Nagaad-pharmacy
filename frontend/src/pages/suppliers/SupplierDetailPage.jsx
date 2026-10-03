import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ArrowLeft, Lightbulb, TrendingUp, TrendingDown, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty } from '../../components/ui/Table.jsx';
import ReportSection from '../../components/reports/ReportSection.jsx';
import EmptyReportState from '../../components/reports/EmptyReportState.jsx';
import PrintReportHeader from '../../components/reports/PrintReportHeader.jsx';
import PrintReportFooter from '../../components/reports/PrintReportFooter.jsx';

export default function SupplierDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const [analysis, setAnalysis] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    client
      .get(`/suppliers/${id}/analysis`)
      .then((res) => setAnalysis(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load supplier analysis.'));
    client
      .get(`/suppliers/${id}/history`)
      .then((res) => setHistory(res.data.data))
      .catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!analysis) return <PageSpinner />;
  const { supplier, totals, items, insights, bestItem, worstItem, overallMarginPct, purchaseCount, itemCount } = analysis;

  const chartData = items.slice(0, 8).map((i) => ({
    name: i.name.length > 14 ? i.name.slice(0, 14) + '…' : i.name,
    Purchased: i.purchasedQty,
    Sold: i.soldQty,
    Remaining: i.remainingQty,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/suppliers" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Suppliers
        </Link>
        <Button variant="secondary" onClick={() => printReport('landscape')}>
          <Printer className="h-4 w-4" /> Print Report
        </Button>
      </div>

      <div id="print-area">
        <PrintReportHeader title="Supplier Performance Report" rangeLabel={supplier.name} />

        <Card className="mb-6 report-section">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{supplier.name}</h1>
              <p className="text-sm text-slate-500">{supplier.phone || 'No phone on file'}</p>
              <p className="text-sm text-slate-500">{supplier.email}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-slate-400">{purchaseCount} purchase(s) · {itemCount} product(s)</p>
              <p className="text-lg font-bold text-slate-800">{formatCurrency(supplier.totalSpent)} total spent</p>
            </div>
          </div>
        </Card>

        <div className="kpi-grid grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Purchase Cost" value={formatCurrency(totals.purchaseCost)} tone="slate" />
          <StatCard label="Revenue" value={formatCurrency(totals.revenue)} tone="indigo" />
          <StatCard label="COGS" value={formatCurrency(totals.cogs)} tone="slate" />
          <StatCard label="Realized Profit" value={formatCurrency(totals.profit)} tone="emerald" />
          <StatCard label="Gross Margin" value={`${overallMarginPct}%`} tone="emerald" />
          <StatCard label="Remaining Stock Value" value={formatCurrency(totals.remainingStockValue)} tone="amber" hint={`${totals.remainingQty} units unsold`} />
        </div>

        {insights.length > 0 && (
          <ReportSection className="mt-6" title={<span className="flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" /> Insights</span>}>
            <ul className="space-y-1.5 text-sm text-slate-700">
              {insights.map((text, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-indigo-500">•</span> {text}
                </li>
              ))}
            </ul>
          </ReportSection>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {bestItem && (
            <ReportSection title={<span className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-emerald-500" /> Best Performing Item</span>}>
              <p className="text-lg font-bold text-slate-900">{bestItem.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                Sold {bestItem.soldQty} units · Revenue {formatCurrency(bestItem.revenue)} · Profit{' '}
                <span className="font-semibold text-emerald-600">{formatCurrency(bestItem.profit)}</span>
              </p>
            </ReportSection>
          )}
          {worstItem && (
            <ReportSection title={<span className="flex items-center gap-1.5"><TrendingDown className="h-4 w-4 text-rose-500" /> Lowest Performing Item</span>}>
              <p className="text-lg font-bold text-slate-900">{worstItem.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                Sold {worstItem.soldQty} units · Revenue {formatCurrency(worstItem.revenue)} · Profit{' '}
                <span className="font-semibold text-rose-600">{formatCurrency(worstItem.profit)}</span>
              </p>
            </ReportSection>
          )}
        </div>

        <ReportSection className="mt-6" title="Purchased vs Sold vs Remaining">
          {chartData.length === 0 ? (
            <EmptyReportState message="No purchases from this supplier yet." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Purchased" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Sold" fill="#4f46e5" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Remaining" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ReportSection>

        <ReportSection className="mt-6" title={`Item Performance (${items.length})`}>
          <Table>
            <THead>
              <tr>
                <Th>Item</Th>
                <Th>Purchased</Th>
                <Th>Sold</Th>
                <Th>Remaining</Th>
                <Th>Revenue</Th>
                <Th>COGS</Th>
                <Th>Profit</Th>
                <Th>Margin</Th>
              </tr>
            </THead>
            <TBody>
              {items.length === 0 ? (
                <TableEmpty colSpan={8} message="No items purchased from this supplier yet." />
              ) : (
                items.map((i) => (
                  <tr key={i.itemId} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{i.name}</Td>
                    <Td>{i.purchasedQty}</Td>
                    <Td>{i.soldQty}</Td>
                    <Td>{i.remainingQty}</Td>
                    <Td>{formatCurrency(i.revenue)}</Td>
                    <Td>{formatCurrency(i.cogs)}</Td>
                    <Td className={i.profit >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                      {formatCurrency(i.profit)}
                    </Td>
                    <Td>{i.soldQty > 0 ? `${i.marginPct}%` : '—'}</Td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        </ReportSection>

        {history && (
          <ReportSection className="mt-6" title={`Purchase Orders (${history.purchases.length})`}>
            {history.purchases.length === 0 ? (
              <EmptyReportState message="No purchases recorded yet." />
            ) : (
              <div className="space-y-3">
                {history.purchases.map((p) => (
                  <div key={p.id} className="rounded-lg border border-slate-100 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{p.purchaseNumber}</span>
                      <div className="flex items-center gap-2">
                        {p.status === 'voided' && <Badge color="red">Voided</Badge>}
                        <span className="text-xs text-slate-400">{formatDateTime(p.createdAt)}</span>
                      </div>
                    </div>
                    <ul className="mb-2 space-y-0.5 text-sm text-slate-600">
                      {p.items.map((it, i) => (
                        <li key={i} className="flex justify-between">
                          <span>
                            {it.name} × {it.quantity} @ {formatCurrency(it.unitCost)}
                          </span>
                          <span>{formatCurrency(it.subtotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      <span>
                        Total: <strong className="text-slate-800">{formatCurrency(p.totalCost)}</strong>
                      </span>
                      <span>
                        Paid: <strong className="text-slate-800">{formatCurrency(p.paidAmount)}</strong>
                      </span>
                      {p.balance > 0 && <span className="font-semibold text-rose-600">Owed: {formatCurrency(p.balance)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ReportSection>
        )}

        <PrintReportFooter />
      </div>
    </div>
  );
}
