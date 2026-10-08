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
        <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-800">Return Receipt</p>
        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Customer</p>
            <p className="font-semibold text-slate-800">{sale.customerName}</p>
            {sale.customerPhone && <p className="text-slate-500">{sale.customerPhone}</p>}
          </div>
          <div className="text-right">
            <p className="text-slate-400">Return Receipt No.</p>
            <p className="font-semibold text-slate-800">{returnReceiptNumber}</p>
            <p className="text-slate-500">{formatDate(ret.createdAt)}, {formatTime(ret.createdAt)}</p>
          </div>
        </div>

        <div className="my-2 flex justify-between text-xs">
          <span className="text-slate-400">Original Invoice</span>
          <Link to={`/receipt/${id}`} className="font-semibold text-brand-600 no-print">{sale.receiptNumber}</Link>
          <span className="hidden font-semibold text-slate-800 print:inline">{sale.receiptNumber}</span>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
              <th className="w-6 py-1 font-medium">No</th>
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 text-center font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Price</th>
              <th className="py-1 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {ret.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1.5 text-slate-500">{i + 1}</td>
                <td className="py-1.5 text-slate-700">{item.name}</td>
                <td className="py-1.5 text-center text-slate-600">{item.quantity}</td>
                <td className="py-1.5 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency(item.quantity * item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Return Value</span>
            <span>{formatCurrency(ret.amount)}</span>
          </div>
          {ret.debtReduced > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Applied Against Debt</span>
              <span>{formatCurrency(ret.debtReduced)}</span>
            </div>
          )}
          {ret.walletRefund > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Returned to Wallet</span>
              <span>{formatCurrency(ret.walletRefund)}</span>
            </div>
          )}
          {ret.refund > 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Refunded</span>
              <span>{formatCurrency(ret.refund)}</span>
            </div>
          )}
          {ret.reason && (
            <div className="flex justify-between text-slate-600">
              <span>Reason</span>
              <span>{ret.reason}</span>
            </div>
          )}

          <div className="my-1.5 border-t border-dotted border-slate-200" />

          <div className="flex justify-between text-slate-500">
            <span>New Invoice Balance</span>
            <span>{formatCurrency(invoiceBalanceAfter)}</span>
          </div>
          <div className="flex justify-between rounded-md bg-slate-50 px-2 py-1.5 font-bold text-slate-700">
            <span>New Customer Debt</span>
            <span>{formatCurrency(customerBalanceAfter)}</span>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />
        <p className="text-center text-[11px] text-slate-400">This is a return receipt, not a new invoice.</p>
      </div>
    </div>
  );
}
