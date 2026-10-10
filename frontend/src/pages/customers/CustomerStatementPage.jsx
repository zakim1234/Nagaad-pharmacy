import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer, Clock } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW } from '../../components/docs/DocHeader.jsx';

const TYPE_LABEL = { SALE: 'Sale', SALE_PAYMENT: 'Payment', PAYMENT: 'Payment' };

function toDateInput(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export default function CustomerStatementPage() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState(new Set());
  const toggleInvoice = (id) => setExpandedInvoiceIds((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const load = useCallback(
    (params = {}) => {
      setLoading(true);
      client
        .get(`/customers/${id}/statement`, { params })
        .then((res) => {
          setData(res.data.data);
          setFrom(toDateInput(res.data.data.range.from));
          setTo(toDateInput(res.data.data.range.to));
        })
        .catch((err) => toast.error(err.friendlyMessage || 'Failed to load customer statement.'))
        .finally(() => setLoading(false));
    },
    [id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => load(), [load]);

  const applyRange = () => load({ from: from || undefined, to: to || undefined });
  const allHistory = () => load({});

  if (loading && !data) return <PageSpinner />;
  if (!data) return null;

  const { customer, summary, ledger, invoices, pendingToday } = data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/customers/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customer
        </Link>
        <div className="flex gap-2">
          <SharePdfButton
            fileName={`Statement-${customer.name.replace(/\s+/g, '-')}`}
            phone={customer.phone}
            message={`${BUSINESS.name} — account statement. Balance: ${formatCurrency(summary.currentOutstandingBalance)}`}
          />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print Statement
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 no-print">
        <FormField label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <Button variant="secondary" onClick={applyRange}>
          Apply Range
        </Button>
        <Button variant="ghost" onClick={allHistory}>
          All History
        </Button>
      </div>

      <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader
          title="Customer Statement"
          meta={
            <span>
              <span className="font-semibold">{formatDate(data.range.from)}</span> – <span className="font-semibold">{formatDate(data.range.to)}</span>
            </span>
          }
        />
        <DocInfo
          left={['Customer', customer.name, customer.phone, `Customer since ${formatDate(summary.customerSince)}`]}
          right={['Balance owed', formatCurrency(summary.currentOutstandingBalance), `${summary.numberOfFinalizedInvoices} invoice(s)`]}
        />

        {pendingToday.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 no-print">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
              <Clock className="h-3.5 w-3.5" /> Pending Today (not yet finalized -- excluded from totals above)
            </p>
            {pendingToday.map((p) => (
              <div key={p.id} className="flex justify-between text-sm text-amber-800">
                <span>{p.receiptNumber}</span>
                <span>{formatCurrency(p.total)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Transactions</p>
          <table className="w-full border-collapse text-xs">
            <thead className="table-header-group">
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={DOC_TH}>Date</th>
                <th className={DOC_TH}>Reference</th>
                <th className={DOC_TH}>Type</th>
                <th className={`${DOC_TH} text-right`}>Debit</th>
                <th className={`${DOC_TH} text-right`}>Credit</th>
                <th className={`${DOC_TH} text-right`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    No transactions in this period.
                  </td>
                </tr>
              ) : (
                ledger.map((e) => {
                  const invoice = e.type === 'SALE' && invoices.find((inv) => inv.receiptNumber === e.reference);
                  const expanded = invoice && expandedInvoiceIds.has(invoice.id);
                  return <Fragment key={`${e.type}-${e.reference}`}>
                  <tr className="border-b border-neutral-200">
                    <td className="px-2 py-2 text-neutral-500">{formatDateTime(e.date)}</td>
                    <td className="px-2 py-2 font-medium">{invoice ? <button type="button" className="cursor-pointer text-brand-700 hover:underline focus-visible:outline-2" aria-expanded={!!expanded} aria-controls={`invoice-${invoice.id}`} onClick={() => toggleInvoice(invoice.id)}><span className="no-print">{expanded ? '▾' : '▸'} </span>{e.reference}</button> : e.reference}</td>
                    <td className="px-2 py-2">{TYPE_LABEL[e.type] || e.type}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{e.debit > 0 ? formatCurrency(e.debit) : '—'}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-brand-700">{e.credit > 0 ? formatCurrency(e.credit) : '—'}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(e.runningBalance)}</td>
                  </tr>
                  {invoice && <tr id={`invoice-${invoice.id}`} className={`${expanded ? '' : 'hidden'} no-print`}><td colSpan={6} className="bg-slate-50 p-3">
                    <p className="mb-2 font-semibold">Invoice Items</p>
                    {invoice.items.map((item, index) => <div key={`${invoice.id}-${index}`} className="mb-1 flex flex-wrap justify-between gap-2"><span>{item.name} × {item.quantity}</span><span>Unit Price: {formatCurrency(item.unitPrice)} · Total: {formatCurrency(item.subtotal)}</span></div>)}
                    <div className="mt-2 flex flex-wrap gap-4 font-semibold"><span>Invoice Total: {formatCurrency(invoice.total)}</span><span>Paid: {formatCurrency(invoice.paidAmount)}</span><span>Balance: {formatCurrency(invoice.balance)}</span></div>
                  </td></tr>}
                  </Fragment>;
                })
              )}
            </tbody>
          </table>
        </div>

        {invoices.length > 0 && (
          <div className="mt-6 hidden print:block" style={{ pageBreakBefore: 'always' }}>
            <p className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Invoice Detail</p>
            <div className="space-y-3">
              {invoices.map((inv) => (
                <div key={inv.id} className="rounded-lg border border-slate-200 p-3" style={{ pageBreakInside: 'avoid' }}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{inv.receiptNumber}</span>
                    <span className="text-slate-400">{formatDate(inv.createdAt)}</span>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {inv.items.map((it, idx) => (
                        <tr key={idx} className="border-b border-slate-50">
                          <td className="py-1 text-slate-600">
                            {it.name} x {it.quantity}
                          </td>
                          <td className="py-1 text-right text-slate-500">{formatCurrency(it.unitPrice)}</td>
                          <td className="py-1 text-right font-medium text-slate-800">{formatCurrency(it.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-1.5 flex justify-end gap-4 text-xs">
                    <span>
                      Total: <strong className="text-slate-800">{formatCurrency(inv.total)}</strong>
                    </span>
                    <span>
                      Paid: <strong className="text-slate-800">{formatCurrency(inv.paidAmount)}</strong>
                    </span>
                    <span className={inv.balance > 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>
                      {inv.balance > 0 ? `Balance: ${formatCurrency(inv.balance)}` : 'Fully Paid'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-dashed border-slate-300 pt-4" style={{ pageBreakInside: 'avoid' }}>
          <DocTotals
            items={[
              ['Total purchased', formatCurrency(summary.totalAmountPurchased)],
              ['Total paid', formatCurrency(summary.totalPayments)],
              ['Balance owed', formatCurrency(summary.currentOutstandingBalance)],
            ]}
          />
          <p className="mt-2 text-center text-[11px] text-neutral-500">
            {summary.numberOfFinalizedInvoices} finalized invoice(s) · credit generated {formatCurrency(summary.totalCreditGenerated)}
          </p>
        </div>

        <DocFooter>Thank you for your business!</DocFooter>
      </div>
    </div>
  );
}

