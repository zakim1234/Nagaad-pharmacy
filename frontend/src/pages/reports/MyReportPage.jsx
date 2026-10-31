import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Receipt, Wallet } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

function Figure({ label, value, hint, strong = false }) {
  return (
    <div className={`rounded-3xl px-5 py-4 ${strong ? 'surface-blue' : 'border border-neutral-200/80 bg-white'}`}>
      <p className="eyebrow">{label}</p>
      <p className="figure mt-1 text-2xl font-extrabold text-neutral-950">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// A cashier's own report: what they sold and the money they took since the
// last Close Day -- and nothing of anyone else's. Starts again from 0 after
// each Close Day; the admin still sees it all (Staff Daily).
export default function MyReportPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    client
      .get('/sales/my-day')
      .then((r) => setData(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load your report.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageSpinner />;
  const t = data.totals;

  return (
    <div id="print-area">
      <PageHeader
        title="My Report"
        subtitle={`${user?.name || 'You'} — what you sold and the money you took ${data.since ? `since the last Close Day (${formatDateTime(data.since)})` : 'today'}.`}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure strong label="Sold" value={formatCurrency(t.sales)} hint={`${t.invoices} invoice${t.invoices === 1 ? '' : 's'}`} />
        <Figure label="Money taken" value={formatCurrency(t.received)} hint={`${formatCurrency(t.paidAtSale)} at sales · ${formatCurrency(t.debtCollected)} debt`} />
        <Figure label="On credit" value={formatCurrency(t.credit)} hint="Customers still owe this" />
        <Figure label="From wallets" value={formatCurrency(t.fromWallet)} hint="Paid with wallet credit" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
            <Wallet className="h-4 w-4 text-brand-600" />
            <p className="text-sm font-bold text-neutral-900">My money by account</p>
          </div>
          {data.accounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">No money yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-5 py-2">Account</th>
                  <th className="px-5 py-2 text-right">In</th>
                  <th className="px-5 py-2 text-right">Out</th>
                  <th className="px-5 py-2 text-right">Mine</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.accounts.map((a) => (
                  <tr key={a.accountName}>
                    <td className="px-5 py-2.5 font-semibold text-neutral-900">{a.accountName}</td>
                    <td className="figure px-5 py-2.5 text-right text-emerald-600">{formatCurrency(a.moneyIn)}</td>
                    <td className="figure px-5 py-2.5 text-right text-brand-600">{a.moneyOut ? formatCurrency(a.moneyOut) : '—'}</td>
                    <td className="figure px-5 py-2.5 text-right font-bold text-neutral-950">{formatCurrency(a.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
          <div className="border-b border-neutral-100 px-5 py-3">
            <p className="text-sm font-bold text-neutral-900">Items I sold</p>
          </div>
          {data.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">Nothing sold yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-5 py-2">Item</th>
                  <th className="px-5 py-2 text-right">Qty</th>
                  <th className="px-5 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.items.map((i) => (
                  <tr key={i.name}>
                    <td className="px-5 py-2.5 font-medium text-neutral-900">{i.name}</td>
                    <td className="figure px-5 py-2.5 text-right text-neutral-700">{i.quantity}</td>
                    <td className="figure px-5 py-2.5 text-right font-bold text-neutral-950">{formatCurrency(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-white">
        <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
          <Receipt className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-bold text-neutral-900">My invoices and payments</p>
        </div>
        {data.invoices.length === 0 && data.payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400">Nothing yet since the last Close Day.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  <th className="px-5 py-2">Time</th>
                  <th className="px-5 py-2">Number</th>
                  <th className="px-5 py-2">Customer</th>
                  <th className="px-5 py-2 text-right">Total</th>
                  <th className="px-5 py-2 text-right">Money taken</th>
                  <th className="px-5 py-2">Account</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.invoices.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-neutral-600">{time(s.time)}</td>
                    <td className="px-5 py-2.5">
                      <Link to={`/receipt/${s.id}`} state={{ backLabel: 'My Report' }} className="font-semibold text-brand-700 hover:underline">
                        {s.receiptNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-neutral-800">{s.customerName}</td>
                    <td className="figure px-5 py-2.5 text-right font-semibold text-neutral-950">{formatCurrency(s.total)}</td>
                    <td className="figure px-5 py-2.5 text-right text-emerald-600">{formatCurrency(s.paid)}</td>
                    <td className="px-5 py-2.5 text-neutral-600">{s.account || '—'}</td>
                  </tr>
                ))}
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-neutral-600">{time(p.time)}</td>
                    <td className="px-5 py-2.5">
                      <Link to={`/payment-receipt/${p.id}`} state={{ backLabel: 'My Report' }} className="font-semibold text-brand-700 hover:underline">
                        {p.receiptNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-neutral-500">Debt payment</td>
                    <td className="figure px-5 py-2.5 text-right text-neutral-400">—</td>
                    <td className="figure px-5 py-2.5 text-right text-emerald-600">{formatCurrency(p.amount)}</td>
                    <td className="px-5 py-2.5 text-neutral-600">{p.account || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
