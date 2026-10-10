import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocSummary, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

// A goods invoice from a supplier. What we owe is tracked against the
// supplier's total (see their Statement), so only the invoice amount is
// shown here.
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
  const voided = purchase.status === 'voided';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between no-print">
        <Link to={`/purchases?supplier=${purchase.supplier}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to {purchase.supplierName}
        </Link>
        <div className="flex gap-2">
          <SharePdfButton
            fileName={`Purchase-${purchase.purchaseNumber}`}
            message={`${BUSINESS.name} — goods invoice ${purchase.supplierInvoiceNumber || purchase.purchaseNumber}: ${formatCurrency(purchase.totalCost)}`}
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
        <DocHeader compact title={voided ? 'Purchase Invoice · Voided' : 'Purchase Invoice'} meta={<span className="font-semibold">{purchase.purchaseNumber}</span>} />

        <DocInfo
          left={['Supplier', purchase.supplierName, purchase.supplierInvoiceNumber && `Their invoice No. ${purchase.supplierInvoiceNumber}`]}
          right={['Date', formatDate(purchase.purchaseDate || purchase.createdAt), formatTime(purchase.createdAt)]}
        />

        {purchase.items.length > 0 && (
          <table className="mt-4 w-full border-collapse text-xs">
            <thead>
              <tr className={DOC_THEAD_ROW}>
                <th className={`${DOC_TH} w-8 text-left`}>#</th>
                <th className={`${DOC_TH} text-left`}>Description</th>
                <th className={`${DOC_TH} text-center`}>Qty</th>
                <th className={`${DOC_TH} text-right`}>Unit cost</th>
                <th className={`${DOC_TH} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((item, i) => (
                <tr key={i} className={docRow(i)}>
                  <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{item.name}</td>
                  <td className="px-2 py-2 text-center">{item.quantity}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(item.unitCost)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <DocSummary grand={['Invoice amount', formatCurrency(purchase.totalCost)]} />

        {voided && <p className="mt-3 text-center text-xs font-semibold text-brand-600">This invoice was voided and is not owed.</p>}
        {purchase.notes && (
          <p className="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <span className="font-semibold">Notes:</span> {purchase.notes}
          </p>
        )}
      </div>
    </div>
  );
}
