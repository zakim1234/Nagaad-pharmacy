import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer, Search } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);

// Debtors statement: only the customers who owe money, most owed first,
// with their contacts and how long they have owed -- printable and sendable.
export default function DebtorsStatementPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    client
      .get('/customers/debtors')
      .then((r) => setData(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the debtors statement.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageSpinner />;
  const needle = q.trim().toLowerCase();
  const rows = needle ? data.customers.filter((c) => `${c.name} ${c.phone || ''}`.toLowerCase().includes(needle)) : data.customers;
  const shownTotal = Math.round(rows.reduce((s, c) => s + c.balance, 0) * 100) / 100;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/customers" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Customers
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name or phone..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <SharePdfButton fileName={`Debtors_${new Date().toISOString().slice(0, 10)}`} message={`${BUSINESS.name} — customers who owe: ${formatCurrency(shownTotal)}`} orientation="landscape" />
          <Button onClick={() => printReport('landscape')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader title="Debtors Statement" meta={<span className="font-semibold">As of {formatDate(data.asOf)}</span>} />
        <p className="mt-3 text-xs text-neutral-500">
          Customers who owe money{needle ? ` matching "${q.trim()}"` : ''}, most owed first.
        </p>

        <div className="overflow-x-auto">
          <table className="mt-3 w-full border-collapse text-xs">
            <thead>
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={`${DOC_TH} w-8`}>#</th>
                <th className={DOC_TH}>Customer</th>
                <th className={DOC_TH}>Phone</th>
                <th className={`${DOC_TH} text-center`}>Unpaid invoices</th>
                <th className={DOC_TH}>Owing since</th>
                <th className={DOC_TH}>Last payment</th>
                <th className={`${DOC_TH} text-right`}>Wallet</th>
                <th className={`${DOC_TH} text-right`}>Owes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-8 text-center text-neutral-400">
                    {data.count === 0 ? 'No customer owes money. 🎉' : 'No customer matches your search.'}
                  </td>
                </tr>
              )}
              {rows.map((c, i) => {
                const age = daysSince(c.oldestUnpaid);
                return (
                  <tr key={c.id} className={docRow(i)}>
                    <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Link to={`/customers/${c.id}`} className="font-semibold hover:text-brand-600 hover:underline print:no-underline">
                        {c.name}
                      </Link>
                      {c.address && <span className="block text-[10px] text-neutral-500">{c.address}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{c.phone || '—'}</td>
                    <td className="px-2 py-2 text-center">{c.unpaidInvoices}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {c.oldestUnpaid ? (
                        <>
                          {formatDate(c.oldestUnpaid)}
                          <span className={`ml-1 text-[10px] font-semibold ${age > 30 ? 'text-brand-600' : 'text-neutral-500'}`}>({age} days)</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2">{c.lastPayment ? formatDate(c.lastPayment) : <span className="text-neutral-400">Never</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{c.walletBalance > 0 ? formatCurrency(c.walletBalance) : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-bold tabular-nums text-brand-700">{formatCurrency(c.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-900 font-bold">
                  <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={7}>
                    Total owed
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-brand-700">{formatCurrency(shownTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="mt-6">
          <DocTotals
            items={[
              ['Customers who owe', String(rows.length)],
              ['Total owed', formatCurrency(shownTotal)],
              ['Owing over 30 days', String(rows.filter((c) => daysSince(c.oldestUnpaid) > 30).length)],
            ]}
          />
        </div>
        <DocFooter>Printed {new Date().toLocaleString()}</DocFooter>
      </div>
    </div>
  );
}
