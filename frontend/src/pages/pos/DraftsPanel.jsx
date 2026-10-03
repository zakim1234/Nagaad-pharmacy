import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Printer, XCircle, Clock } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatTime } from '../../utils/format.js';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';

// The Seller's convenient access to today's still-editable invoices, per the
// Draft/Close-Day workflow: open (edit), print (clearly marked PENDING), or
// cancel -- never a silent edit/delete of a CONFIRMED sale.
export default function DraftsPanel({ drafts, loading, onChanged }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await client.post(`/sales/${cancelTarget.id}/cancel`, { reason: 'Cancelled by seller before Close Day' });
      toast.success(`Draft ${cancelTarget.receiptNumber} cancelled. Reserved stock released.`);
      setCancelTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this draft.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">Loading today's pending invoices...</p>;
  if (drafts.length === 0) return <p className="py-6 text-center text-sm text-slate-400">No pending invoices yet today.</p>;

  return (
    <div className="space-y-2">
      {drafts.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {d.receiptNumber} <span className="text-xs font-normal text-slate-400">· {d.customerName}</span>
              </p>
              <p className="text-xs text-slate-400">
                {formatTime(d.createdAt)} · {d.items.length} item(s) · Paid {formatCurrency(d.paidAmount)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold tabular-nums text-slate-800">{formatCurrency(d.total)}</span>
            <div className="flex gap-1">
              <button
                disabled={!!d.quotation}
                onClick={() => navigate(`/pos?edit=${d.id}`)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                title="Open / Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => navigate(`/receipt/${d.id}`)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                title="Print"
              >
                <Printer className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCancelTarget(d)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                title="Cancel"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel Draft Invoice"
        message={`Cancel draft "${cancelTarget?.receiptNumber}"? Its reserved stock and pending payment will be released. This invoice is kept in history as Cancelled.`}
        confirmLabel="Cancel Draft"
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
