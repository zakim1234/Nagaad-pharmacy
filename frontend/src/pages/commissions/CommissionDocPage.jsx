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
import { periodLabel } from './CommissionsPage.jsx';

// One commission payment as a printable document.
export default function CommissionDocPage() {
  const { id } = useParams();
  const toast = useToast();
  const [c, setC] = useState(null);

  useEffect(() => {
    client
      .get(`/commissions/${id}`)
      .then((r) => setC(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load this commission.'));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <PageSpinner />;
  const period = periodLabel(c.periodType, c.periodKey);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/commissions?type=${c.periodType}&key=${c.periodKey}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Commissions
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SharePdfButton fileName={`Commission_${c.commissionNumber}`} message={`${BUSINESS.name} — commission ${period}: ${formatCurrency(c.total)}`} />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader title={`${c.kind === 'ADMIN' ? 'Admin' : 'Staff'} Commission ${period}`} meta={<span className="font-semibold">{c.commissionNumber} · {formatDate(c.createdAt)}</span>} />
        {c.status === 'CANCELLED' && (
          <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
            CANCELLED {formatDateTime(c.cancelledAt)} by {c.cancelledByName}
            {c.cancelReason ? ` — ${c.cancelReason}` : ''}
          </p>
        )}
        <p className="mt-3 text-xs text-neutral-600">
          {c.periodType === 'year' ? 'Yearly' : 'Monthly'} commission on the {period} profit of {formatCurrency(c.baseProfit)} (before commission), paid from {c.accountName}.
          {c.note ? ` ${c.note}` : ''}
        </p>

        <table className="mt-4 w-full border-collapse text-xs">
          <thead>
            <tr className={`${DOC_THEAD_ROW} text-left`}>
              <th className={`${DOC_TH} w-8`}>#</th>
              <th className={DOC_TH}>Name</th>
              <th className={DOC_TH}>Role</th>
              <th className={`${DOC_TH} text-right`}>Commission</th>
              <th className={`${DOC_TH} text-right`}>Amount</th>
              <th className={`${DOC_TH} w-40 text-center`}>Signature</th>
            </tr>
          </thead>
          <tbody>
            {c.lines.map((l, i) => (
              <tr key={i} className={docRow(i)}>
                <td className="px-2 py-2.5 text-neutral-500">{i + 1}</td>
                <td className="px-2 py-2.5 font-semibold">{l.name}</td>
                <td className="px-2 py-2.5 capitalize">{l.role || '—'}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{l.percent}%</td>
                <td className="px-2 py-2.5 text-right font-bold tabular-nums">{formatCurrency(l.amount)}</td>
                <td className="px-2 py-2.5" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-900 font-bold">
              <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={3}>
                Total
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums">{Math.round(c.lines.reduce((s, l) => s + l.percent, 0) * 100) / 100}%</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{formatCurrency(c.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="mt-6">
          <DocTotals
            items={[
              ['Profit before commission', formatCurrency(c.baseProfit)],
              ['Commission paid', formatCurrency(c.total)],
              ['Profit after this commission', formatCurrency(Math.round((c.baseProfit - c.total) * 100) / 100)],
            ]}
          />
        </div>
        <DocFooter>
          Recorded by {c.createdByName || '—'} · Printed {new Date().toLocaleString()}
        </DocFooter>
      </div>
    </div>
  );
}
