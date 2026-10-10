import { Fragment, useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Wallet,
  Receipt,
  History,
  FileText,
  Pencil,
  XCircle,
  Undo2,
  Printer,
  ClipboardList,
  PiggyBank,
  ChevronRight,
  Eye,
  ShoppingBag,
  CheckCircle2,
  AlertCircle,
  Phone,
  CalendarDays,
  Ban,
} from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import PayDebtModal from './PayDebtModal.jsx';
import ReturnItemsModal from './ReturnItemsModal.jsx';
import CustomerQuotationsSection from './CustomerQuotationsSection.jsx';
import CustomerWalletSection from './CustomerWalletSection.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo } from '../../components/docs/DocHeader.jsx';

const LEDGER_LABELS = {
  SALE_CREDIT: { label: 'Debt Created', color: 'red' },
  PAYMENT: { label: 'Debt Payment', color: 'green' },
  ADJUSTMENT: { label: 'Adjustment', color: 'blue' },
  SALE_VOID: { label: 'Sale Cancelled', color: 'slate' },
  SALE_RETURN: { label: 'Items Returned', color: 'blue' },
  REFUND: { label: 'Refund', color: 'amber' },
};

const INVOICE_STATUS_LABEL = { DRAFT: 'Pending', CONFIRMED: 'Completed', CANCELLED: 'Cancelled' };

// DRAFT invoices are deliberately never posted to outstandingCents (see
// customerController.getCustomerStatement) -- so a $0-paid Draft would
// otherwise read as "Fully Paid". CONFIRMED/CANCELLED already carry the
// correct, ledger-authoritative outstanding value.
function invoiceBalance(sale) {
  return sale.status === 'DRAFT' ? Math.max(0, sale.total - sale.paidAmount - sale.walletAmount) : sale.outstanding;
}

