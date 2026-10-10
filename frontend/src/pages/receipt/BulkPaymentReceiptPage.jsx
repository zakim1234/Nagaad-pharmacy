import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import CancelPaymentDialog from '../purchases/CancelPaymentDialog.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocFooter } from '../../components/docs/DocHeader.jsx';

// One receipt for a payment spread across several of a supplier's invoices.
// Figures are what was recorded at payment time; an invoice's share edited
// or deleted later is flagged on its line.
export default function BulkPaymentReceiptPage() {
  const { bulkId } = useParams();
  const [bulk, setBulk] = useState(null);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = user?.role === 'admin' || user?.role === 'manager';

  const cancel = async (reason) => {
    setCancelling(true);
    try {
      const res = await client.post(`/purchases/bulk-payments/${bulkId}/cancel`, { reason });
      toast.success(`${res.data.data.bulkNumber} cancelled — ${formatCurrency(res.data.data.refunded)} back in ${res.data.data.paymentAccountName}.`);
      setCancelOpen(false);
      const fresh = await client.get(`/purchases/bulk-payments/${bulkId}`);
      setBulk(fresh.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this payment.');
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    client
      .get(`/purchases/bulk-payments/${bulkId}`)
      .then((res) => setBulk(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Bulk payment not found.'));
  }, [bulkId]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!bulk) return <PageSpinner />;


  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/purchases" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Invoices
        </Link>
        <div className="flex gap-2">
          {canCancel && bulk.status !== 'CANCELLED' && (
            <Button variant="secondary" onClick={() => setCancelOpen(true)}>
              <Undo2 className="h-4 w-4" /> Cancel payment
            </Button>
          )}
          <SharePdfButton fileName={`Payment-${bulk.bulkNumber}`} message={`${BUSINESS.name} — payment ${formatCurrency(bulk.amount)} to ${bulk.supplierName}${bulk.receiptNo ? ` (receipt ${bulk.receiptNo})` : ''}`} />
          <Button onClick={printA5}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {bulk.status === 'CANCELLED' && (
        <div className="mx-auto mb-4 max-w-[148mm] rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <p className="font-bold">CANCELLED — the money went back to {bulk.paymentAccountName}.</p>
          <p className="text-xs">
            {formatDateTime(bulk.cancelledAt)}
            {bulk.cancelledByName ? ` by ${bulk.cancelledByName}` : ''}
            {bulk.cancelReason ? ` · ${bulk.cancelReason}` : ''}
          </p>
        </div>
      )}

      <CancelPaymentDialog
        open={cancelOpen}
        title={`Cancel ${bulk.bulkNumber}`}
        amount={bulk.allocations.reduce((s, a) => s + (a.paymentStatus === 'POSTED' ? a.currentAmount ?? a.amount : 0), 0)}
        account={bulk.paymentAccountName}
        loading={cancelling}
        onConfirm={cancel}
        onClose={() => setCancelOpen(false)}
      />

      <div
        id="print-area"
        className="mx-auto max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-6 text-[13px] text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DocHeader
          compact
          title={bulk.status === 'CANCELLED' ? 'Supplier Payment · Cancelled' : 'Supplier Payment'}
          meta={<span className="font-semibold">{bulk.bulkNumber}</span>}
        />

        <DocInfo
          left={['Paid to supplier', bulk.supplierName, bulk.receiptNo && `Their receipt No. ${bulk.receiptNo}`]}
          right={['Date', formatDate(bulk.paymentDate), `From ${bulk.paymentAccountName}`]}
        />

        <div className="mt-4 border-2 border-neutral-900 px-4 py-3 text-center" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Amount paid</p>
          <p className={`text-3xl font-extrabold tabular-nums ${bulk.status === 'CANCELLED' ? 'text-neutral-400 line-through' : 'text-brand-600'}`}>{formatCurrency(bulk.amount)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">Taken off what we owe {bulk.supplierName}</p>
        </div>

        {bulk.note && (
          <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <span className="font-semibold">Note:</span> {bulk.note}
          </p>
        )}

        <div className="mt-10 grid grid-cols-2 gap-10 text-[11px] text-neutral-600">
          <p className="border-t border-neutral-900 pt-1.5 text-center">Paid by ({BUSINESS.name})</p>
          <p className="border-t border-neutral-900 pt-1.5 text-center">Received by ({bulk.supplierName})</p>
        </div>

        <DocFooter>
          Recorded {formatDateTime(bulk.createdAt)}
          {bulk.createdByName ? ` by ${bulk.createdByName}` : ''}
        </DocFooter>
      </div>
    </div>
  );
}
