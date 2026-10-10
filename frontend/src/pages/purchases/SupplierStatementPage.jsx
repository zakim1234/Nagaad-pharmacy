import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, PackagePlus, Banknote } from 'lucide-react';
import client from '../../api/client.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import logo from '../../images/logo.png';

const FILTERS = [
  ['ALL', 'Everything'],
  ['INVOICE', 'Goods invoices'],
  ['PAYMENT', 'Payments'],
];

// A supplier's statement, for reconciling with them: the goods invoices we
// received (their invoice serial numbers) and the payments we made (the
// serial numbers on their payment receipts), with what we owe after each.
// Payments come off the supplier's total, never off a particular invoice.
export default function SupplierStatementPage() {
  const { supplierId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    client
      .get(`/purchases/suppliers/${supplierId}/statement`)
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Could not load this statement.'));
  }, [supplierId]);

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <PageSpinner />;

  const { supplier, lines, totals } = data;
  const shown = filter === 'ALL' ? lines : lines.filter((l) => l.kind === filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link to={`/purchases?supplier=${supplier.id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to {supplier.name}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === key ? 'bg-neutral-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div
        id="print-area"
        className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
      >
        <div className="flex flex-col items-center text-center">
          <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
          <h1 className="mt-1 text-lg font-extrabold uppercase tracking-[0.2em]">{BUSINESS.name}</h1>
          <p className="text-[11px] text-neutral-600">
            {BUSINESS.addressLine} · {BUSINESS.phone}
          </p>
        </div>

        <div className="mt-4 h-1 bg-brand-600" />
        <div className="flex flex-wrap items-center justify-between gap-2 bg-neutral-950 px-4 py-2 text-white">
          <p className="text-sm font-bold uppercase tracking-[0.25em]">Supplier Statement</p>
          <p className="text-[11px]">
            Date: <span className="font-semibold">{formatDate(data.asOf)}</span>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-neutral-500">Supplier</p>
            <p className="text-lg font-bold">{supplier.name}</p>
            {(supplier.phone || supplier.address) && <p className="text-xs text-neutral-500">{[supplier.phone, supplier.address].filter(Boolean).join(' · ')}</p>}
          </div>
          <div className="text-right text-xs text-neutral-500">
            <p>
              {totals.invoiceCount} goods invoice{totals.invoiceCount === 1 ? '' : 's'} · {totals.paymentCount} payment{totals.paymentCount === 1 ? '' : 's'}
            </p>
            {filter !== 'ALL' && <p className="font-semibold text-neutral-700">Showing {filter === 'INVOICE' ? 'goods invoices' : 'payments'} only</p>}
          </div>
        </div>

        <table className="mt-4 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left text-[10px] uppercase tracking-wider text-neutral-500">
              <th className="px-2 py-2 font-semibold">Date</th>
              <th className="px-2 py-2 font-semibold">Type</th>
              <th className="px-2 py-2 font-semibold">Serial No.</th>
              <th className="px-2 py-2 font-semibold">Our ref.</th>
              <th className="px-2 py-2 text-right font-semibold">Goods</th>
              <th className="px-2 py-2 text-right font-semibold">Paid</th>
              {filter === 'ALL' && <th className="px-2 py-2 text-right font-semibold">Balance</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-8 text-center text-neutral-400">
                  Nothing to show yet.
                </td>
              </tr>
            )}
            {shown.map((l, i) => {
              const invoice = l.kind === 'INVOICE';
              const to = invoice ? `/purchases/${l.id}` : l.bulk ? `/purchases/bulk-payments/${l.id}` : null;
              return (
                <tr key={`${l.kind}-${l.id}`} className={`border-b border-neutral-200 ${i % 2 ? 'bg-neutral-50' : ''}`}>
                  <td className="whitespace-nowrap px-2 py-2">{formatDate(l.date)}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className={`inline-flex items-center gap-1 font-semibold ${invoice ? 'text-neutral-800' : 'text-brand-700'}`}>
                      {invoice ? <PackagePlus className="h-3.5 w-3.5" /> : <Banknote className="h-3.5 w-3.5" />}
                      {invoice ? 'Goods invoice' : 'Payment'}
                    </span>
                    {!invoice && l.account && <span className="block text-[10px] text-neutral-500">from {l.account}</span>}
                  </td>
                  <td className="px-2 py-2 font-semibold">{l.serialNo || <span className="font-normal text-neutral-400">—</span>}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-neutral-500">
                    {to ? (
                      <Link to={to} className="hover:text-brand-600 hover:underline print:no-underline">
                        {l.reference}
                      </Link>
                    ) : (
                      l.reference
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{l.goods ? formatCurrency(l.goods) : ''}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-brand-700">{l.paid ? formatCurrency(l.paid) : ''}</td>
                  {filter === 'ALL' && <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{formatCurrency(l.balance)}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-900 font-bold">
              <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={4}>
                Total
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right">{filter !== 'PAYMENT' ? formatCurrency(totals.bought) : ''}</td>
              <td className="whitespace-nowrap px-2 py-2.5 text-right text-brand-700">{filter !== 'INVOICE' ? formatCurrency(totals.paid) : ''}</td>
              {filter === 'ALL' && <td className="whitespace-nowrap px-2 py-2.5 text-right">{formatCurrency(totals.remaining)}</td>}
            </tr>
          </tfoot>
        </table>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-neutral-300 px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-neutral-500">Total goods taken</p>
            <p className="mt-1 text-lg font-bold">{formatCurrency(totals.bought)}</p>
          </div>
          <div className="rounded-lg bg-brand-600 px-4 py-3 text-center text-white">
            <p className="text-[10px] uppercase tracking-wider text-white/80">Total paid</p>
            <p className="mt-1 text-lg font-bold">{formatCurrency(totals.paid)}</p>
          </div>
          <div className="rounded-lg bg-neutral-950 px-4 py-3 text-center text-white">
            <p className="text-[10px] uppercase tracking-wider text-neutral-400">Remaining owed</p>
            <p className="mt-1 text-lg font-bold">{formatCurrency(totals.remaining)}</p>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-16 text-[11px] text-neutral-600">
          <p className="border-t border-neutral-900 pt-1.5 text-center">{BUSINESS.name}</p>
          <p className="border-t border-neutral-900 pt-1.5 text-center">{supplier.name}</p>
        </div>
        <p className="mt-4 text-center text-[10px] text-neutral-400">Printed {formatDateTime(new Date())}</p>
      </div>
    </div>
  );
}
