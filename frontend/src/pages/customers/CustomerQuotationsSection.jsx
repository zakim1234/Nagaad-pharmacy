import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge, { quotationStatusBadge } from '../../components/ui/Badge.jsx';
import { FormField, Select } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import logo from '../../images/logo.png';

const STATUSES = ['Pending', 'Accepted', 'Rejected', 'Expired', 'Converted'];

// Reads only from the existing Quotation collection (Quotation.customer),
// the same records shown on the main Quotations page and the same
// /quotations/:id detail/print route -- nothing here is a separate copy.
// Quotations never touch Stock/Accounts/Close Day; this section is read-only.
export default function CustomerQuotationsSection({ customerId, customer }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    client
      .get('/quotations', { params: { customer: customerId, status: status || undefined, page, limit: 20 } })
      .then((res) => { if (active) setResult(res.data); })
      .catch((err) => { if (active) { setResult(null); toast.error(err.friendlyMessage || 'Failed to load quotations.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setPage(1), [status]);

  const quotations = result?.data || [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 no-print">
        <FormField label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </FormField>
        <Button variant="secondary" onClick={() => printReport('portrait')} disabled={quotations.length === 0}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <div id="print-area">
        {/* Screen view: a compact, scannable summary per quotation. Full
            product/price detail lives on the existing /quotations/:id page
            (see the "View / Print" link) rather than being dumped here. */}
        <Card className="no-print" title={`Quotations (${result?.pagination.total ?? quotations.length})`}>
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading...</p>
          ) : !result ? (
            <p className="py-8 text-center text-sm text-slate-400">Unable to load quotations. Please refresh.</p>
          ) : quotations.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              {status ? `No ${status.toLowerCase()} quotations for this customer.` : 'No quotations found for this customer yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {quotations.map((q) => {
                const badge = quotationStatusBadge(q.status);
                return (
                  <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                    <div>
                      <Link to={`/quotations/${q.id}`} className="text-sm font-semibold text-indigo-600 hover:underline">
                        {q.quotationNumber}
                      </Link>
                      <p className="text-xs text-slate-400">
                        {formatDate(q.date)} · Expires {formatDate(q.expiryDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge color={badge.color}>{badge.label}</Badge>
                      <span className="text-sm font-semibold tabular-nums text-slate-800">{formatCurrency(q.grandTotal)}</span>
                      <Link to={`/quotations/${q.id}`} className="text-xs font-semibold text-indigo-600 hover:underline">
                        View / Print
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {result && <div className="mt-3 no-print"><Pagination {...result.pagination} onChange={setPage} /></div>}
        </Card>

        {/* Print-only: a full itemized document per quotation so a filtered
            or "all" print produces real quotation documents, not the
            summary list above. Reuses the same branding as every other
            printed document in the app. */}
        <div className="hidden print:block">
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt={BUSINESS.name} className="h-14 w-auto object-contain" />
            <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
            <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
            <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
          </div>
          <div className="my-3 border-t border-dashed border-slate-300" />
          <p className="text-center text-base font-bold uppercase tracking-wide text-slate-900">Customer Quotation Statement</p>
          <div className="my-3 flex flex-wrap items-start justify-between gap-4 text-xs">
            <div>
              <p className="text-slate-400">Customer</p>
              <p className="font-semibold text-slate-800">{customer?.name}</p>
              {customer?.phone && <p className="text-slate-500">{customer.phone}</p>}
            </div>
            <div className="text-right">
              <p className="text-slate-400">Status Filter</p>
              <p className="font-semibold text-slate-800">{status || 'All'}</p>
            </div>
          </div>
          <div className="border-t border-dashed border-slate-300" />

          {quotations.map((q) => (
            <div key={q.id} className="mt-4" style={{ breakInside: 'avoid' }}>
              <div className="my-2 flex flex-wrap items-start justify-between gap-4 text-xs">
                <div>
                  <p className="text-slate-400">Quotation</p>
                  <p className="font-semibold text-slate-800">{q.quotationNumber}</p>
                  <p className="mt-1 text-slate-400">Status</p>
                  <p className="font-semibold text-slate-800">{q.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-400">Date</p>
                  <p className="font-semibold text-slate-800">{formatDate(q.date)}</p>
                  <p className="mt-1 text-slate-400">Expiry Date</p>
                  <p className="font-semibold text-slate-800">{formatDate(q.expiryDate)}</p>
                </div>
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-y border-slate-300">
                    {['No', 'Item', 'Qty', 'Unit Price', 'Discount', 'Line Total'].map((h) => (
                      <th className="p-1.5 font-medium" key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it, i) => (
                    <tr key={it.itemId} className="border-b border-slate-100">
                      <td className="p-1.5">{i + 1}</td>
                      <td className="p-1.5">{it.name}</td>
                      <td className="p-1.5">{it.quantity}</td>
                      <td className="p-1.5">{formatCurrency(it.unitPrice)}</td>
                      <td className="p-1.5">{formatCurrency(it.discount)}</td>
                      <td className="p-1.5">{formatCurrency(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto mt-1.5 max-w-xs space-y-1 text-xs">
                <p className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(q.subtotal)}</span></p>
                <p className="flex justify-between"><span>Total Discount</span><span>{formatCurrency(q.totalDiscount)}</span></p>
                <p className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Grand Total</span><span>{formatCurrency(q.grandTotal)}</span></p>
              </div>
              {q.notes && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-slate-600">Notes: {q.notes}</p>}
              <div className="mt-3 border-t border-dashed border-slate-300" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
