import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import logo from '../../images/logo.png';

// One receipt for a payment spread across several of a supplier's invoices.
// Figures are what was recorded at payment time; an invoice's share edited
// or deleted later is flagged on its line.
export default function BulkPaymentReceiptPage() {
  const { bulkId } = useParams();
  const [bulk, setBulk] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get(`/purchases/bulk-payments/${bulkId}`)
      .then((res) => setBulk(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Bulk payment not found.'));
  }, [bulkId]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!bulk) return <PageSpinner />;

  const owedAfter = bulk.selectedOwed - bulk.amount;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/purchases" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Invoices
        </Link>
        <Button onClick={printA5}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

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
        <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-800">Bulk Payment Receipt</p>
        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Paid to supplier</p>
            <p className="font-semibold text-slate-800">{bulk.supplierName}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">Receipt No.</p>
            <p className="font-semibold text-slate-800">{bulk.bulkNumber}</p>
            <p className="text-slate-500">{formatDate(bulk.paymentDate)}</p>
          </div>
        </div>
        <div className="mt-2 flex justify-between text-xs">
          <span className="text-slate-400">Paid from account</span>
          <span className="font-semibold text-slate-800">{bulk.paymentAccountName}</span>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
              <th className="py-1 font-medium">Invoice</th>
              <th className="py-1 text-right font-medium">Owed before</th>
              <th className="py-1 text-right font-medium">Paid</th>
              <th className="py-1 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {bulk.allocations.map((a) => (
              <tr key={a.purchase} className="border-b border-slate-50 align-top">
                <td className="py-1.5 text-slate-700">
                  <Link to={`/purchases/${a.purchase}`} className="font-medium text-indigo-600 hover:underline print:text-slate-800 print:no-underline">
                    {a.purchaseNumber}
                  </Link>
                  <div className="mt-0.5">
                    <Badge color={a.status === 'Paid' ? 'green' : 'amber'}>{a.status}</Badge>
                  </div>
                  {a.paymentStatus === 'REVERSED' && <p className="mt-0.5 text-[10px] font-semibold text-rose-600">Deleted later</p>}
                  {a.paymentStatus === 'POSTED' && a.currentAmount !== a.amount && (
                    <p className="mt-0.5 text-[10px] font-semibold text-amber-600">Edited later to {formatCurrency(a.currentAmount)}</p>
                  )}
                </td>
                <td className="py-1.5 text-right text-slate-600">{formatCurrency(a.previousBalance)}</td>
                <td className="py-1.5 text-right font-semibold text-slate-800">{formatCurrency(a.amount)}</td>
                <td className="py-1.5 text-right text-slate-600">{formatCurrency(a.newBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-600">
            <span>Owed on selected invoices</span>
            <span>{formatCurrency(bulk.selectedOwed)}</span>
          </div>
          {bulk.percentage != null && (
            <div className="flex justify-between text-slate-600">
              <span>Percentage paid</span>
              <span>{bulk.percentage}%</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Total paid</span>
            <span>{formatCurrency(bulk.amount)}</span>
          </div>
          <div className="flex justify-between rounded-md bg-rose-50 px-2 py-1.5 font-bold text-rose-700">
            <span>Still owed on these invoices</span>
            <span>{formatCurrency(owedAfter)}</span>
          </div>
        </div>

        {bulk.note && (
          <>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">Note: </span>
              {bulk.note}
            </p>
          </>
        )}

        <div className="my-3 border-t border-dashed border-slate-300" />
        <p className="text-center text-[11px] text-slate-400">
          Recorded {formatDateTime(bulk.createdAt)}
          {bulk.createdByName ? ` by ${bulk.createdByName}` : ''}
        </p>
      </div>
    </div>
  );
}
