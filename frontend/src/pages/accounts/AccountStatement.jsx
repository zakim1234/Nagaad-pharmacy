import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Printer, X } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';

const TYPE_LABELS = {
  SALE_PAYMENT: 'Sale payment',
  CUSTOMER_DEBT_PAYMENT: 'Customer debt payment',
  PURCHASE_PAYMENT: 'Supplier payment',
  REFUND: 'Refund',
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
  EXPENSE: 'Expense',
  PARTNER_CONTRIBUTION: 'Partner capital in',
  PARTNER_WITHDRAWAL: 'Partner withdrawal',
};

// Where a row's record can be opened.
const linkFor = (r) => (r.referenceType === 'Sale' && r.referenceId ? `/receipt/${r.referenceId}` : r.referenceType === 'Payment' && r.referenceId ? `/payment-receipt/${r.referenceId}` : null);

// One account over the report's period: every amount in and out, what it was
// and why (the description), who did it, and the balance after each one.
export default function AccountStatement({ accountId, params, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [dir, setDir] = useState(''); // '', 'IN', 'OUT'

  useEffect(() => {
    setData(null);
    setError('');
    client
      .get(`/accounts/${accountId}/statement`, { params })
      .then((r) => setData(r.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Could not load the statement.'));
  }, [accountId, JSON.stringify(params)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">{error}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-neutral-400">Loading statement...</p>;

  const rows = dir ? data.rows.filter((r) => r.direction === dir) : data.rows;
  const tab = (active) => `rounded-md px-3 py-1 text-xs font-semibold transition ${active ? 'bg-brand-400 text-neutral-950' : 'text-neutral-600 hover:bg-neutral-50'}`;

  return (
    <div id="print-area" className="mt-5 overflow-hidden rounded-2xl border border-neutral-200/80">
      <div className="surface-blue flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-600">Account statement</p>
          <p className="text-lg font-bold">{data.account.name}</p>
          <p className="text-xs text-neutral-600">
            {formatDate(data.range.from)} – {formatDate(data.range.to)}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-neutral-100 border-b border-neutral-100 sm:grid-cols-4">
        {[
          ['Opening', data.opening],
          ['Money in', data.moneyIn],
          ['Money out', data.moneyOut],
          ['Closing', data.closing],
        ].map(([label, value]) => (
          <div key={label} className="px-5 py-3">
            <p className="eyebrow">{label}</p>
            <p className="figure mt-0.5 text-lg font-extrabold text-neutral-950">{formatCurrency(value)}</p>
          </div>
        ))}
      </div>

      <div className="no-print flex items-center gap-2 px-5 pt-3">
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
          <button onClick={() => setDir('')} className={tab(!dir)}>All ({data.rows.length})</button>
          <button onClick={() => setDir('IN')} className={tab(dir === 'IN')}>Money in</button>
          <button onClick={() => setDir('OUT')} className={tab(dir === 'OUT')}>Money out</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">No money moved in this period.</p>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2">Details / reason</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2 text-right">In</th>
                <th className="px-3 py-2 text-right">Out</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => {
                const to = linkFor(r);
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 text-neutral-600">{formatDateTime(r.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 font-semibold text-neutral-900">
                        {r.direction === 'IN' ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowUpRight className="h-3.5 w-3.5 text-brand-600" />}
                        {TYPE_LABELS[r.type] || r.type}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {r.description || '—'}
                      {to && (
                        <Link to={to} state={{ backLabel: 'Accounts' }} className="no-print ml-2 text-xs font-semibold text-brand-700 hover:underline">
                          Open
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">{r.byName || '—'}</td>
                    <td className="figure whitespace-nowrap px-3 py-2.5 text-right font-semibold text-emerald-600">{r.direction === 'IN' ? formatCurrency(r.amount) : ''}</td>
                    <td className="figure whitespace-nowrap px-3 py-2.5 text-right font-semibold text-brand-600">{r.direction === 'OUT' ? formatCurrency(r.amount) : ''}</td>
                    <td className="figure whitespace-nowrap px-3 py-2.5 text-right font-bold text-neutral-950">{formatCurrency(r.balanceAfter)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
