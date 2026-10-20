import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocTotals, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';

const num = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayTitle = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Items sold on one closed day: per item the units sold, unit cost / unit
// selling price, total cost / total sales and the profit it made, with the
// day's totals underneath -- printable and sendable.
export default function DayItemsSoldPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const date = params.get('date');
  const [data, setData] = useState(null);

  useEffect(() => {
    client
      .get('/day-close/daily/items', { params: { date } })
      .then((r) => setData(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the items sold.'));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageSpinner />;
  const { items, totals } = data;
  const day = dayTitle(data.businessDate);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to="/daily-closing" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Daily Closing
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <SharePdfButton fileName={`Items-Sold_${String(date).slice(0, 10)}`} message={`${BUSINESS.name} — items sold ${day}: profit ${formatCurrency(totals.netProfit)}`} />
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div id="print-area" className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <DocHeader title="Items Sold" meta={<span className="font-semibold">{day}</span>} />
        <p className="mt-3 text-xs text-neutral-500">Every item sold in this day's closing{data.closeCount > 1 ? `s (${data.closeCount})` : ''}, highest sales first.</p>

        <div className="overflow-x-auto">
          <table className="mt-3 w-full border-collapse text-xs">
            <thead>
              <tr className={`${DOC_THEAD_ROW} text-left`}>
                <th className={`${DOC_TH} w-8`}>#</th>
                <th className={DOC_TH}>Item</th>
                <th className={`${DOC_TH} text-center`}>Quantity</th>
                <th className={`${DOC_TH} text-right`}>Cost / Sell</th>
                <th className={`${DOC_TH} text-right`}>Total cost / Total sell</th>
                <th className={`${DOC_TH} text-right`}>Profit</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-8 text-center text-neutral-400">
                    No items were sold in this closing.
                  </td>
                </tr>
              )}
              {items.map((r, i) => (
                <tr key={r.itemId || r.name} className={docRow(i)}>
                  <td className="px-2 py-2 text-neutral-500">{i + 1}</td>
                  <td className="px-2 py-2 font-semibold">{r.name}</td>
                  <td className="px-2 py-2 text-center tabular-nums">{r.quantity}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                    {num(r.unitCost)} <span className="text-neutral-400">/</span> {num(r.unitPrice)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                    {num(r.cost)} <span className="text-neutral-400">/</span> {num(r.sales)}
                  </td>
                  <td className={`whitespace-nowrap px-2 py-2 text-right font-bold tabular-nums ${r.profit < 0 ? 'text-brand-700' : ''}`}>{formatCurrency(r.profit)}</td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-900 font-bold">
                  <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={2}>
                    Total · {totals.items} item{totals.items === 1 ? '' : 's'}
                  </td>
                  <td className="px-2 py-2.5 text-center tabular-nums">{totals.quantity}</td>
                  <td className="px-2 py-2.5" />
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                    {num(totals.cost)} <span className="text-neutral-400">/</span> {num(totals.sales)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{formatCurrency(Math.round((totals.sales - totals.cost) * 100) / 100)}</td>
                </tr>
                {(totals.invoiceDiscount > 0 || totals.expenses > 0) && (
                  <tr className="text-neutral-600">
                    <td className="px-2 py-1.5" colSpan={5}>
                      Profit on items sold
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatCurrency(Math.round((totals.sales - totals.cost) * 100) / 100)}</td>
                  </tr>
                )}
                {totals.invoiceDiscount > 0 && (
                  <tr className="text-neutral-600">
                    <td className="px-2 py-1.5" colSpan={5}>
                      Discounts on whole invoices
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">− {formatCurrency(totals.invoiceDiscount)}</td>
                  </tr>
                )}
                {totals.expenses > 0 && (
                  <tr className="text-neutral-600">
                    <td className="px-2 py-1.5" colSpan={5}>
                      Expenses this day
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">− {formatCurrency(totals.expenses)}</td>
                  </tr>
                )}
                <tr className="border-t border-neutral-300 font-bold">
                  <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={5}>
                    Net profit
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-brand-700">{formatCurrency(totals.netProfit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="mt-6">
          <DocTotals
            items={[
              ['Total items', String(totals.items)],
              ['Total quantity', String(totals.quantity)],
              ['Total cost / sell', `${num(totals.cost)} / ${num(totals.sales)}`],
              ['Net profit', formatCurrency(totals.netProfit)],
            ]}
          />
        </div>
        <DocFooter>Printed {new Date().toLocaleString()}</DocFooter>
      </div>
    </div>
  );
}
