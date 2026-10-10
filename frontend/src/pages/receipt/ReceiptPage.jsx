import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, Pencil, XCircle, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DocHeader, { DocInfo, DocSummary, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import { BUSINESS } from '../../constants/business.js';

export default function ReceiptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [sale, setSale] = useState(null);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    client
      .get(`/sales/${id}/receipt`)
      .then((res) => setSale(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Receipt not found.'));
  }, [id]);

  useEffect(() => load(), [load]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await client.post(`/sales/${id}/cancel`, { reason: 'Cancelled by seller' });
      toast.success('Draft invoice cancelled.');
      setCancelOpen(false);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this draft.');
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!sale) return <PageSpinner />;

  const currentOutstanding = sale.newBalance;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/pos" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to POS
        </Link>
        <div className="flex gap-2">
          {sale.status === 'DRAFT' && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/pos?edit=${sale.id}`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                <XCircle className="h-4 w-4" /> Cancel
              </Button>
            </>
          )}
          <SharePdfButton fileName={`Invoice-${sale.receiptNumber}`} phone={sale.customerPhone} message={`${BUSINESS.name} — Invoice ${sale.receiptNumber}: ${formatCurrency(sale.total)}`} />
          <Button onClick={printA5}>
            <Printer className="h-4 w-4" /> Print Invoice
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel Draft Invoice"
        message="Cancel this draft invoice? Reserved stock and any pending payment will be released."
        confirmLabel="Cancel Draft"
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setCancelOpen(false)}
      />

      <div
        id="print-area"
        className="mx-auto max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-6 text-[13px] text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DocHeader
          compact
          title={sale.status === 'CANCELLED' ? 'Sales Invoice · Cancelled' : 'Sales Invoice'}
          meta={<span className="font-semibold">{sale.receiptNumber}</span>}
        />
        {sale.status === 'DRAFT' && (
          <p className="mt-2 text-center text-[11px] font-medium text-amber-600 no-print">
            This invoice is PENDING and will only become final when the business day is closed.
          </p>
        )}
        {sale.status === 'CANCELLED' && sale.cancelledReason && (
          <p className="mt-2 text-center text-[11px] font-medium text-rose-600 no-print">Reason: {sale.cancelledReason}</p>
        )}

        <DocInfo
          left={['Bill to', sale.customerName, sale.customerPhone]}
          right={['Date', formatDate(sale.createdAt), formatTime(sale.createdAt)]}
        />

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className={DOC_THEAD_ROW}>
              <th className={`${DOC_TH} w-8 text-left`}>#</th>
              <th className={`${DOC_TH} text-left`}>Description</th>
              <th className={`${DOC_TH} text-center`}>Qty</th>
              <th className={`${DOC_TH} text-right`}>Price</th>
              <th className={`${DOC_TH} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, i) => (
              <tr key={i} className={docRow(i)}>
                <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                <td className="px-2 py-2 font-medium">{item.name}</td>
                <td className="px-2 py-2 text-center">{item.quantity}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <DocSummary
          lines={[
            ['Subtotal', formatCurrency(sale.subtotal)],
            sale.discount > 0 && ['Discount', `-${formatCurrency(sale.discount)}`],
          ]}
          grand={['Grand Total', formatCurrency(sale.total)]}
        />
        <DocSummary
          lines={[
            ['Paid', formatCurrency(sale.paidAmount)],
            sale.paidAmount > 0 && ['Payment method', sale.paymentAccountName || '—'],
            sale.total - sale.paidAmount > 0 && ['Balance on this invoice', formatCurrency(sale.total - sale.paidAmount)],
            ['Previous balance', formatCurrency(sale.previousBalance)],
            ['Balance from this sale', formatCurrency(sale.balanceAdded)],
          ]}
          owed={['Current outstanding balance', formatCurrency(currentOutstanding)]}
        />

        {sale.notes && (
          <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <span className="font-semibold">Notes:</span> {sale.notes}
          </p>
        )}
        <DocFooter>Thank you for your business!</DocFooter>
      </div>

      {sale.returns?.length > 0 && (
        <div className="mx-auto mt-4 max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-4 text-sm no-print">
          <p className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
            <Undo2 className="h-4 w-4" /> Returns on This Invoice ({sale.returns.length})
          </p>
          <div className="space-y-1.5">
            {sale.returns.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                <span className="text-slate-500">{formatDate(r.createdAt)} · {formatCurrency(r.amount)}</span>
                <Link to={`/receipt/${sale.id}/return/${r.index}`} className="font-semibold text-brand-600 hover:underline">
                  View / Print
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
