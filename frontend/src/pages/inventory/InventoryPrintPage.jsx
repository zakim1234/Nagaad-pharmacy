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
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocFooter } from '../../components/docs/DocHeader.jsx';

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
        <div className="flex gap-2">
          <SharePdfButton fileName={`Item-${item.itemCode}`} message={`${BUSINESS.name} — ${item.name} (${item.itemCode})`} />
          <Button onClick={() => printPage(pageSize)}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div
        id="print-area"
        className={`mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-[13px] shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none ${
          hasLongHistory ? 'max-w-[210mm] print:max-w-none' : 'max-w-[148mm] print:max-w-none'
        }`}
      >
        <DocHeader compact title="Inventory Item" meta={<span className="font-semibold">{item.itemCode}</span>} />
        <DocInfo left={['Item', item.name, item.serialNumber && `SN: ${item.serialNumber}`]} right={['Printed', formatDateTime(new Date())]} />

        <table className="mt-4 w-full border-collapse text-xs">
          <tbody>
            <tr className="border-b border-neutral-200">
              <td className="w-1/3 px-2 py-1.5 text-neutral-500">Item Name</td>
              <td className="py-1.5 font-medium text-slate-800">{item.name}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Serial Number</td>
              <td className="py-1.5 font-medium text-slate-800">{item.serialNumber || '—'}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Category</td>
              <td className="py-1.5 text-slate-700">{item.category?.name || 'Uncategorized'}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Supplier</td>
              <td className="py-1.5 text-slate-700">{item.supplier?.name || '—'}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Quantity In Stock</td>
              <td className="py-1.5 text-slate-700">
                {item.quantity} {item.unit}
              </td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Average Cost</td>
              <td className="py-1.5 text-slate-700">{formatCurrency(item.costPrice)}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Selling Price</td>
              <td className="py-1.5 text-slate-700">{formatCurrency(item.sellingPrice)}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Stock Value (Qty × Avg Cost)</td>
              <td className="py-1.5 font-semibold text-slate-800">{formatCurrency(totalCostValue)}</td>
            </tr>
            <tr className="border-b border-neutral-200">
              <td className="px-2 py-1.5 text-neutral-500">Created / Entry Date</td>
              <td className="py-1.5 text-slate-700">{formatDateTime(item.createdAt)}</td>
            </tr>
            {item.expiryDate && (
              <tr className="border-b border-neutral-200">
                <td className="px-2 py-1.5 text-neutral-500">Expiry Date</td>
                <td className="py-1.5 text-slate-700">{formatDate(item.expiryDate)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <BatchHistory item={item} />
        {history.length > 0 && (
          <>
            <div className="my-3 border-t border-dashed border-slate-300" />
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Purchase History</p>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-neutral-900 text-left text-[10px] uppercase tracking-wider text-neutral-500">
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

        <DocFooter>This is an internal inventory record, not a customer receipt.</DocFooter>
      </div>
    </div>
  );
}
