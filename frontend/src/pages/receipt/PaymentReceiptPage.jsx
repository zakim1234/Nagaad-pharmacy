import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocSummary, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

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
        <div className="flex gap-2">
          <SharePdfButton
            fileName={`Receipt-${payment.receiptNumber}`}
            phone={payment.customerPhone}
            message={`${BUSINESS.name} — Payment received ${formatCurrency(payment.amount)} (${payment.receiptNumber})`}
          />
          <Button onClick={printA5}>
            <Printer className="h-4 w-4" /> Print Receipt
          </Button>
        </div>
      </div>

      <div
        id="print-area"
        className="mx-auto max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-6 text-[13px] text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DocHeader compact title="Payment Receipt" meta={<span className="font-semibold">{payment.receiptNumber}</span>} />

        <DocInfo
          left={['Received from', payment.customerName, payment.customerPhone]}
          right={['Date', formatDate(payment.createdAt), formatTime(payment.createdAt)]}
        />

        <div className="mt-4 border-2 border-neutral-900 px-4 py-3 text-center" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Amount received</p>
          <p className="text-3xl font-extrabold tabular-nums text-brand-600">{formatCurrency(payment.amount)}</p>
          <p className="mt-0.5 text-[11px] text-neutral-500">into {payment.paymentAccountName || 'account not recorded (historical payment)'}</p>
        </div>

        {payment.allocations.length > 0 && (
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className={DOC_THEAD_ROW}>
                <th className={`${DOC_TH} text-left`}>Applied to invoice</th>
                <th className={`${DOC_TH} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payment.allocations.map((a, i) => (
                <tr key={i} className={docRow(i)}>
                  <td className="px-2 py-2 font-medium">{a.receiptNumber}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <DocSummary
          lines={[['Previous balance', formatCurrency(payment.previousBalance)], ['Paid now', `-${formatCurrency(payment.amount)}`]]}
          {...(payment.newBalance > 0
            ? { owed: ['Balance still owed', formatCurrency(payment.newBalance)] }
            : { grand: ['New balance', formatCurrency(payment.newBalance)] })}
        />

        {payment.notes && <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">{payment.notes}</p>}
        <DocFooter>Thank you for your payment!</DocFooter>
      </div>
    </div>
  );
}
