import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Undo2 } from 'lucide-react';
import client, { isAllBranchesView } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useBranchNames } from '../../hooks/useBranchNames.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import PeriodFilter from '../../components/PeriodFilter.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

const KINDS = [
  { key: '', label: 'All' },
  { key: 'WALLET', label: 'To wallet' },
  { key: 'ACCOUNT', label: 'Cash given back' },
];

function Figure({ label, value, hint }) {
  return (
    <div className="rounded-3xl border border-neutral-200/80 bg-white px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p className="figure mt-1 text-2xl font-extrabold text-neutral-950">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

// Money given back when a confirmed invoice was cancelled: to the customer's
// wallet, or as cash out of an account with the number it was sent to.
export default function RefundsPage() {
  const toast = useToast();
  const allBranches = isAllBranchesView(useAuth().user);
  const branchName = useBranchNames(allBranches);
  const [period, setPeriod] = useState({ type: 'month', offset: 0 });
  const [range, setRange] = useState(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}` };
  });
  const [kind, setKind] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    client
      .get('/sales/refunds', { params: { from: range.from || undefined, to: range.to || undefined, refundTo: kind || undefined } })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        setData({ rows: [], totals: { count: 0, amount: 0, wallet: 0, cash: 0 } });
        toast.error(err.friendlyMessage || 'Could not load refunds.');
      });
  }, [range, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div id="print-area">
      <PageHeader
        title="Refunds"
        subtitle={`Money given back when an invoice was cancelled — to the customer's wallet or as cash.${allBranches ? ' All branches together.' : ''}`}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        }
      />

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200/70 bg-white p-4">
        <PeriodFilter
          period={period}
          from={range.from}
          to={range.to}
          onChange={({ period: p, from, to }) => {
            setPeriod(p);
            setRange({ from, to });
          }}
        />
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              onClick={() => setKind(k.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${kind === k.key ? 'bg-brand-400 text-neutral-950' : 'text-neutral-600 hover:bg-neutral-50'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <PageSpinner />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Total refunded" value={formatCurrency(data.totals.amount)} hint={`${data.totals.count} invoice${data.totals.count === 1 ? '' : 's'} cancelled`} />
            <Figure label="To wallets" value={formatCurrency(data.totals.wallet)} hint="Kept as customer credit" />
            <Figure label="Cash given back" value={formatCurrency(data.totals.cash)} hint="Paid out of accounts" />
          </div>

          <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
            {data.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-sm text-neutral-500">
                <Undo2 className="h-8 w-8 text-neutral-300" />
                No refunds in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                      <th className="px-4 py-3">Cancelled</th>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Customer</th>
                      {allBranches && <th className="px-4 py-3">Branch</th>}
                      <th className="px-4 py-3">Given back to</th>
                      <th className="px-4 py-3">Number sent to</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b border-neutral-50 last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-600">{formatDateTime(r.cancelledAt)}</td>
                        <td className="px-4 py-3">
                          <Link to={`/receipt/${r.id}`} state={{ backLabel: 'Refunds' }} className="font-semibold text-brand-700 hover:underline">
                            {r.receiptNumber}
                          </Link>
                          <span className="block text-xs text-neutral-400">Total {formatCurrency(r.total)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {r.customer ? (
                            <Link to={`/customers/${r.customer}`} className="font-medium text-neutral-900 hover:underline">
                              {r.customerName}
                            </Link>
                          ) : (
                            r.customerName
                          )}
                        </td>
                        {allBranches && <td className="px-4 py-3 text-neutral-600">{branchName(r.branch)}</td>}
                        <td className="px-4 py-3">
                          {r.to === 'WALLET' ? (
                            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-800">Wallet</span>
                          ) : (
                            <span className="rounded-full bg-brand-400 px-2.5 py-0.5 text-xs font-semibold text-neutral-950">Cash · {r.accountName}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-neutral-800">{r.reference || '—'}</td>
                        <td className="figure px-4 py-3 text-right font-bold text-neutral-950">{formatCurrency(r.amount)}</td>
                        <td className="px-4 py-3 text-neutral-600">{r.reason || '—'}</td>
                        <td className="px-4 py-3 text-neutral-600">{r.byName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
