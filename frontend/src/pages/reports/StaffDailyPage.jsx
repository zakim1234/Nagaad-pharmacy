import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

// Where the page was scrolled to when an invoice was opened from it.
const SCROLL_KEY = 'staffDaily.scroll';
const rememberScroll = () => {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(document.querySelector('main')?.scrollTop || 0));
  } catch {
    // storage unavailable: Back just starts at the top
  }
};

const clock = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const Avatar = ({ name }) => (
  <span className="surface-blue grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold">
    {String(name || '?').trim().charAt(0).toUpperCase()}
  </span>
);

const zeroDim = (cents) => (cents ? '' : 'text-neutral-300');

// Every invoice and debt payment behind a person's figures for the day.
// Fixed column widths so every day's table lines up the same way.
function Entries({ entries }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200/70">
      <table className="w-full min-w-[820px] table-fixed text-xs">
        <colgroup>
          <col className="w-[72px]" />
          <col className="w-[150px]" />
          <col className="w-[130px]" />
          <col />
          <col className="w-[96px]" />
          <col className="w-[96px]" />
          <col className="w-[90px]" />
          <col className="w-[90px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="bg-neutral-50">
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Number</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2">Items</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Paid</th>
            <th className="px-3 py-2 text-right">Wallet</th>
            <th className="px-3 py-2 text-right">On credit</th>
            <th className="px-3 py-2">Account</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {entries.map((e) => (
            <tr key={`${e.kind}-${e.id}`} className="align-top hover:bg-brand-50/40">
              <td className="whitespace-nowrap px-3 py-2 text-neutral-500">{clock(e.time)}</td>
              <td className="px-3 py-2">
                <Link
                  to={e.kind === 'invoice' ? `/receipt/${e.id}` : `/payment-receipt/${e.id}`}
                  state={{ backLabel: 'Staff Daily' }}
                  onClick={rememberScroll}
                  className="block truncate font-semibold text-brand-700 hover:underline"
                >
                  {e.number}
                </Link>
                <span
                  className={`mt-0.5 inline-block rounded px-1.5 py-px text-[10px] font-semibold ${
                    e.kind === 'invoice' ? 'bg-neutral-100 text-neutral-600' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {e.kind === 'invoice' ? 'Invoice' : 'Debt payment'}
                </span>
              </td>
              <td className="truncate px-3 py-2 font-medium text-neutral-800" title={e.customer || ''}>{e.customer || '—'}</td>
              <td className="truncate px-3 py-2 text-neutral-500" title={e.items.join(', ')}>{e.items.join(', ') || '—'}</td>
              <td className="figure whitespace-nowrap px-3 py-2 text-right font-semibold text-neutral-900">{e.kind === 'invoice' ? formatCurrency(e.total) : '—'}</td>
              <td className={`figure whitespace-nowrap px-3 py-2 text-right font-semibold ${e.paid ? 'text-emerald-600' : 'text-neutral-300'}`}>{formatCurrency(e.paid)}</td>
              <td className="figure whitespace-nowrap px-3 py-2 text-right text-neutral-600">{e.wallet > 0 ? formatCurrency(e.wallet) : <span className="text-neutral-300">—</span>}</td>
              <td className="figure whitespace-nowrap px-3 py-2 text-right text-neutral-600">{e.credit > 0 ? formatCurrency(e.credit) : <span className="text-neutral-300">—</span>}</td>
              <td className="truncate px-3 py-2 text-neutral-600" title={e.account || ''}>{e.account || <span className="text-neutral-300">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Stat = ({ label, value, cents, tone = 'text-neutral-900' }) => (
  <div className="min-w-0 rounded-lg bg-neutral-50 px-3 py-2">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">{label}</p>
    <p className={`figure mt-0.5 text-sm font-bold ${cents ? tone : 'text-neutral-300'}`}>{value}</p>
  </div>
);

// One person's day: their figures on top, then every invoice behind them.
function PersonDay({ r }) {
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-[9rem] items-center gap-2.5">
          <Avatar name={r.userName} />
          <div>
            <p className="font-semibold text-neutral-900">{r.userName}</p>
            <p className="text-xs text-neutral-400">
              {r.invoices} invoice{r.invoices === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-5 lg:w-auto lg:flex-1">
          <Stat label="Sold" value={formatCurrency(r.sales)} cents={r.sales} />
          <Stat label="Paid at sale" value={formatCurrency(r.paidAtSale)} cents={r.paidAtSale} />
          <Stat label="Debt collected" value={formatCurrency(r.debtCollected)} cents={r.debtCollected} />
          <Stat label="Money taken" value={formatCurrency(r.received)} cents={r.received} tone="text-emerald-600" />
          <Stat label="On credit" value={formatCurrency(r.credit)} cents={r.credit} tone="text-amber-700" />
        </div>
      </div>
      {r.byAccount?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-neutral-500">Into accounts:</span>
          <Accounts list={r.byAccount} />
        </div>
      )}
      {r.entries?.length > 0 && <Entries entries={r.entries} />}
    </div>
  );
}

// The whole month, one line per person. Fixed widths keep the columns tidy.
function MonthTable({ rows, totals }) {
  const num = 'figure whitespace-nowrap px-4 py-3 text-right';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] table-fixed text-sm">
        <colgroup>
          <col className="w-[17%]" />
          <col className="w-[8%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[10%]" />
          <col className="w-[21%]" />
        </colgroup>
        <thead className="bg-neutral-50">
          <tr className="text-left text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
            <th className="px-4 py-2.5">Person</th>
            <th className="px-4 py-2.5 text-right">Invoices</th>
            <th className="px-4 py-2.5 text-right">Sold</th>
            <th className="px-4 py-2.5 text-right">Paid at sale</th>
            <th className="px-4 py-2.5 text-right">Debt collected</th>
            <th className="px-4 py-2.5 text-right">Money taken</th>
            <th className="px-4 py-2.5 text-right">On credit</th>
            <th className="px-4 py-2.5">Into accounts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.user} className="hover:bg-brand-50/40">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.userName} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-neutral-900">{r.userName}</p>
                    {r.days != null && <p className="text-xs text-neutral-400">{r.days} day{r.days === 1 ? '' : 's'}</p>}
                  </div>
                </div>
              </td>
              <td className={`${num} text-neutral-700`}>{r.invoices}</td>
              <td className={`${num} font-bold text-neutral-950`}>{formatCurrency(r.sales)}</td>
              <td className={`${num} text-neutral-700 ${zeroDim(r.paidAtSale)}`}>{formatCurrency(r.paidAtSale)}</td>
              <td className={`${num} text-neutral-700 ${zeroDim(r.debtCollected)}`}>{formatCurrency(r.debtCollected)}</td>
              <td className={`${num} font-bold text-emerald-600 ${zeroDim(r.received)}`}>{formatCurrency(r.received)}</td>
              <td className={`${num} text-amber-700 ${zeroDim(r.credit)}`}>{formatCurrency(r.credit)}</td>
              <td className="px-4 py-3"><Accounts list={r.byAccount} /></td>
            </tr>
          ))}
        </tbody>
        {totals && rows.length > 1 && (
          <tfoot className="border-t-2 border-neutral-200 bg-brand-50/50 font-bold">
            <tr>
              <td className="px-4 py-3 text-neutral-900">Total</td>
              <td className={num}>{totals.invoices}</td>
              <td className={num}>{formatCurrency(totals.sales)}</td>
              <td className={num}>{formatCurrency(totals.paidAtSale)}</td>
              <td className={num}>{formatCurrency(totals.debtCollected)}</td>
              <td className={`${num} text-emerald-700`}>{formatCurrency(totals.received)}</td>
              <td className={`${num} text-amber-700`}>{formatCurrency(totals.credit)}</td>
              <td className="px-4 py-3"><Accounts list={totals.byAccount} /></td>
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
  // Month and person live in the address, so Back from an invoice keeps them.
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : monthKey(new Date());
  const person = params.get('person') || ''; // one person, or '' for everyone
  const setMonth = (m) => setParams({ month: m, ...(person ? { person } : {}) }, { replace: true });
  const setPerson = (p) => setParams({ month, ...(p ? { person: p } : {}) }, { replace: true });
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);

  // Coming back from an invoice: scroll to where the user was.
  useEffect(() => {
    if (!data) return;
    let saved = null;
    try {
      saved = sessionStorage.getItem(SCROLL_KEY);
      sessionStorage.removeItem(SCROLL_KEY);
    } catch {
      // storage unavailable: stay at the top
    }
    if (saved) requestAnimationFrame(() => document.querySelector('main')?.scrollTo({ top: Number(saved) }));
  }, [data]);

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
    <div id="print-area">
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
            <MonthTable rows={data.people} totals={data.totals} />
          </section>

          {data.days.map((d) => (
            <section key={d.day} className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/70 bg-brand-50/60 px-5 py-3">
                <p className="text-sm font-bold text-neutral-900">{dayTitle(d.day)}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-white px-3 py-1 text-neutral-500 ring-1 ring-neutral-200">
                    Sold <span className="figure font-bold text-neutral-900">{formatCurrency(d.totals.sales)}</span>
                  </span>
                  <span className="rounded-full bg-white px-3 py-1 text-neutral-500 ring-1 ring-neutral-200">
                    Taken <span className="figure font-bold text-emerald-600">{formatCurrency(d.totals.received)}</span>
                  </span>
                  {d.totals.credit > 0 && (
                    <span className="rounded-full bg-white px-3 py-1 text-neutral-500 ring-1 ring-neutral-200">
                      On credit <span className="figure font-bold text-amber-700">{formatCurrency(d.totals.credit)}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-neutral-100">
                {d.rows.map((r) => (
                  <PersonDay key={`${r.user}-${d.day}`} r={r} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
