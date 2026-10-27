import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
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

const refundText = (r, inv) =>
  !r ? (inv.fromWallet > 0 ? 'Wallet money put back in the wallet' : 'Nothing was paid') : r.to === 'ACCOUNT' ? `Cash given back from ${r.accountName || 'the account'}${r.reference ? ` to ${r.reference}` : ''}` : "Put in the customer's wallet";

// A customer's cancelled invoices on their own statement: each invoice, what
// was paid on it, when and why it was cancelled, and where the money went.
export default function CancelledStatementPage() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(
    (params = {}) => {
      client
        .get(`/customers/${id}/cancelled-statement`, { params })
        .then((res) => setData(res.data.data))
        .catch((err) => toast.error(err.friendlyMessage || 'Failed to load the cancelled invoices.'));
    },
    [id] // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => load(), [load]);

  if (!data) return <PageSpinner />;
  const { customer, invoices, totals } = data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/customers/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customer
        </Link>
        <div className="flex gap-2">
          <SharePdfButton
            fileName={`Cancelled-Invoices-${customer.name.replace(/\s+/g, '-')}`}
            phone={customer.phone}
            message={`${BUSINESS.name} — cancelled invoices: ${totals.count}, ${formatCurrency(totals.paid)} paid back`}
          />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
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
        <Button variant="secondary" onClick={() => load({ from: from || undefined, to: to || undefined })}>
          Apply Range
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFrom('');
            setTo('');
            load({});
          }}
        >
          All History
        </Button>
      </div>

      <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-neutral-200/80 bg-white p-6 text-neutral-900 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader
          title="Cancelled Invoices"
          meta={
            data.range.from || data.range.to ? (
              <span>
                <span className="font-semibold">{data.range.from ? formatDate(data.range.from) : '…'}</span> – <span className="font-semibold">{data.range.to ? formatDate(data.range.to) : 'today'}</span>
              </span>
            ) : (
              <span className="font-semibold">All history</span>
            )
          }
        />
        <DocInfo left={['Customer', customer.name, customer.phone]} right={['Cancelled invoices', String(totals.count), `${formatCurrency(totals.total)} in total`]} />

        <div className="mt-6">
          {invoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">No cancelled invoices.</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="table-header-group">
                <tr className={`${DOC_THEAD_ROW} text-left`}>
                  <th className={DOC_TH}>Invoice</th>
                  <th className={DOC_TH}>Items</th>
                  <th className={`${DOC_TH} text-right`}>Total</th>
                  <th className={`${DOC_TH} text-right`}>Paid on it</th>
                  <th className={DOC_TH}>Cancelled</th>
                  <th className={DOC_TH}>Money went to</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-neutral-200 align-top">
                    <td className="px-2 py-2">
                      <Link to={`/receipt/${inv.id}`} state={{ backLabel: 'Cancelled Invoices' }} className="font-semibold text-brand-700 hover:underline">
                        {inv.receiptNumber}
                      </Link>
                      <span className="block text-neutral-500">{formatDate(inv.date)}</span>
                    </td>
                    <td className="px-2 py-2 text-neutral-700">
                      {inv.items.map((it, i) => (
                        <span key={i} className="block">
                          {it.name} × {it.quantity}
                        </span>
                      ))}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(inv.total)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <span className="font-semibold">{formatCurrency(inv.paid)}</span>
                      {inv.payments.map((p) => (
                        <span key={p.receiptNumber} className="block text-[11px] text-neutral-500">
                          {p.kind} {formatCurrency(p.amount)}
                        </span>
                      ))}
                      {inv.fromWallet > 0 && <span className="block text-[11px] text-neutral-500">From wallet {formatCurrency(inv.fromWallet)}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span className="block">{inv.cancelledAt ? formatDateTime(inv.cancelledAt) : '—'}</span>
                      {inv.reason && <span className="block text-[11px] text-neutral-500">{inv.reason}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-medium">{refundText(inv.refund, inv)}</span>
                      {inv.refund && <span className="block text-[11px] text-neutral-500">{formatCurrency(inv.refund.amount)}{inv.refund.byName ? ` · by ${inv.refund.byName}` : ''}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-6 border-t border-dashed border-neutral-300 pt-4" style={{ pageBreakInside: 'avoid' }}>
          <DocTotals
            items={[
              ['Invoices cancelled', formatCurrency(totals.total)],
              ['Put in the wallet', formatCurrency(totals.toWallet)],
              ['Cash given back', formatCurrency(totals.cashBack)],
            ]}
          />
        </div>
        <DocFooter>Cancelled invoices are not on the Customer Statement.</DocFooter>
      </div>
    </div>
  );
}
