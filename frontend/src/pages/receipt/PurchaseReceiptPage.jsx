import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import logo from '../../images/logo.png';

export default function PurchaseReceiptPage() {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client
      .get(`/purchases/${id}`)
      .then((res) => setPurchase(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Purchase invoice not found.'));
  }, [id]);

  useEffect(() => load(), [load]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!purchase) return <PageSpinner />;

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

        <div className="flex items-center justify-between">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-800">Purchase Invoice</p>
          {purchase.status === 'voided' && <Badge color="red">VOIDED</Badge>}
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Supplier</p>
            <p className="font-semibold text-slate-800">{purchase.supplierName}</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">Internal Invoice No.</p>
            <p className="font-semibold text-slate-800">{purchase.purchaseNumber}</p>
            <p className="text-slate-500">
              {formatDate(purchase.createdAt)}, {formatTime(purchase.createdAt)}
            </p>
          </div>
        </div>
        {purchase.supplierInvoiceNumber && (
          <div className="mt-2 flex justify-between text-xs">
            <span className="text-slate-400">Supplier Invoice No.</span>
            <span className="font-semibold text-slate-800">{purchase.supplierInvoiceNumber}</span>
          </div>
        )}

        <div className="my-3 border-t border-dashed border-slate-300" />

        {purchase.items.length > 0 && <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
              <th className="w-6 py-1 font-medium">No</th>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 text-center font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Unit Cost</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((item, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1.5 text-slate-500">{i + 1}</td>
                <td className="py-1.5 text-slate-700">{item.name}</td>
                <td className="py-1.5 text-center text-slate-600">{item.quantity}</td>
                <td className="py-1.5 text-right text-slate-600">{formatCurrency(item.unitCost)}</td>
                <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>}

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-sm font-bold text-slate-900">
            <span>Total Amount</span>
            <span>{formatCurrency(purchase.totalCost)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>Paid</span>
            <span>{formatCurrency(purchase.paidAmount)}</span>
          </div>
          {purchase.paymentAccountName && (
            <div className="flex justify-between text-slate-500">
              <span>Payment Account</span>
              <span>{purchase.paymentAccountName}</span>
            </div>
          )}
          {purchase.balance > 0 && (
            <div className="flex justify-between rounded-md bg-rose-50 px-2 py-1.5 font-bold text-rose-700">
              <span>Balance Owed to Supplier</span>
              <span>{formatCurrency(purchase.balance)}</span>
            </div>
          )}
        </div>

        {purchase.notes && (
          <>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">Notes: </span>
              {purchase.notes}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
