import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { BUSINESS } from '../../constants/business.js';
import logo from '../../images/logo.png';

export const round2 = (n) => Math.round(n * 100) / 100;

// Rows of a saved plan in the shape the printed sheet takes.
export const planPrintRows = (plan) =>
  plan.rows.map((r) => ({ key: String(r.supplier), name: r.supplierName, owed: r.owed, allocation: r.allocation, receiptNo: r.receiptNo || '', ok: r.paid > 0 }));

// The paper copy of a Vendor Balance Summary, laid out like the hand-made
// sheet. Hidden on screen; only shown when printing.
export function PlanPrintSheet({ rows, date, planNumber, paid }) {
  const printOwed = round2(rows.reduce((s, r) => s + r.owed, 0));
  const printAllocated = round2(rows.reduce((s, r) => s + r.allocation, 0));
  return (
    <div id="print-area" className="hidden bg-white text-neutral-900 print:block" style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt={BUSINESS.name} className="h-20 w-auto object-contain" />
        <h1 className="mt-1 text-xl font-extrabold uppercase tracking-[0.2em]">{BUSINESS.name}</h1>
        <p className="text-[11px] text-neutral-600">{BUSINESS.addressLine} · {BUSINESS.phone}</p>
      </div>

      <div className="mt-4 h-1 bg-brand-600" />
      <div className="flex items-center justify-between bg-neutral-950 px-4 py-2 text-white">
        <p className="text-sm font-bold uppercase tracking-[0.25em]">Vendor Balance Summary</p>
        <p className="text-[11px]">
          Date: <span className="font-semibold">{date}</span>
          {planNumber && <span className="ml-3 text-neutral-400">{planNumber}</span>}
        </p>
      </div>

      <table className="mt-4 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b-2 border-neutral-900 text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="w-10 px-3 py-2 text-left font-semibold">#</th>
            <th className="px-3 py-2 text-left font-semibold">Vendor</th>
            <th className="px-3 py-2 text-right font-semibold">Balance</th>
            <th className="px-3 py-2 text-right font-semibold">Allocation</th>
            <th className="px-3 py-2 text-left font-semibold">Receipt No.</th>
            <th className="w-16 px-3 py-2 text-center font-semibold">OK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={`border-b border-neutral-200 ${i % 2 ? 'bg-neutral-50' : ''}`}>
              <td className="px-3 py-2 text-neutral-500">{i + 1}</td>
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(r.owed)}</td>
              <td className="px-3 py-2 text-right font-bold text-brand-700">{r.allocation > 0 ? formatCurrency(r.allocation) : '—'}</td>
              <td className="px-3 py-2">{r.receiptNo || <span className="inline-block w-20 border-b border-dotted border-neutral-400">&nbsp;</span>}</td>
              <td className="px-3 py-2 text-center">
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-sm border text-[11px] font-bold leading-none ${r.ok ? 'border-brand-600 text-brand-600' : 'border-neutral-400'}`}>
                  {r.ok ? '✓' : ''}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-900 font-bold">
            <td className="px-3 py-2.5 uppercase tracking-wider" colSpan={2}>
              Total
            </td>
            <td className="px-3 py-2.5 text-right">{formatCurrency(printOwed)}</td>
            <td className="px-3 py-2.5 text-right text-brand-700">{formatCurrency(printAllocated)}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-neutral-300 px-4 py-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">Total owed to all suppliers</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(printOwed)}</p>
        </div>
        <div className="rounded-lg bg-brand-600 px-4 py-3 text-center text-white">
          <p className="text-[10px] uppercase tracking-wider text-white/80">Total {paid ? 'paid' : 'allocated'}</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(printAllocated)}</p>
        </div>
        <div className="rounded-lg bg-neutral-950 px-4 py-3 text-center text-white">
          <p className="text-[10px] uppercase tracking-wider text-neutral-400">Remaining</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(round2(printOwed - printAllocated))}</p>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-16 text-[11px] text-neutral-600">
        <p className="border-t border-neutral-900 pt-1.5 text-center">Prepared by</p>
        <p className="border-t border-neutral-900 pt-1.5 text-center">Approved by</p>
      </div>
    </div>
  );
}

// A paid plan: who was paid what, from which account, with each receipt.
export function PaidPlan({ plan }) {
  const paidRows = plan.rows.filter((r) => r.paid > 0).length;
  const owedBefore = round2(plan.rows.reduce((s, r) => s + r.owed, 0));
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-bold">
                {plan.status === 'CANCELLED' ? 'Payments cancelled' : 'Payments done'} · {formatDate(plan.paymentDate)}
              </p>
              <p className="text-xs text-neutral-400">
                From {plan.paymentAccountName} · recorded {formatDateTime(plan.paidAt)}
                {plan.paidByName ? ` by ${plan.paidByName}` : ''}
              </p>
              {plan.status === 'CANCELLED' && (
                <p className="text-xs font-semibold text-brand-400">
                  Cancelled {formatDateTime(plan.cancelledAt)}
                  {plan.cancelledByName ? ` by ${plan.cancelledByName}` : ''} — all money went back to the account{plan.cancelReason ? ` · ${plan.cancelReason}` : ''}
                </p>
              )}
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
            {paidRows} supplier{paidRows === 1 ? '' : 's'} paid
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-white/5">
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Owed before</p>
            <p className="text-lg font-bold">{formatCurrency(owedBefore)}</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Paid</p>
            <p className="text-lg font-bold text-brand-400">{formatCurrency(plan.totalPaid)}</p>
          </div>
          <div className="px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Left after</p>
            <p className="text-lg font-bold">{formatCurrency(round2(owedBefore - plan.totalPaid))}</p>
          </div>
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {plan.rows.map((r, i) => {
          const pct = r.owed > 0 ? Math.min(100, Math.round((r.paid / r.owed) * 100)) : 0;
          return (
            <li key={String(r.supplier)} className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-slate-50/60">
              <span className="w-5 text-sm text-slate-400">{i + 1}</span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                {r.supplierName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase())
                  .join('')}
              </span>
              <div className="min-w-[180px] flex-1">
                <p className="font-semibold text-slate-900">
                  {r.supplierName}
                  {r.receiptNo && <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">Receipt No. {r.receiptNo}</span>}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[11px] text-slate-400">{pct}% of balance</span>
                </div>
              </div>
              <div className="w-24 text-right text-xs">
                <p className="text-slate-400">Balance</p>
                <p className="font-medium text-slate-700">{formatCurrency(r.owed)}</p>
              </div>
              <div className="w-24 text-right text-xs">
                <p className="text-slate-400">Paid</p>
                <p className="text-sm font-bold text-brand-700">{formatCurrency(r.paid)}</p>
              </div>
              <div className="w-24 text-right text-xs">
                <p className="text-slate-400">Left</p>
                <p className="font-medium text-slate-700">{formatCurrency(round2(r.owed - r.paid))}</p>
              </div>
              <div className="w-40 text-right">
                {r.bulkPayment ? (
                  <Link
                    to={`/purchases/bulk-payments/${r.bulkPayment}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:text-brand-600"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" /> Receipt {r.bulkNumber.replace(/^BPAY-\d{4}-0*/, '#')}
                    {r.cancelled && <span className="ml-1 rounded bg-rose-100 px-1 text-[10px] font-bold uppercase text-rose-700">Cancelled</span>}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">Nothing owed at payment</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between border-t-2 border-slate-900 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-900">
        <span>Total</span>
        <span>
          <span className="mr-4 text-xs font-medium text-slate-500">Allocated {formatCurrency(plan.totalAllocated)}</span>
          Paid <span className="text-brand-700">{formatCurrency(plan.totalPaid)}</span>
        </span>
      </div>
    </div>
  );
}
