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

// Renders one persisted entry from Sale.returns[] as a small, receipt-size
// document. Reprintable at any time later since it reads straight from the
// Sale document -- nothing here lives only in transient frontend state. A
// return's index is stable (returns are only ever appended), so this route
// is a durable reference to that specific return.
export default function ReturnReceiptPage() {
  const { id, index } = useParams();
  const [sale, setSale] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get(`/sales/${id}/receipt`)
      .then((res) => setSale(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Receipt not found.'));
  }, [id]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!sale) return <PageSpinner />;

  const ret = sale.returns[Number(index)];
  if (!ret) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">This return could not be found on this invoice.</div>;

  const returnReceiptNumber = `${sale.receiptNumber}-R${Number(index) + 1}`;
  const invoiceBalanceAfter = ret.invoiceBalanceAfter ?? sale.outstanding;
  const customerBalanceAfter = ret.customerBalanceAfter ?? sale.newBalance;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to={`/receipt/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Invoice
        </Link>
        <div className="flex gap-2">
          <SharePdfButton
            fileName={`Return-${returnReceiptNumber}`}
            phone={sale.customerPhone}
            message={`${BUSINESS.name} — Return ${returnReceiptNumber}: ${formatCurrency(ret.amount)}`}
          />
          <Button onClick={printA5}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div
        id="print-area"
        className="mx-auto max-w-[148mm] rounded-2xl border border-slate-200 bg-white p-6 text-[13px] text-neutral-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DocHeader compact title="Return Receipt" meta={<span className="font-semibold">{returnReceiptNumber}</span>} />

        <DocInfo
          left={['Customer', sale.customerName, sale.customerPhone]}
          right={['Date', formatDate(ret.createdAt), `${formatTime(ret.createdAt)} · Invoice ${sale.receiptNumber}`]}
        />

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className={DOC_THEAD_ROW}>
              <th className={`${DOC_TH} w-8 text-left`}>#</th>
              <th className={`${DOC_TH} text-left`}>Item returned</th>
              <th className={`${DOC_TH} text-center`}>Qty</th>
              <th className={`${DOC_TH} text-right`}>Price</th>
              <th className={`${DOC_TH} text-right`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {ret.items.map((item, i) => (
              <tr key={i} className={docRow(i)}>
                <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                <td className="px-2 py-2 font-medium">{item.name}</td>
                <td className="px-2 py-2 text-center">{item.quantity}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(item.quantity * item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <DocSummary
          lines={[
            ret.debtReduced > 0 && ['Applied against debt', formatCurrency(ret.debtReduced)],
            ret.walletRefund > 0 && ['Returned to wallet', formatCurrency(ret.walletRefund)],
            ret.refund > 0 && ['Refunded', formatCurrency(ret.refund)],
            ret.reason && ['Reason', ret.reason],
          ]}
          grand={['Return value', formatCurrency(ret.amount)]}
        />
        <DocSummary
          lines={[['New invoice balance', formatCurrency(invoiceBalanceAfter)]]}
          {...(customerBalanceAfter > 0
            ? { owed: ['Customer still owes', formatCurrency(customerBalanceAfter)] }
            : { grand: ['Customer balance', formatCurrency(customerBalanceAfter)] })}
        />

        <DocFooter>This is a return receipt, not a new invoice.</DocFooter>
      </div>
    </div>
  );
}
