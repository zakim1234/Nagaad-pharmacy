import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import logo from '../../images/logo.png';

export default function PaymentReceiptPage() {
  const { id } = useParams();
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get(`/payments/${id}/receipt`)
      .then((res) => setPayment(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Payment receipt not found.'));
  }, [id]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!payment) return <PageSpinner />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/customers" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <Button onClick={printA5}>
          <Printer className="h-4 w-4" /> Print Receipt
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

        <p className="text-center text-sm font-bold uppercase tracking-widest text-emerald-700">Payment Receipt</p>

        <div className="mt-3 flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Customer</p>
            <p className="font-semibold text-slate-800">{payment.customerName}</p>
            {payment.customerPhone && <p className="text-slate-500">{payment.customerPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-slate-400">Receipt No.</p>
            <p className="font-semibold text-slate-800">{payment.receiptNumber}</p>
            <p className="text-slate-500">{formatDate(payment.createdAt)}, {formatTime(payment.createdAt)}</p>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-center">
          <p className="text-xs text-emerald-700">Amount Received</p>
          <p className="text-2xl font-bold text-emerald-700">{formatCurrency(payment.amount)}</p>
        </div>

        <p className="mt-3 text-sm">Payment Account: <strong>{payment.paymentAccountName || 'Not recorded (historical payment)'}</strong></p>
        {payment.allocations.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Applied To</p>
            <table className="w-full text-xs">
              <tbody>
                {payment.allocations.map((a, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1 text-slate-700">{a.receiptNumber}</td>
                    <td className="py-1 text-right font-medium text-slate-800">{formatCurrency(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>Previous Balance</span>
            <span>{formatCurrency(payment.previousBalance)}</span>
          </div>
          <div className="flex justify-between rounded-md bg-slate-50 px-2 py-1.5 font-bold text-slate-800">
            <span>New Balance</span>
            <span className={payment.newBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(payment.newBalance)}</span>
          </div>
        </div>

        {payment.notes && <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-600">{payment.notes}</p>}

        <div className="my-3 border-t border-dashed border-slate-300" />
        <p className="text-center text-[11px] text-slate-400">Thank you for your payment!</p>
      </div>
    </div>
  );
}
