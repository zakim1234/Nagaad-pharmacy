import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import CancelPaymentDialog from './CancelPaymentDialog.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { PlanPrintSheet, PaidPlan, planPrintRows, round2 } from './VendorPlanShared.jsx';

// One saved Vendor Balance Summary sheet, from the history list: view it
// again and print it as it was.
export default function VendorPlanPage() {
  const { planId } = useParams();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = user?.role === 'admin' || user?.role === 'manager';

  const cancel = async (reason) => {
    setCancelling(true);
    try {
      const res = await client.post(`/purchases/payment-plans/${planId}/cancel`, { reason });
      toast.success(`${res.data.data.planNumber} cancelled — ${formatCurrency(res.data.data.refunded)} back in ${res.data.data.paymentAccountName}.`);
      setCancelOpen(false);
      setPlan(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel these payments.');
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    client
      .get(`/purchases/payment-plans/${planId}`)
      .then((res) => setPlan(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Sheet not found.'));
  }, [planId]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!plan) return <PageSpinner />;

  const paid = plan.status === 'PAID' || plan.status === 'CANCELLED';
  const owed = round2(plan.rows.reduce((s, r) => s + r.owed, 0));

  return (
    <div>
      <div className="no-print">
        <Link to="/purchases/vendor-balances" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Vendor Balances
        </Link>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              {plan.planNumber}
              {plan.status === 'CANCELLED' ? <Badge color="red">Cancelled</Badge> : <Badge color={paid ? 'green' : 'amber'}>{paid ? 'Paid' : 'Not paid yet'}</Badge>}
            </h1>
            <p className="text-sm text-slate-500">
              Vendor Balance Summary · {formatDate(paid ? plan.paymentDate : plan.updatedAt)}
              {plan.note ? ` · ${plan.note}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {canCancel && plan.status === 'PAID' && (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                <Undo2 className="h-4 w-4" /> Cancel payments
              </Button>
            )}
            <SharePdfButton fileName={`Vendor-Balances_${plan.planNumber}`} message={`Vendor Balance Summary ${plan.planNumber}`} />
            <Button variant="secondary" onClick={() => printReport('portrait')}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </div>

        <CancelPaymentDialog
          open={cancelOpen}
          title={`Cancel all payments of ${plan.planNumber}`}
          amount={plan.rows.filter((r) => !r.cancelled).reduce((s, r) => s + r.paid, 0)}
          account={plan.paymentAccountName}
          loading={cancelling}
          onConfirm={cancel}
          onClose={() => setCancelOpen(false)}
        />

        {paid ? (
          <PaidPlan plan={plan} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <p className="border-b border-slate-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-700">
              This sheet is still being prepared. Edit or pay it from{' '}
              <Link to="/purchases/vendor-balances" className="font-semibold underline">
                Vendor Balances
              </Link>
              .
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-12 px-5 py-2.5 font-medium">#</th>
                  <th className="px-5 py-2.5 font-medium">Supplier</th>
                  <th className="px-5 py-2.5 text-right font-medium">Balance</th>
                  <th className="px-5 py-2.5 text-right font-medium">Allocation</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => (
                  <tr key={String(r.supplier)} className="border-t border-slate-100">
                    <td className="px-5 py-2.5 text-slate-400">{i + 1}</td>
                    <td className="px-5 py-2.5 font-medium text-slate-800">{r.supplierName}</td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{formatCurrency(r.owed)}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-brand-700">{formatCurrency(r.allocation)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                  <td className="px-5 py-3" colSpan={2}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right">{formatCurrency(owed)}</td>
                  <td className="px-5 py-3 text-right text-brand-700">{formatCurrency(plan.totalAllocated)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <PlanPrintSheet rows={planPrintRows(plan)} date={formatDate(paid ? plan.paymentDate : plan.updatedAt)} planNumber={plan.planNumber} paid={paid} />
    </div>
  );
}
