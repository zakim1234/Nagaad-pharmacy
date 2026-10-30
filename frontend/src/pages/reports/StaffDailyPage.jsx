import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer, Users } from 'lucide-react';
import client, { isAllBranchesView } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const shiftMonth = (key, by) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
};
const monthTitle = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
const dayTitle = (key) => new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const Accounts = ({ list }) =>
  list.length ? (
    <span className="flex flex-wrap gap-1">
      {list.map((a) => (
        <span key={a.accountName} className="rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-800">
          {a.accountName} {formatCurrency(a.amount)}
        </span>
      ))}
    </span>
  ) : (
    <span className="text-neutral-300">—</span>
  );

const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// Every invoice and debt payment behind a person's figures for the day.
function Entries({ entries }) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50/60">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
            <th className="px-3 py-1.5">Time</th>
            <th className="px-3 py-1.5">Number</th>
            <th className="px-3 py-1.5">Customer</th>
            <th className="px-3 py-1.5">What</th>
            <th className="px-3 py-1.5 text-right">Total</th>
            <th className="px-3 py-1.5 text-right">Paid</th>
            <th className="px-3 py-1.5 text-right">On credit</th>
            <th className="px-3 py-1.5">Account</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {entries.map((e) => (
            <tr key={`${e.kind}-${e.id}`}>
              <td className="whitespace-nowrap px-3 py-1.5 text-neutral-500">{clock(e.time)}</td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <Link
                  to={e.kind === 'invoice' ? `/receipt/${e.id}` : `/payment-receipt/${e.id}`}
                  state={{ backLabel: 'Staff Daily' }}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  {e.number}
                </Link>
                <span className="block text-[10px] text-neutral-400">{e.kind === 'invoice' ? 'Invoice' : 'Debt payment'}</span>
              </td>
              <td className="px-3 py-1.5 text-neutral-800">{e.customer || '—'}</td>
              <td className="max-w-[260px] px-3 py-1.5 text-neutral-500">{e.items.join(', ') || '—'}</td>
              <td className="figure whitespace-nowrap px-3 py-1.5 text-right text-neutral-900">{e.kind === 'invoice' ? formatCurrency(e.total) : '—'}</td>
              <td className="figure whitespace-nowrap px-3 py-1.5 text-right font-semibold text-emerald-600">
                {formatCurrency(e.paid)}
                {e.wallet > 0 && <span className="block text-[10px] font-normal text-neutral-400">+ {formatCurrency(e.wallet)} wallet</span>}
              </td>
              <td className="figure whitespace-nowrap px-3 py-1.5 text-right text-neutral-500">{e.credit > 0 ? formatCurrency(e.credit) : '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-neutral-600">{e.account || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ rows, totals, first = 'Person', withEntries = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            <th className="px-4 py-2">{first}</th>
            <th className="px-4 py-2 text-right">Invoices</th>
            <th className="px-4 py-2 text-right">Sold</th>
            <th className="px-4 py-2 text-right">Paid at sale</th>
            <th className="px-4 py-2 text-right">Debt collected</th>
            <th className="px-4 py-2 text-right">Money taken</th>
            <th className="px-4 py-2 text-right">On credit</th>
            <th className="px-4 py-2">Into accounts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <Fragment key={`${r.user}-${r.day}`}>
            <tr>
              <td className="px-4 py-2.5 font-semibold text-neutral-900">
                {r.userName}
                {r.days != null && <span className="block text-xs font-normal text-neutral-400">{r.days} day{r.days === 1 ? '' : 's'}</span>}
              </td>
              <td className="figure px-4 py-2.5 text-right text-neutral-700">{r.invoices}</td>
              <td className="figure px-4 py-2.5 text-right font-bold text-neutral-950">{formatCurrency(r.sales)}</td>
              <td className="figure px-4 py-2.5 text-right text-neutral-700">{formatCurrency(r.paidAtSale)}</td>
              <td className="figure px-4 py-2.5 text-right text-neutral-700">{formatCurrency(r.debtCollected)}</td>
              <td className="figure px-4 py-2.5 text-right font-bold text-emerald-600">{formatCurrency(r.received)}</td>
              <td className="figure px-4 py-2.5 text-right text-neutral-500">{formatCurrency(r.credit)}</td>
              <td className="px-4 py-2.5"><Accounts list={r.byAccount} /></td>
            </tr>
            {withEntries && r.entries?.length > 0 && (
              <tr>
                <td colSpan={8} className="px-4 pb-3 pt-0">
                  <Entries entries={r.entries} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
        {totals && rows.length > 1 && (
          <tfoot className="border-t border-neutral-200 bg-neutral-50/80 font-semibold">
            <tr>
              <td className="px-4 py-2.5 text-neutral-800">Total</td>
              <td className="figure px-4 py-2.5 text-right">{totals.invoices}</td>
              <td className="figure px-4 py-2.5 text-right">{formatCurrency(totals.sales)}</td>
              <td className="figure px-4 py-2.5 text-right">{formatCurrency(totals.paidAtSale)}</td>
              <td className="figure px-4 py-2.5 text-right">{formatCurrency(totals.debtCollected)}</td>
              <td className="figure px-4 py-2.5 text-right text-emerald-700">{formatCurrency(totals.received)}</td>
              <td className="figure px-4 py-2.5 text-right">{formatCurrency(totals.credit)}</td>
              <td className="px-4 py-2.5"><Accounts list={totals.byAccount} /></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// Admin only: one month, day by day -- what each person sold and the money
// they took in (paid at the sale and debt payments), by account.
export default function StaffDailyPage() {
  const toast = useToast();
  const allBranches = isAllBranchesView(useAuth().user);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [person, setPerson] = useState(''); // one person, or '' for everyone

  useEffect(() => {
    client
      .get('/reports/users')
      .then((r) => setPeople(r.data.data))
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    setData(null);
    client
      .get('/reports/staff-daily', { params: { month, userId: person || undefined } })
      .then((r) => setData(r.data.data))
      .catch((err) => {
        toast.error(err.friendlyMessage || 'Could not load the report.');
        setData({ days: [], people: [], totals: null });
      });
  }, [month, person]); // eslint-disable-line react-hooks/exhaustive-deps

  const isThisMonth = month === monthKey(new Date());

  return (
    <div>
      <PageHeader
        title="Staff Daily"
        subtitle={`What each person sold and the money they took in, day by day.${allBranches ? ' All branches together.' : ''}`}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        }
      />

      <div className="no-print mb-4 inline-flex flex-wrap items-center gap-1 rounded-2xl border border-neutral-200/70 bg-white p-2">
        <button
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <span className="min-w-[10rem] px-3 text-center text-sm font-bold text-neutral-900">{monthTitle(month)}</span>
        <button
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={isThisMonth}
          className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-6 w-px bg-neutral-200" />
        <label className="flex items-center gap-2 px-1 text-xs font-semibold text-neutral-500">
          Person
          <select
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-neutral-900"
          >
            <option value="">Everyone</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!data ? (
        <PageSpinner />
      ) : data.days.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-neutral-200/70 bg-white py-14 text-sm text-neutral-500">
          <Users className="h-8 w-8 text-neutral-300" />
          No sales in {monthTitle(month)}.
        </div>
      ) : (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
            <div className="surface-blue px-5 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-600">Whole month</p>
              <p className="text-base font-bold">{monthTitle(month)} — each person</p>
            </div>
            <Rows rows={data.people} totals={data.totals} />
          </section>

          {data.days.map((d) => (
            <section key={d.day} className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-5 py-3">
                <p className="text-sm font-bold text-neutral-900">{dayTitle(d.day)}</p>
                <p className="text-xs text-neutral-500">
                  Sold <span className="font-bold text-neutral-900">{formatCurrency(d.totals.sales)}</span> · Taken{' '}
                  <span className="font-bold text-emerald-600">{formatCurrency(d.totals.received)}</span>
                </p>
              </div>
              <Rows rows={d.rows} totals={d.totals} withEntries />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
