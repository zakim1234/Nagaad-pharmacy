import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW } from '../../components/docs/DocHeader.jsx';
import { REASONS } from './StockAdjustmentsPage.jsx';

const reasonLabel = (r) => REASONS[r]?.label || r;

// One save as one statement: every item adjusted together in it (a stock
// count, "Adjust All Items"), or a single adjustment -- what each changed and
// the totals. Printable and shareable.
export default function StockAdjustmentStatementPage() {
  const { number } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client
      .get(`/stock-adjustments/document/${encodeURIComponent(number)}`)
      .then((r) => setData(r.data.data))
      .catch((err) => {
        setError(err.friendlyMessage || 'Could not load this statement.');
        toast.error(err.friendlyMessage || 'Could not load this statement.');
      });
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="py-10 text-center text-sm text-neutral-500">{error}</p>;
  if (!data) return <PageSpinner />;
  const t = data.totals;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/stock-adjustments" className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-neutral-700">
          <ArrowLeft className="h-4 w-4" /> Back to Stock Adjustment
        </Link>
        <div className="flex gap-2">
          <SharePdfButton fileName={`Stock-Adjustment-${data.number}`} message={`${BUSINESS.name} — stock adjustment ${data.number}: ${t.items} item(s), net loss ${formatCurrency(t.netLoss)}`} />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-neutral-200/80 bg-white p-6 text-neutral-900 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader title="Stock Adjustment" meta={<span className="font-semibold">{data.number}</span>} />
        <DocInfo
          left={['Date', formatDateTime(data.date), `By ${data.by || '—'}`, data.note ? `Note: ${data.note}` : null].filter(Boolean)}
          right={['Items adjusted', String(t.items), data.isCount ? 'Saved together (Adjust All Items)' : 'Single adjustment']}
        />

        {data.undone && (
          <div className="mt-5 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm">
            <span className="font-bold uppercase tracking-wide text-neutral-700">Undone</span>
            <span className="text-neutral-600">
              {' '}
              — {data.undoneAt ? formatDateTime(data.undoneAt) : ''}
              {data.undoneBy ? ` by ${data.undoneBy}` : ''}
              {data.undoReason ? `: ${data.undoReason}` : ''}. The stock was put back; this no longer counts in Profit & Loss.
            </span>
          </div>
        )}

        <div className="mt-6">
          <table className="w-full border-collapse text-xs">
            <thead className="table-header-group">
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={DOC_TH}>Adjustment</th>
                <th className={DOC_TH}>Item</th>
                <th className={`${DOC_TH} text-right`}>Change</th>
                <th className={DOC_TH}>Stock</th>
                <th className={DOC_TH}>Reason</th>
                <th className={`${DOC_TH} text-right`}>Value</th>
                <th className={DOC_TH}>Batches</th>
                <th className={DOC_TH}>By</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id} className="border-b border-neutral-200 align-top">
                  <td className="px-2 py-2">
                    <span className="font-semibold">{a.adjustmentNumber}</span>
                    <span className="block text-[10px] text-neutral-500">{formatDateTime(a.createdAt)}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-semibold">{a.itemName}</span>
                    <span className="block font-mono text-[10px] text-neutral-400">{a.itemCode}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">
                    {a.direction === 'DECREASE' ? '−' : '+'}
                    {a.quantity} {a.unit}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                    {a.quantityBefore} → <span className="font-semibold">{a.quantityAfter}</span>
                  </td>
                  <td className="px-2 py-2">{reasonLabel(a.reason)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">
                    {a.direction === 'DECREASE' ? '−' : '+'}
                    {formatCurrency(a.value)}
                  </td>
                  <td className="px-2 py-2 text-[10px] text-neutral-600">
                    {a.lots.length === 0
                      ? '—'
                      : a.lots.map((l) => (
                          <span key={String(l.lot)} className="block">
                            {l.stockSerial || 'Batch'}
                            {l.expiryDate ? ` · exp ${formatDate(l.expiryDate)}` : ''} ({l.quantity > 0 ? '+' : ''}
                            {l.quantity})
                          </span>
                        ))}
                  </td>
                  <td className="px-2 py-2 text-neutral-600">{a.createdByName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 border-t border-dashed border-neutral-300 pt-4" style={{ pageBreakInside: 'avoid' }}>
          <DocTotals
            items={[
              ['Stock written off', formatCurrency(t.writtenOff)],
              ['Stock added back', formatCurrency(t.addedBack)],
              t.netLoss < 0 ? ['Net gain (at cost)', formatCurrency(-t.netLoss)] : ['Net loss (at cost)', formatCurrency(t.netLoss)],
            ]}
          />
        </div>
        <DocFooter>Values at cost. A net loss shows in Profit & Loss under Cost of Goods Sold.</DocFooter>
      </div>
    </div>
  );
}
