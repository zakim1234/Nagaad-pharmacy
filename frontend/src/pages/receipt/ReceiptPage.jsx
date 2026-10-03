import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft, Pencil, XCircle, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import logo from '../../images/logo.png';

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
        className="mx-auto max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-6 text-[13px] shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <div className="flex flex-col items-center text-center">
          <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
          <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
          <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
          <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-800">Sales Invoice</p>
        {sale.status === 'DRAFT' && (
          <p className="mt-1 text-center text-[11px] font-medium text-amber-600 no-print">
            This invoice is PENDING and will only become final when the business day is closed.
          </p>
        )}
        {sale.status === 'CANCELLED' && sale.cancelledReason && (
          <p className="mt-1 text-center text-[11px] font-medium text-rose-600 no-print">Reason: {sale.cancelledReason}</p>
        )}

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Customer</p>
            <p className="font-semibold text-slate-800">{sale.customerName}</p>
            {sale.customerPhone && <p className="text-slate-500">{sale.customerPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-slate-400">Invoice No.</p>
            <p className="font-semibold text-slate-800">{sale.receiptNumber}</p>
            <p className="text-slate-500">{formatDate(sale.createdAt)}, {formatTime(sale.createdAt)}</p>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
              <th className="w-6 py-1 font-medium">No</th>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 text-center font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Price</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1.5 text-slate-500">{i + 1}</td>
                <td className="py-1.5 text-slate-700">{item.name}</td>
                <td className="py-1.5 text-center text-slate-600">{item.quantity}</td>
                <td className="py-1.5 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatCurrency(sale.subtotal)}</span>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Discount</span>
              <span>-{formatCurrency(sale.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Grand Total</span>
            <span>{formatCurrency(sale.total)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Paid</span>
            <span>{formatCurrency(sale.paidAmount)}</span>
          </div>
          {sale.paidAmount > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Payment Method</span>
              <span>{sale.paymentAccountName || '—'}</span>
            </div>
          )}
          {sale.total - sale.paidAmount > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Balance</span>
              <span>{formatCurrency(sale.total - sale.paidAmount)}</span>
            </div>
          )}

          <div className="my-1.5 border-t border-dotted border-slate-200" />

          <div className="flex justify-between text-slate-500">
            <span>Previous Balance</span>
            <span>{formatCurrency(sale.previousBalance)}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>Balance From This Sale</span>
            <span>{formatCurrency(sale.balanceAdded)}</span>
          </div>
          <div className="flex justify-between rounded-md bg-rose-50 px-2 py-1.5 font-bold text-rose-700">
            <span>Current Outstanding Balance</span>
            <span>{formatCurrency(currentOutstanding)}</span>
          </div>
        </div>

        {sale.notes && (
          <>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="text-xs text-slate-600"><span className="font-semibold">Notes:</span> {sale.notes}</p>
          </>
        )}
        <div className="my-3 border-t border-dashed border-slate-300" />
        <p className="text-center text-[11px] text-slate-400">Thank you for your business!</p>
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
                <Link to={`/receipt/${sale.id}/return/${r.index}`} className="font-semibold text-indigo-600 hover:underline">
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
