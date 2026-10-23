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
import DocHeader, { DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

// One year's profit sharing as a printable document.
export default function ProfitDistributionPage() {
  const { id } = useParams();
  const toast = useToast();
  const [d, setD] = useState(null);

  useEffect(() => {
    client
      .get(`/partners/profit-sharing/${id}`)
      .then((r) => setD(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load this profit sharing.'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <PageSpinner />;
  const cancelled = d.status === 'CANCELLED';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/partners/profit-sharing" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Profit Sharing
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SharePdfButton fileName={`Profit-Sharing_${d.year}`} message={`${BUSINESS.name} — ${d.year} profit sharing: ${formatCurrency(d.netProfit)}`} />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader title={`Profit Sharing ${d.year}`} meta={<span className="font-semibold">{d.distributionNumber} · {formatDate(d.date)}</span>} />
        {cancelled && (
          <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
            CANCELLED {formatDateTime(d.cancelledAt)} by {d.cancelledByName}
            {d.cancelReason ? ` — ${d.cancelReason}` : ''}
          </p>
        )}
        <p className="mt-3 text-xs text-neutral-600">
          The {d.year} net profit of {formatCurrency(d.netProfit)}, shared by percentage —{' '}
          {d.mode === 'PAYOUT' ? `paid to each partner from ${d.accountName}.` : "added to each partner's capital."}
          {d.note ? ` ${d.note}` : ''}
        </p>

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className={`${DOC_THEAD_ROW} text-left`}>
              <th className={`${DOC_TH} w-8`}>#</th>
              <th className={DOC_TH}>Partner</th>
              <th className={`${DOC_TH} text-right`}>Share</th>
              <th className={`${DOC_TH} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.shares.map((s, i) => (
              <tr key={String(s.partner)} className={docRow(i)}>
                <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                <td className="px-2 py-2 font-semibold">{s.partnerName}</td>
                <td className="px-2 py-2 text-right tabular-nums">{s.percent}%</td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{formatCurrency(s.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-900 font-bold">
              <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={2}>
                Total
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{Math.round(d.shares.reduce((s, x) => s + x.percent, 0) * 100) / 100}%</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(d.netProfit)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-6">
          <DocTotals
            items={[
              ['Year', String(d.year)],
              ['Net profit shared', formatCurrency(d.netProfit)],
              ['How', d.mode === 'PAYOUT' ? 'Paid out' : 'Added to capital'],
            ]}
          />
        </div>
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[11px] text-neutral-500">
          {d.shares.slice(0, 3).map((s) => (
            <div key={String(s.partner)} className="border-t border-neutral-400 pt-1">
              {s.partnerName}
            </div>
          ))}
        </div>
        <DocFooter>
          Recorded by {d.createdByName || '—'} · Printed {new Date().toLocaleString()}
        </DocFooter>
      </div>
    </div>
  );
}