// What the customer has paid on an invoice: cash/account plus wallet credit.
function invoicePaid(sale) {
  return sale.paidAmount + sale.walletAmount;
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState(null);
  const [debt, setDebt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [returnSale, setReturnSale] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null); // { sale, mode: 'cancel' | 'reverse' }
  const [cancelling, setCancelling] = useState(false);
  const [tab, setTab] = useState('invoices');
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      client.get(`/customers/${id}/history`, { params: { from: from || undefined, to: to || undefined } }),
      client.get(`/customers/${id}/debt`),
    ])
      .then(([historyRes, debtRes]) => {
        setData(historyRes.data.data);
        setDebt(debtRes.data.data);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load customer.'))
      .finally(() => setLoading(false));
  }, [id, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  const handleCancelConfirm = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const path = cancelTarget.mode === 'reverse' ? `/sales/${cancelTarget.sale.id}/reverse` : `/sales/${cancelTarget.sale.id}/cancel`;
      await client.post(path, { reason: cancelTarget.mode === 'reverse' ? 'Cancelled by customer' : 'Cancelled by seller' });
      toast.success(cancelTarget.mode === 'reverse' ? 'Invoice cancelled and reversed.' : 'Draft invoice cancelled.');
      setCancelTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this invoice.');
    } finally {
      setCancelling(false);
    }
  };

  const toggle = (saleId) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(saleId)) next.delete(saleId);
      else next.add(saleId);
      return next;
    });

  if (loading && !data) return <PageSpinner />;
  if (!data) return null;

  const { customer, sales, timeline, walletPaid = 0 } = data;
  const activeSales = sales.filter((s) => s.status !== 'CANCELLED');
  const invoices = status ? activeSales.filter((s) => s.status === status) : activeSales;
  const cancelledSales = sales.filter((s) => s.status === 'CANCELLED');
  const returns = sales
    .flatMap((s) => s.returns.map((r) => ({ ...r, sale: s })))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const totalPaid = customer.totalPaid + walletPaid;

  const tabs = [
    { key: 'invoices', label: 'Invoices', icon: Receipt, count: activeSales.length },
    { key: 'returns', label: 'Returns', icon: Undo2, count: returns.length },
    { key: 'cancelled', label: 'Cancelled', icon: Ban, count: cancelledSales.length },
    { key: 'quotations', label: 'Quotations', icon: ClipboardList },
    { key: 'wallet', label: 'Wallet', icon: PiggyBank },
    { key: 'activity', label: 'Activity', icon: History },
  ];

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/customers" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link to={`/customers/${id}/statement`}>
            <Button variant="secondary">
              <FileText className="h-4 w-4" /> Customer Statement
            </Button>
          </Link>
          <Button onClick={() => setPayOpen(true)} disabled={customer.balance <= 0}>
            <Wallet className="h-4 w-4" /> Pay Debt
          </Button>
        </div>
      </div>

      {/* Profile + stats */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm no-print">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 via-white to-white px-6 py-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-red-700 text-lg font-bold text-white shadow-md">
            {initials(customer.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold capitalize text-slate-900">{customer.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> {customer.phone || 'No phone on file'}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> Customer since {formatDate(customer.createdAt)}
              </span>
            </div>
          </div>
          {customer.balance > 0 ? (
            <Badge color="red">Owes {formatCurrency(customer.balance)}</Badge>
          ) : (
            <Badge color="green">No debt</Badge>
          )}
        </div>
        <div className="grid grid-cols-2 divide-slate-100 lg:grid-cols-4 lg:divide-x">
          <StatTile icon={ShoppingBag} tone="slate" label="Total Purchased" value={formatCurrency(customer.totalPurchased)} />
          <StatTile
            icon={CheckCircle2}
            tone="emerald"
            label="Total Paid"
            value={formatCurrency(totalPaid)}
            hint={walletPaid > 0 ? `incl. ${formatCurrency(walletPaid)} from wallet` : null}
          />
          <StatTile
            icon={AlertCircle}
            tone={customer.balance > 0 ? 'rose' : 'emerald'}
            label="Outstanding Balance"
            value={formatCurrency(customer.balance)}
            valueClass={customer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}
          />
          <StatTile icon={PiggyBank} tone="indigo" label="Wallet Balance" value={formatCurrency(customer.walletBalance)} valueClass="text-brand-600" />
        </div>
      </section>

      {/* Where the debt came from */}
      {debt && debt.invoices.length > 0 && (
        <section className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5 no-print">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-800">
              <AlertCircle className="h-4 w-4" /> Where this debt came from
            </h3>
            <span className="text-sm font-bold text-rose-700">Total: {formatCurrency(debt.totalOutstanding)}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-rose-100 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid at Sale</th>
                  <th className="px-4 py-2.5 text-right font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {debt.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2.5">
                      <Link to={`/receipt/${inv.id}`} className="font-semibold text-brand-600 hover:underline">
                        {inv.receiptNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{formatDate(inv.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(inv.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{formatCurrency(inv.paidAtSale)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-rose-600">{formatCurrency(inv.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-1 no-print sm:inline-flex">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
            {count != null && (
              <span className={`rounded-full px-1.5 text-[11px] ${tab === key ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'}`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'quotations' && <CustomerQuotationsSection customerId={id} customer={customer} />}
      {tab === 'wallet' && (
        <CustomerWalletSection customerId={id} customerName={customer.name} walletBalance={customer.walletBalance} customerDebt={customer.balance} onChanged={load} />
      )}

      {tab === 'invoices' && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm no-print">
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="From">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </FormField>
              <FormField label="To">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </FormField>
              <FormField label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="DRAFT">Pending</option>
                  <option value="CONFIRMED">Completed</option>
                </Select>
              </FormField>
            </div>
            <SharePdfButton fileName={`Invoices-${customer.name.replace(/\s+/g, '-')}`} phone={customer.phone} message={`${BUSINESS.name} — your invoices`} />
            <Button variant="secondary" onClick={() => printReport('portrait')} disabled={invoices.length === 0}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>

          <div id="print-area">
            <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
              <PrintHeader customer={customer} from={from} to={to} status={status} />

              {invoices.length === 0 ? (
                <EmptyState icon={Receipt} text="No invoices found for the selected filters." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/80">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="w-10 px-3 py-3 no-print" />
                        <th className="px-3 py-3 font-medium">Invoice</th>
                        <th className="px-3 py-3 font-medium">Date</th>
                        <th className="px-3 py-3 font-medium">Items</th>
                        <th className="px-3 py-3 text-right font-medium">Total</th>
                        <th className="px-3 py-3 text-right font-medium">Paid</th>
                        <th className="px-3 py-3 text-right font-medium">Status</th>
                        <th className="px-3 py-3 text-right font-medium no-print">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((s) => {
                        const balance = invoiceBalance(s);
                        const isOpen = expanded.has(s.id);
                        return (
                          <Fragment key={s.id}>
                            <tr className={`border-t border-slate-100 transition-colors hover:bg-slate-50/70 ${isOpen ? 'bg-slate-50/70' : ''}`} style={{ pageBreakInside: 'avoid' }}>
                              <td className="px-3 py-3 no-print">
                                <button
                                  onClick={() => toggle(s.id)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                  title={isOpen ? 'Hide items' : 'Show items'}
                                >
                                  <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                </button>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-slate-800">{s.receiptNumber}</span>
                                  {s.returnCount > 0 && (
                                    <button onClick={() => setTab('returns')} className="no-print">
                                      <Badge color="blue">
                                        {s.returnCount} return{s.returnCount > 1 ? 's' : ''}
                                      </Badge>
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(s.createdAt)}</td>
                              <td className="max-w-[220px] px-3 py-3 text-slate-600">
                                <p className="truncate">{s.items.map((it) => it.name).join(', ')}</p>
                                <p className="text-xs text-slate-400">{s.items.length} item{s.items.length > 1 ? 's' : ''}</p>
                              </td>
                              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{formatCurrency(s.total)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                                {formatCurrency(invoicePaid(s))}
                                {s.walletAmount > 0 && <p className="text-[11px] text-brand-500">{formatCurrency(s.walletAmount)} wallet</p>}
                              </td>
                              <td className="px-3 py-3 text-right">
                                {s.status === 'DRAFT' ? (
                                  <Badge color="amber">Pending{balance > 0 ? ` · ${formatCurrency(balance)} due` : ''}</Badge>
                                ) : balance > 0 ? (
                                  <Badge color="red">{formatCurrency(balance)} due</Badge>
                                ) : (
                                  <Badge color="green">Paid</Badge>
                                )}
                              </td>
                              <td className="px-3 py-3 no-print">
                                <div className="flex justify-end gap-1.5">
                                  <IconAction label="View" title="View / Print" onClick={() => navigate(`/receipt/${s.id}`)} icon={Eye} />
                                  {s.status === 'DRAFT' && (
                                    <>
                                      <IconAction label="Edit" title="Edit" onClick={() => navigate(`/pos?edit=${s.id}`)} icon={Pencil} />
                                      <IconAction label="Cancel" title="Cancel draft" danger onClick={() => setCancelTarget({ sale: s, mode: 'cancel' })} icon={XCircle} />
                                    </>
                                  )}
                                  {s.status === 'CONFIRMED' && canManage && (
                                    <>
                                      <IconAction label="Return" title="Return items" onClick={() => setReturnSale(s)} icon={Undo2} />
                                      <IconAction label="Cancel" title="Cancel invoice" danger onClick={() => setCancelTarget({ sale: s, mode: 'reverse' })} icon={XCircle} />
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            <tr className={`${isOpen ? '' : 'hidden'} print:table-row`}>
                              <td className="no-print" />
                              <td colSpan={7} className="px-3 pb-4 pt-1">
                                <InvoiceItems sale={s} />
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {invoices.length > 0 && (
                <div className="border-t border-slate-100 p-4 print:mt-8 print:border-t-2 print:border-dashed">
                  <p className="mb-2 hidden text-center text-sm font-bold uppercase tracking-wide text-slate-700 print:block">Statement Summary</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <SummaryTile label="Invoices" value={invoices.length} />
                    <SummaryTile label="Total Amount" value={formatCurrency(invoices.reduce((sum, s) => sum + s.total, 0))} />
                    <SummaryTile label="Total Paid" value={formatCurrency(invoices.reduce((sum, s) => sum + invoicePaid(s), 0))} tone="green" />
                    <SummaryTile label="Outstanding" value={formatCurrency(invoices.reduce((sum, s) => sum + invoiceBalance(s), 0))} tone="red" />
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {tab === 'returns' && (
        <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <SectionHeader icon={Undo2} title="Returned Items" subtitle="Every return made on this customer's invoices" />
          {returns.length === 0 ? (
            <EmptyState icon={Undo2} text="No items have been returned." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Items Returned</th>
                    <th className="px-4 py-3 text-right font-medium">Value</th>
                    <th className="px-4 py-3 text-right font-medium">Debt Reduced</th>
                    <th className="px-4 py-3 text-right font-medium">Refunded</th>
                    <th className="px-4 py-3 text-right font-medium">To Wallet</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returns.map((r) => (
                    <tr key={`${r.sale.id}-${r.index}`} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800">{r.sale.receiptNumber}</span>
                        {r.sale.status === 'CANCELLED' && <Badge color="red" className="ml-1.5">Cancelled</Badge>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.items.map((it, i) => (
                          <p key={i}>
                            {it.name} <span className="text-slate-400">× {it.quantity}</span>
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency(r.debtReduced)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency(r.refund)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-brand-600">{formatCurrency(r.walletRefund)}</td>
                      <td className="px-4 py-3 text-slate-500">{r.reason || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/receipt/${r.sale.id}/return/${r.index}`} className="text-xs font-semibold text-brand-600 hover:underline">
                          Receipt
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'cancelled' && (
        <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <SectionHeader icon={Ban} title="Cancelled Invoices" subtitle="Kept for the record — they no longer affect stock or balances" />
          {cancelledSales.length === 0 ? (
            <EmptyState icon={Ban} text="No cancelled invoices." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-medium">Invoice</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Cancelled</th>
                    <th className="px-4 py-3 font-medium">Items</th>
                    <th className="px-4 py-3 text-right font-medium">Original Value</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cancelledSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-500 line-through decoration-slate-300">{s.receiptNumber}</span>
                        {s.returnCount > 0 && <Badge color="blue" className="ml-1.5">{s.returnCount} return{s.returnCount > 1 ? 's' : ''}</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(s.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{s.cancelledAt ? formatDateTime(s.cancelledAt) : '—'}</td>
                      <td className="max-w-[240px] px-4 py-3 text-slate-600">
                        <p className="truncate">{s.items.map((it) => `${it.name} × ${it.quantity}`).join(', ')}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatCurrency(s.items.reduce((sum, it) => sum + it.subtotal, 0))}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{s.cancelledReason || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/receipt/${s.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <SectionHeader icon={History} title="Balance Activity" subtitle="Everything that changed what this customer owes" />
          {!timeline || timeline.length === 0 ? (
            <EmptyState icon={History} text="No balance-affecting transactions yet." />
          ) : (
            <ol className="relative mx-5 mb-5 border-l border-slate-200">
              {[...timeline].reverse().map((t) => {
                const meta = LEDGER_LABELS[t.type] || { label: t.type, color: 'slate' };
                const increases = t.amount > 0;
                return (
                  <li key={t.id} className="ml-5 py-3">
                    <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${increases ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Badge color={meta.color}>{meta.label}</Badge>
                        <p className="mt-1 text-sm text-slate-600">{t.description}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-semibold tabular-nums ${increases ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {increases ? '+' : ''}
                          {formatCurrency(t.amount)}
                        </p>
                        <p className="text-xs text-slate-400">Balance: {formatCurrency(t.balanceAfter)}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      <PayDebtModal open={payOpen} onClose={() => setPayOpen(false)} customerId={id} onPaid={load} />
      <ReturnItemsModal open={!!returnSale} onClose={() => setReturnSale(null)} sale={returnSale} onReturned={load} />
      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget?.mode === 'reverse' ? 'Cancel Invoice' : 'Cancel Draft Invoice'}
        message={
          cancelTarget?.mode === 'reverse'
            ? `Cancel confirmed invoice ${cancelTarget?.sale.receiptNumber}? Stock will be restored, the customer's balance and any paid amount will be reversed, and the invoice will be marked Cancelled (never deleted).`
            : `Cancel draft invoice ${cancelTarget?.sale.receiptNumber}? Reserved stock and any pending payment will be released.`
        }
        confirmLabel={cancelTarget?.mode === 'reverse' ? 'Cancel Invoice' : 'Cancel Draft'}
        variant="danger"
        loading={cancelling}
        onConfirm={handleCancelConfirm}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}

const TILE_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  indigo: 'bg-brand-50 text-brand-600',
};

function StatTile({ icon: Icon, tone, label, value, hint, valueClass = 'text-slate-900' }) {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${TILE_TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className={`text-lg font-bold leading-tight tabular-nums ${valueClass}`}>{value}</p>
        {hint && <p className="truncate text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  const cls = tone === 'red' ? 'bg-rose-50 text-rose-700' : tone === 'green' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-800';
  return (
    <div className={`rounded-xl px-4 py-2.5 ${cls}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}

function IconAction({ icon: Icon, label, title, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        danger ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}

function InvoiceItems({ sale }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-100 text-left uppercase text-slate-400">
            <th className="w-8 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-center font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it, i) => (
            <tr key={i} className="border-b border-slate-50 last:border-0">
              <td className="px-3 py-2 text-slate-400">{i + 1}</td>
              <td className="px-3 py-2 text-slate-700">
                {it.name}
                {it.returnedQuantity > 0 && <span className="ml-1.5 text-[10px] font-medium text-brand-600">({it.returnedQuantity} returned)</span>}
              </td>
              <td className="px-3 py-2 text-center text-slate-600">{it.quantity}</td>
              <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(it.unitPrice)}</td>
              <td className="px-3 py-2 text-right font-medium text-slate-800">{formatCurrency(it.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(sale.discount > 0 || sale.walletAmount > 0) && (
        <div className="flex flex-wrap justify-end gap-4 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {sale.discount > 0 && <span>Discount: {formatCurrency(sale.discount)}</span>}
          {sale.walletAmount > 0 && <span>From wallet: {formatCurrency(sale.walletAmount)}</span>}
          {sale.paidAmount > 0 && <span>Cash/account: {formatCurrency(sale.paidAmount)}</span>}
        </div>
      )}
    </div>
  );
}

// Print-only branded statement header -- screen navigation, filter controls
// and per-invoice action buttons never appear on paper.
function PrintHeader({ customer, from, to, status }) {
  return (
    <div className="mb-4 hidden p-4 print:block">
      <DocHeader title="Customer Invoices" meta={<span className="font-semibold">{from || to ? `${from || 'Start'} – ${to || 'Today'}` : 'All history'}</span>} />
      <DocInfo left={['Customer', customer.name, customer.phone]} right={['Invoices', status ? INVOICE_STATUS_LABEL[status] : 'All']} />
    </div>
  );
}
