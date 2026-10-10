import { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen, AlertTriangle, Printer, CheckCircle2, Sun, Moon, Receipt, Wallet, UserRound, Boxes } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime, formatTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { docRow } from '../../components/docs/DocHeader.jsx';

// Today's Close Day, inside Daily Closing: the business day's status, the
// pending (Draft) invoices that closing will confirm, and the Close Day /
// Open the Day actions. Closing is admin/manager; opening is admin only
// (the server enforces both).
export default function TodayClosingPanel({ onChanged, refreshKey = 0 }) {
  const toast = useToast();
  const { user } = useAuth();
  const canCloseDay = user?.role === 'admin' || user?.role === 'manager';
  const isAdmin = user?.role === 'admin';
  const [preview, setPreview] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(() => {
    client
      .get('/day-close/preview')
      .then((res) => setPreview(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load today’s closing.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load, refreshKey]);

  const handleConfirmClose = async () => {
    setClosing(true);
    try {
      const res = await client.post('/day-close/confirm');
      setConfirmOpen(false);
      setResult(res.data.data);
      toast.success(`Day closed. ${res.data.data.invoiceCount} invoice(s) confirmed.`);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not close the day.');
    } finally {
      setClosing(false);
    }
  };

  const handleOpenDay = async () => {
    setOpening(true);
    try {
      await client.post('/day-close/open');
      toast.success('Business day opened. Seller/POS is available again.');
      setResult(null);
      load();
      onChanged?.();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not open the day.');
    } finally {
      setOpening(false);
    }
  };

  if (!preview) {
    return (
      <section className="flex items-center justify-center rounded-2xl border border-slate-200/70 bg-white py-10 shadow-sm">
        <Spinner />
      </section>
    );
  }

  const isOpen = preview.businessDay.status === 'OPEN';

  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${isOpen ? 'border-emerald-200' : 'border-rose-200'}`}>
      {/* Status + actions */}
      <div className={`flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${isOpen ? 'bg-emerald-50/60' : 'bg-rose-50/60'}`}>
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-md ${isOpen ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-gradient-to-br from-rose-500 to-pink-500'}`}>
            {isOpen ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </div>
          <div>
            <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
              Today · {formatDate(preview.date)}
              <Badge color={isOpen ? 'green' : 'red'}>{isOpen ? 'OPEN' : 'CLOSED'}</Badge>
            </p>
            <p className="text-sm text-slate-500">
              {isOpen
                ? 'Review the pending invoices below, then close the day / xir maalinta.'
                : 'The day is closed. Seller/POS is locked until an admin opens the day.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOpen ? (
            canCloseDay ? (
              <Button onClick={() => setConfirmOpen(true)} disabled={!preview.readyToConfirm}>
                <Lock className="h-4 w-4" /> Close Day
              </Button>
            ) : (
              <Badge color="slate">Only an admin or manager can close the day</Badge>
            )
          ) : isAdmin ? (
            <Button onClick={handleOpenDay} loading={opening}>
              <LockOpen className="h-4 w-4" /> Open the Day
            </Button>
          ) : (
            <Badge color="red">Maalintu waa xiran tahay, fadlan sug Admin inuu furo.</Badge>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="space-y-4 p-5">
          {preview.problems.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
              <div>
                <p className="font-semibold text-rose-700">Some draft invoices need attention before the day can be closed</p>
                <ul className="mt-2 space-y-1 text-sm text-rose-600">
                  {preview.problems.map((p) => (
                    <li key={p.saleId}>
                      <strong>{p.receiptNumber}</strong>: {p.issues.join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={Receipt} label="Pending invoices" value={preview.totalDraftInvoices} />
            <Stat icon={Wallet} label="Pending value" value={formatCurrency(preview.totalDraftValue)} />
            <Stat icon={Wallet} label="Payments received" value={formatCurrency(preview.totalPaymentsReceived)} />
            <Stat icon={Boxes} label="Reserved units" value={preview.totalReservedUnits} />
          </div>

          {(preview.paymentBreakdown.length > 0 || preview.cashierBreakdown.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Breakdown title="Payments by account" icon={Wallet} rows={preview.paymentBreakdown.map((p) => ({ key: p.account, name: p.accountName, amount: p.amount }))} />
              <Breakdown title="Payments by cashier" icon={UserRound} rows={preview.cashierBreakdown.map((c) => ({ key: c.user || c.userName, name: c.userName, amount: c.total }))} />
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Items</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                      No pending invoices to close.
                    </td>
                  </tr>
                ) : (
                  preview.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{inv.receiptNumber}</td>
                      <td className="px-4 py-2.5 text-slate-600">{inv.customerName}</td>
                      <td className="px-4 py-2.5 text-slate-500">{formatTime(inv.createdAt)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{inv.items.length} item(s)</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-800">{formatCurrency(inv.total)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{formatCurrency(inv.paidAmount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={confirmOpen} onClose={() => (closing ? null : setConfirmOpen(false))} title="Confirm Close Day" size="sm">
        <p className="text-sm text-slate-600">
          You are about to close <strong>{formatDate(preview.date)}</strong>.
        </p>
        {preview.totalDraftInvoices > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              {preview.totalDraftInvoices} Draft Invoice{preview.totalDraftInvoices === 1 ? '' : 's'} ayaa jira oo aan la xaqiijin.
            </p>
            <p className="mt-1 text-sm text-amber-700">
              Ma rabtaa inaad xaqiijiso ka hor inta aan maalintu xirmin? Worth <strong>{formatCurrency(preview.totalDraftValue)}</strong> will be confirmed permanently.
            </p>
          </div>
        )}
        <p className="mt-2 text-sm font-medium text-rose-600">
          After confirmation they can no longer be directly edited or deleted. Every operational Account will also be reset to $0 (fully audited).
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={closing}>
            Cancel
          </Button>
          <Button onClick={handleConfirmClose} loading={closing}>
            <Lock className="h-4 w-4" /> Confirm Close Day
          </Button>
        </div>
      </Modal>

      <Modal open={!!result} onClose={() => setResult(null)} title="Day Closed" size="lg">
        {result && <DaySummary result={result} />}
        <div className="mt-5 flex justify-end gap-2 no-print">
          <Button variant="secondary" onClick={() => setResult(null)}>
            Done
          </Button>
          {result && <SharePdfButton fileName={`Day-Closing_${String(result.businessDate).slice(0, 10)}`} message={`${BUSINESS.name} — Day closing ${formatDate(result.businessDate)}: revenue ${formatCurrency(result.revenue)}`} />}
          <Button onClick={() => printReport('portrait')}>
            <Printer className="h-4 w-4" /> Print Day Summary
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-lg font-bold tabular-nums text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function Breakdown({ title, icon: Icon, rows }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No payments yet today.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex justify-between text-sm">
              <span className="text-slate-600">{r.name}</span>
              <span className="font-semibold tabular-nums text-slate-800">{formatCurrency(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The printable summary shown right after closing.
function DaySummary({ result }) {
  return (
    <div id="print-area" className="bg-white text-sm text-neutral-900">
      <DocHeader title="Day Closing" meta={<span className="font-semibold">{formatDate(result.businessDate)}</span>} />
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
        <CheckCircle2 className="h-4 w-4 text-brand-600" /> Closed by {result.closedByName} at {formatDateTime(result.closedAt)}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SummaryRow label="Invoices Confirmed" value={result.invoiceCount} />
        <SummaryRow label="Revenue" value={formatCurrency(result.revenue)} />
        <SummaryRow label="Cost of Goods Sold" value={formatCurrency(result.cogs)} />
        <SummaryRow label="Gross Profit" value={formatCurrency(result.grossProfit)} highlight />
        <SummaryRow label="Payments Received" value={formatCurrency(result.cashCollected)} />
        <SummaryRow label="Credit Created" value={formatCurrency(result.customerCredit)} />
      </div>

      <SummaryList
        title="Payments by account"
        empty="No payments recorded today."
        rows={result.paymentBreakdown.map((p) => ({ key: p.account, name: p.accountName, value: formatCurrency(p.amount) }))}
      />
      <SummaryList
        title="Payments by cashier"
        empty="No payments recorded today."
        rows={result.cashierBreakdown.map((c) => ({ key: c.user || c.userName, name: c.userName, value: formatCurrency(c.total) }))}
      />
      <SummaryList
        title="Account reset (audited)"
        empty="No account balances needed resetting."
        rows={result.accountBalancesBeforeReset.map((a) => ({ key: a.account, name: a.accountName, value: `${formatCurrency(a.balanceBeforeReset)} → $0.00` }))}
      />
    </div>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${highlight ? 'bg-neutral-950 text-white' : 'border border-neutral-200 bg-white'}`}
      style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
    >
      <p className={`text-[10px] uppercase tracking-wider ${highlight ? 'text-white/70' : 'text-neutral-500'}`}>{label}</p>
      <p className={`text-lg font-bold tabular-nums ${highlight ? 'text-white' : 'text-neutral-900'}`}>{value}</p>
    </div>
  );
}

function SummaryList({ title, empty, rows }) {
  return (
    <div className="mt-5">
      <p className="border-b-2 border-neutral-900 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{title}</p>
      {rows.length === 0 ? (
        <p className="py-2 text-neutral-400">{empty}</p>
      ) : (
        rows.map((r, i) => (
          <div key={r.key} className={`flex justify-between px-2 py-1.5 ${docRow(i)}`}>
            <span className="text-neutral-700">{r.name}</span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </div>
        ))
      )}
    </div>
  );
}
