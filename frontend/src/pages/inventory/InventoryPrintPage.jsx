import BatchHistory from '../../components/BatchHistory.jsx';
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printPage } from '../../utils/print.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import logo from '../../images/logo.png';

export default function InventoryPrintPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client
      .get(`/inventory/${id}`)
      .then((res) => setItem(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Item not found.'));
  }, [id]);

  useEffect(() => load(), [load]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!item) return <PageSpinner />;

  const history = item.purchaseHistory || [];
  const hasLongHistory = true;
  const pageSize = hasLongHistory ? 'A4' : 'A5';
  // Stock Value = current quantity x current Weighted Average Cost -- never
  // a batch/lot-level valuation, per the WAC costing rule (a lot's own
  // original unitCostCents is historical/traceability data, not today's
  // inventory value).
  const totalCostValue = item.quantity * item.costPrice;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to="/inventory" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Inventory
        </Link>
        <Button onClick={() => printPage(pageSize)}>
          <Printer className="h-4 w-4" /> Print
        </Button>
      </div>

      <div
        id="print-area"
        className={`mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-[13px] shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none ${
          hasLongHistory ? 'max-w-[210mm] print:max-w-none' : 'max-w-[148mm] print:max-w-none'
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
          <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
          <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
          <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <div className="flex justify-between text-xs">
          <div>
            <p className="text-slate-400">Document</p>
            <p className="font-semibold text-slate-800">Inventory Item Record</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400">Item ID</p>
            <p className="font-semibold text-slate-800">{item.itemCode}</p>
            <p className="text-slate-500">Printed {formatDateTime(new Date())}</p>
          </div>
        </div>

        <div className="my-3 border-t border-dashed border-slate-300" />

        <table className="w-full text-xs">
          <tbody>
            <tr className="border-b border-slate-50">
              <td className="w-1/3 py-1.5 text-slate-400">Item Name</td>
              <td className="py-1.5 font-medium text-slate-800">{item.name}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Serial Number</td>
              <td className="py-1.5 font-medium text-slate-800">{item.serialNumber || '—'}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Category</td>
              <td className="py-1.5 text-slate-700">{item.category?.name || 'Uncategorized'}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Supplier</td>
              <td className="py-1.5 text-slate-700">{item.supplier?.name || '—'}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Quantity In Stock</td>
              <td className="py-1.5 text-slate-700">
                {item.quantity} {item.unit}
              </td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Average Cost</td>
              <td className="py-1.5 text-slate-700">{formatCurrency(item.costPrice)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Selling Price</td>
              <td className="py-1.5 text-slate-700">{formatCurrency(item.sellingPrice)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Stock Value (Qty × Avg Cost)</td>
              <td className="py-1.5 font-semibold text-slate-800">{formatCurrency(totalCostValue)}</td>
            </tr>
            <tr className="border-b border-slate-50">
              <td className="py-1.5 text-slate-400">Created / Entry Date</td>
              <td className="py-1.5 text-slate-700">{formatDateTime(item.createdAt)}</td>
            </tr>
            {item.expiryDate && (
              <tr className="border-b border-slate-50">
                <td className="py-1.5 text-slate-400">Expiry Date</td>
                <td className="py-1.5 text-slate-700">{formatDate(item.expiryDate)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <BatchHistory item={item} />
        {history.length > 0 && (
          <>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase History</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
                  <th className="py-1 font-medium">Purchase No.</th>
                  <th className="py-1 font-medium">Supplier</th>
                  <th className="py-1 text-center font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Unit Cost</th>
                  <th className="py-1 text-right font-medium">Total</th>
                  <th className="py-1 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-1.5 text-slate-700">{h.purchaseNumber}</td>
                    <td className="py-1.5 text-slate-600">{h.supplierName}</td>
                    <td className="py-1.5 text-center text-slate-600">{h.quantity}</td>
                    <td className="py-1.5 text-right text-slate-600">{formatCurrency(h.unitCost)}</td>
                    <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency(h.total)}</td>
                    <td className="py-1.5 text-right text-slate-500">{formatDate(h.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="my-3 border-t border-dashed border-slate-300" />
        <p className="text-center text-[11px] text-slate-400">This is an internal inventory record, not a customer receipt.</p>
      </div>
    </div>
  );
}
