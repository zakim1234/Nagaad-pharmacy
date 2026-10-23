import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import client, { isAllBranchesView, overviewScopeLabel } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { periodTitle } from '../pos/DayItemsSoldPage.jsx';

const TABS = [
  { type: 'day', label: 'Daily' },
  { type: 'month', label: 'Monthly' },
  { type: 'year', label: 'Yearly' },
];

// Items Sold: every closed day, month and year listed with its totals; each
// opens its own items-sold report (per item quantity, cost, sales, profit).
// Built from the saved Close Day records, so nothing is ever lost.
export default function ItemsSoldPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const type = TABS.some((t) => t.type === params.get('type')) ? params.get('type') : 'day';
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    client
      .get('/reports/items-sold/periods', { params: { type } })
      .then((r) => setRows(r.data.data))
      .catch((err) => {
        setRows([]);
        toast.error(err.friendlyMessage || 'Could not load the periods.');
      });
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const noun = type === 'day' ? 'day' : type === 'month' ? 'month' : 'year';

  return (
    <div>
      <PageHeader
        title="Items Sold"
        subtitle={`What was sold each ${noun}: open one to see every item, its quantity, cost, selling price and profit.${isAllBranchesView(user) ? ` Showing: ${overviewScopeLabel()}.` : ''}`}
      />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setParams({ type: t.type })}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${type === t.type ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!rows ? (
        <PageSpinner />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">{type === 'day' ? 'Day' : type === 'month' ? 'Month' : 'Year'}</th>
                {type !== 'day' && <th className="px-4 py-2.5 text-center">Days closed</th>}
                <th className="px-4 py-2.5 text-center">Invoices</th>
                <th className="px-4 py-2.5 text-right">Sales</th>
                <th className="px-4 py-2.5 text-right">Cost</th>
                <th className="px-4 py-2.5 text-right">Expenses</th>
                <th className="px-4 py-2.5 text-right">Net profit</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                    No closed days yet. Reports appear here after Close Day.
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{periodTitle(type, p.key)}</td>
                  {type !== 'day' && <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{p.dayCount}</td>}
                  <td className="px-4 py-2.5 text-center tabular-nums text-slate-600">{p.invoiceCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(p.sales)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatCurrency(p.cost)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatCurrency(p.expenses)}</td>
                  <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${p.netProfit < 0 ? 'text-brand-700' : 'text-slate-900'}`}>{formatCurrency(p.netProfit)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/items-sold/view?type=${type}&key=${p.key}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-700"
                    >
                      <FileText className="h-3.5 w-3.5" /> View report
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
