import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, TrendingUp, TrendingDown } from 'lucide-react';
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
import { periodTitle } from '../pos/DayItemsSoldPage.jsx';

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const DEFAULT_KEY = {
  day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
  year: String(now.getFullYear()),
};
const TABS = [
  { type: 'all', label: 'All time' },
  { type: 'year', label: 'Yearly' },
  { type: 'month', label: 'Monthly' },
  { type: 'day', label: 'Daily' },
];

// Items Bought: what one customer bought, item by item, over all time or one
// year, month or day -- quantities, what they paid, and the item they buy
// most and least. Printable and sendable.
export default function CustomerItemsPage() {
  const { id } = useParams();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const type = TABS.some((t) => t.type === params.get('type')) ? params.get('type') : 'all';
  const key = params.get('key') || DEFAULT_KEY[type] || '';
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    client
      .get(`/customers/${id}/items`, { params: type === 'all' ? {} : { type, key } })
      .then((r) => setData(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the items bought.'));
  }, [id, type, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (t, k) => setParams(t === 'all' ? {} : { type: t, key: k || DEFAULT_KEY[t] });
  const periodLabel = type === 'all' ? 'All time' : periodTitle(type, key);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/customers/${id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to customer
        </Link>
        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <SharePdfButton
              fileName={`Items-Bought_${data.customer.name}_${data.key || 'all'}`}
              phone={data.customer.phone}
              message={`${BUSINESS.name} — items bought by ${data.customer.name} (${periodLabel})`}
            />
            <Button onClick={() => printReport('portrait')}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 no-print">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => choose(t.type)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${type === t.type ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {type === 'year' && <div className="w-28">
          <Input type="number" min="2000" max="2100" value={key} onChange={(e) => e.target.value.length === 4 && choose('year', e.target.value)} />
        </div>}
        {type === 'month' && <div className="w-44">
          <Input type="month" value={key} onChange={(e) => e.target.value && choose('month', e.target.value)} />
        </div>}
        {type === 'day' && <div className="w-44">
          <Input type="date" value={key} onChange={(e) => e.target.value && choose('day', e.target.value)} />
        </div>}
      </div>

      {!data ? (
        <PageSpinner />
      ) : (
        <div id="print-area" className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
          <DocHeader
            title="Items Bought"
            meta={
              <span className="font-semibold">
                {data.customer.name}
                {data.customer.phone ? ` · ${data.customer.phone}` : ''} · {periodLabel}
              </span>
            }
          />

          {data.items.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <div className="flex items-center gap-3 rounded-lg bg-neutral-950 px-4 py-3 text-white">
                <TrendingUp className="h-5 w-5 shrink-0 text-brand-400" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-white/70">Buys most</p>
                  <p className="truncate font-bold">{data.mostBought.name}</p>
                  <p className="text-xs text-white/70">
                    {data.mostBought.quantity} pcs · {formatCurrency(data.mostBought.spent)} · {data.mostBought.invoices} invoice{data.mostBought.invoices === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-neutral-300 px-4 py-3">
                <TrendingDown className="h-5 w-5 shrink-0 text-neutral-400" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Buys least</p>
                  {data.leastBought ? (
                    <>
                      <p className="truncate font-bold">{data.leastBought.name}</p>
                      <p className="text-xs text-neutral-500">
                        {data.leastBought.quantity} pcs · {formatCurrency(data.leastBought.spent)} · {data.leastBought.invoices} invoice{data.leastBought.invoices === 1 ? '' : 's'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-neutral-500">Only one item bought.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="mt-4 w-full border-collapse text-xs">
              <thead>
                <tr className={`${DOC_THEAD_ROW} text-left`}>
                  <th className={`${DOC_TH} w-8`}>#</th>
                  <th className={DOC_TH}>Item</th>
                  <th className={`${DOC_TH} text-center`}>Quantity</th>
                  <th className={`${DOC_TH} text-center`}>Invoices</th>
                  <th className={`${DOC_TH} text-right`}>Avg price</th>
                  <th className={`${DOC_TH} text-right`}>Total paid</th>
                  <th className={`${DOC_TH} text-right`}>Profit</th>
                  <th className={DOC_TH}>Last bought</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-8 text-center text-neutral-400">
                      No items bought {type === 'all' ? 'yet' : 'in this period'}.
                    </td>
                  </tr>
                )}
                {data.items.map((r, i) => (
                  <tr key={r.itemId || r.name} className={docRow(i)}>
                    <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                    <td className="px-2 py-2 font-semibold">{r.name}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.quantity}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{r.invoices}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatCurrency(r.unitPrice)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(r.spent)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatCurrency(r.profit)}</td>
                    <td className="whitespace-nowrap px-2 py-2">{formatDate(r.lastBought)}</td>
                  </tr>
                ))}
              </tbody>
              {data.items.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-neutral-900 font-bold">
                    <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={2}>
                      Total · {data.totals.items} item{data.totals.items === 1 ? '' : 's'}
                    </td>
                    <td className="px-2 py-2.5 text-center tabular-nums">{data.totals.quantity}</td>
                    <td className="px-2 py-2.5 text-center tabular-nums">{data.invoiceCount}</td>
                    <td />
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.spent)}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{formatCurrency(data.totals.profit)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="mt-6">
            <DocTotals
              items={[
                ['Different items', String(data.totals.items)],
                ['Total quantity', String(data.totals.quantity)],
                ['Total paid', formatCurrency(data.totals.spent)],
                ['Invoices', String(data.invoiceCount)],
              ]}
            />
          </div>
          <DocFooter>Quantities are after returns. Printed {new Date().toLocaleString()}</DocFooter>
        </div>
      )}
    </div>
  );
}
