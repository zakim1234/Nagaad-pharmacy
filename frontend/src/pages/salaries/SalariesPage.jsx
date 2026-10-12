import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Banknote, CheckCircle2, Eye, History, Printer, Save, Undo2, Wallet, Copy } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocTotals, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';
import CancelPaymentDialog from '../purchases/CancelPaymentDialog.jsx';

const round2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const todayString = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const periodLabel = (p) => (p ? new Date(`${p}-01T12:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '');
const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier', custom: 'Staff' };

// Paper copy of a salary sheet: each person, the amount, and a line for them
// to sign when they are paid.
function SalaryPrintSheet({ id = 'print-area', sheetNumber, period, rows, paid, hidden = true }) {
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return (
    <div id={id} className={`${hidden ? 'hidden print:block' : ''} bg-white text-neutral-900`}>
      <DocHeader
        title="Salary Sheet"
        meta={
          <span>
            <span className="font-semibold">{periodLabel(period)}</span>
            {sheetNumber && <span className="ml-3 text-neutral-400">{sheetNumber}</span>}
          </span>
        }
      />
      <table className="mt-4 w-full border-collapse text-[12px]">
        <thead>
          <tr className={`${DOC_THEAD_ROW} text-left`}>
            <th className={`${DOC_TH} w-10`}>#</th>
            <th className={DOC_TH}>Name</th>
            <th className={DOC_TH}>Role</th>
            <th className={`${DOC_TH} text-right`}>Salary</th>
            <th className={`${DOC_TH} w-40 text-center`}>{paid ? 'Paid' : 'Signature'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={docRow(i)}>
              <td className="px-2 py-2.5 text-neutral-500">{i + 1}</td>
              <td className="px-2 py-2.5 font-medium">{r.name}</td>
              <td className="px-2 py-2.5 text-neutral-600">{ROLE_LABEL[r.role] || r.role}</td>
              <td className="px-2 py-2.5 text-right font-bold tabular-nums text-brand-700">{formatCurrency(r.amount)}</td>
              <td className="px-2 py-2.5 text-center">
                {paid ? <span className="text-[11px] font-semibold">✓ {r.expenseNumber}</span> : <span className="inline-block w-32 border-b border-neutral-400">&nbsp;</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-900 font-bold">
            <td className="px-2 py-2.5 uppercase tracking-wider" colSpan={3}>
              Total
            </td>
            <td className="px-2 py-2.5 text-right tabular-nums text-brand-700">{formatCurrency(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="mt-6">
        <DocTotals items={[['People', String(rows.length)], ['Total salaries', formatCurrency(total)], ['Month', periodLabel(period)]]} />
      </div>
      <div className="mt-14 grid grid-cols-2 gap-16 text-[11px] text-neutral-600">
        <p className="border-t border-neutral-900 pt-1.5 text-center">Prepared by</p>
        <p className="border-t border-neutral-900 pt-1.5 text-center">Approved by</p>
      </div>
    </div>
  );
}

function PayModal({ open, onClose, count, total, beforePay, onPaid }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAccountId('');
    setPaymentDate(todayString());
    client.get('/accounts').then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive))).catch(() => setAccounts([]));
  }, [open]);

  const pay = async () => {
    setSaving(true);
    try {
      if (!(await beforePay())) return;
      const res = await client.post('/salaries/sheet/pay', { paymentAccountId: accountId, paymentDate });
      onPaid(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Payment failed. Nothing was paid.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => (saving ? null : onClose())}
      title="Pay salaries"
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={pay} disabled={!accountId} loading={saving}>
            Pay {formatCurrency(total)}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-neutral-950 px-4 py-3 text-white">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Paying {count} {count === 1 ? 'person' : 'people'}</p>
          <p className="text-2xl font-bold">{formatCurrency(total)}</p>
        </div>
        <FormField label="Pay from account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {formatCurrency(a.currentBalance)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Payment date" required>
          <Input type="date" value={paymentDate} max={todayString()} onChange={(e) => setPaymentDate(e.target.value)} />
        </FormField>
        <p className="text-xs text-slate-500">Each salary is recorded as a "Salaries" expense. If anything fails, nothing is paid.</p>
      </div>
    </Modal>
  );
}

// The salary sheet being prepared: everyone who works here, a salary box
// each, then Save / Print / Pay salaries (all at once, from one account).
export default function SalariesPage() {
  const { id } = useParams();
  if (id) return <SalarySheetView id={id} />;
  return <SalarySheetEditor />;
}

function SalarySheetEditor() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [period, setPeriod] = useState(thisMonth());
  const [amounts, setAmounts] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const load = useCallback(() => {
    client.get('/salaries/sheets').then((r) => setHistory(r.data.data)).catch(() => setHistory([]));
    return client
      .get('/salaries/sheet')
      .then((res) => {
        const d = res.data.data;
        setData(d);
        if (d.open) {
          setPeriod(d.open.period);
          setAmounts(Object.fromEntries(d.open.rows.map((r) => [String(r.user), String(r.amount)])));
        } else {
          setPeriod(thisMonth());
          setAmounts({});
        }
        setDirty(false);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load salaries.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const lastByUser = useMemo(() => new Map((data?.lastPaid?.rows || []).map((r) => [String(r.user), r.amount])), [data]);
  const rows = useMemo(
    () =>
      (data?.people || []).map((p) => {
        const text = amounts[String(p.userId)] ?? '';
        const num = Number(text);
        const error = text !== '' && (!Number.isFinite(num) || num < 0) ? 'Invalid amount' : '';
        return { ...p, text, value: error ? 0 : num || 0, error, last: lastByUser.get(String(p.userId)) };
      }),
    [data, amounts, lastByUser]
  );
  const total = round2(rows.reduce((s, r) => s + r.value, 0));
  const count = rows.filter((r) => r.value > 0).length;
  const hasErrors = rows.some((r) => r.error);

  const setOne = (uid, text) => {
    setAmounts((prev) => ({ ...prev, [String(uid)]: text }));
    setDirty(true);
  };
  const fillFromLast = () => {
    setAmounts(Object.fromEntries(rows.filter((r) => r.last).map((r) => [String(r.userId), String(r.last)])));
    setDirty(true);
  };

  const save = async ({ quiet = false } = {}) => {
    if (hasErrors) {
      toast.error('Fix the amounts marked in red first.');
      return false;
    }
    setSaving(true);
    try {
      const res = await client.put('/salaries/sheet', { period, rows: rows.filter((r) => r.value > 0).map((r) => ({ userId: r.userId, amount: r.value })) });
      setData((d) => ({ ...d, open: res.data.data }));
      setDirty(false);
      if (!quiet) toast.success('Salary sheet saved.');
      return true;
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the salary sheet.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <PageSpinner />;
  const printRows = rows.filter((r) => r.value > 0).map((r) => ({ key: String(r.userId), name: r.name, role: r.role, amount: r.value }));

  return (
    <div>
      <div className="no-print">
        <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-6 text-white shadow-lg shadow-black/20">
          <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-red-600/25 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <Banknote className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Salaries</h1>
                <p className="text-sm text-white/70">Everyone who works here, the salary to give each, paid all at once.</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-white/60">This sheet</p>
              <p className="text-3xl font-bold tabular-nums">{formatCurrency(total)}</p>
              <p className="text-xs text-white/60">
                {count} {count === 1 ? 'person' : 'people'} · {periodLabel(period)}
              </p>
            </div>
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Month">
              <Input
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setDirty(true);
                }}
                className="w-44!"
              />
            </FormField>
            {data.lastPaid && (
              <Button variant="secondary" onClick={fillFromLast}>
                <Copy className="h-4 w-4" /> Same as {periodLabel(data.lastPaid.period)}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => save()} loading={saving} disabled={!dirty || hasErrors}>
              <Save className="h-4 w-4" /> Save
            </Button>
            <Button variant="secondary" onClick={() => printReport('portrait')} disabled={count === 0}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <SharePdfButton fileName={`Salaries_${period}`} message={`${BUSINESS.name} — salaries ${periodLabel(period)}: ${formatCurrency(total)}`} />
            <Button onClick={() => setPayOpen(true)} disabled={count === 0 || hasErrors}>
              <Wallet className="h-4 w-4" /> Pay salaries
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              {data.open ? `${data.open.sheetNumber} · being prepared` : 'New salary sheet'}
            </p>
            {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-12 px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 text-right font-medium">Last paid</th>
                  <th className="w-56 px-4 py-2.5 text-right font-medium">Salary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={String(r.userId)} className={`border-t border-slate-100 ${r.value > 0 ? 'bg-brand-50/40' : ''}`}>
                    <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-slate-800">{r.name}</p>
                      <p className="text-xs text-slate-400">@{r.username}</p>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{ROLE_LABEL[r.role] || r.role}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-slate-400">{r.last ? formatCurrency(r.last) : '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          className="w-36! text-right"
                          placeholder="0.00"
                          value={r.text}
                          error={r.error}
                          onChange={(e) => setOne(r.userId, e.target.value)}
                        />
                      </div>
                      {r.error && <p className="mt-0.5 text-right text-xs text-rose-600">{r.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                  <td className="px-4 py-3" colSpan={4}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right text-brand-700">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <SavedSheets history={history} />
      </div>

      <SalaryPrintSheet sheetNumber={data.open?.sheetNumber} period={period} rows={printRows} />

      <PayModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        count={count}
        total={total}
        beforePay={() => (dirty || !data.open ? save({ quiet: true }) : true)}
        onPaid={(sheet) => {
          setPayOpen(false);
          toast.success(`${sheet.sheetNumber} paid — ${formatCurrency(sheet.total)} from ${sheet.paymentAccountName}.`);
          load();
        }}
      />
    </div>
  );
}

function SavedSheets({ history }) {
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
        <History className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900">Saved salary sheets</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 font-medium">Sheet</th>
              <th className="px-5 py-2.5 font-medium">Month</th>
              <th className="px-5 py-2.5 font-medium">People</th>
              <th className="px-5 py-2.5 text-right font-medium">Total</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
              <th className="px-5 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                  No salary sheets yet.
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-5 py-2.5 font-semibold text-brand-600">{h.sheetNumber}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{periodLabel(h.period)}</td>
                <td className="px-5 py-2.5 text-slate-600">{h.rows.length}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold text-slate-900">{formatCurrency(h.total)}</td>
                <td className="px-5 py-2.5">
                  <Badge color={h.status === 'PAID' ? 'green' : h.status === 'CANCELLED' ? 'red' : 'amber'}>
                    {h.status === 'PAID' ? `Paid · ${h.paymentAccountName}` : h.status === 'CANCELLED' ? 'Cancelled · money returned' : 'Being prepared'}
                  </Badge>
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Link to={`/salaries/${h.id}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    <Eye className="h-3.5 w-3.5" /> View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One saved sheet: view, print, send, and (when paid) cancel.
function SalarySheetView({ id }) {
  const toast = useToast();
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    client
      .get(`/salaries/sheets/${id}`)
      .then((r) => setSheet(r.data.data))
      .catch((err) => setError(err.friendlyMessage || 'Salary sheet not found.'));
  }, [id]);

  const cancel = async (reason) => {
    setCancelling(true);
    try {
      const res = await client.post(`/salaries/sheets/${id}/cancel`, { reason });
      toast.success(`${res.data.data.sheetNumber} cancelled — ${formatCurrency(res.data.data.refunded)} back in ${res.data.data.paymentAccountName}.`);
      setCancelOpen(false);
      setSheet(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel these salaries.');
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">{error}</div>;
  if (!sheet) return <PageSpinner />;
  const paid = sheet.status === 'PAID' || sheet.status === 'CANCELLED';
  const rows = sheet.rows.map((r) => ({ key: String(r.user), name: r.name, role: r.role, amount: r.amount, expenseNumber: r.expenseNumber }));

  return (
    <div>
      <div className="no-print">
        <Link to="/salaries" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Salaries
        </Link>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
              {sheet.sheetNumber}
              <Badge color={sheet.status === 'PAID' ? 'green' : sheet.status === 'CANCELLED' ? 'red' : 'amber'}>
                {sheet.status === 'PAID' ? 'Paid' : sheet.status === 'CANCELLED' ? 'Cancelled' : 'Being prepared'}
              </Badge>
            </h1>
            <p className="text-sm text-slate-500">
              Salaries · {periodLabel(sheet.period)}
              {sheet.paidAt && ` · paid ${formatDate(sheet.paymentDate)} from ${sheet.paymentAccountName}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sheet.status === 'PAID' && (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                <Undo2 className="h-4 w-4" /> Cancel payments
              </Button>
            )}
            <SharePdfButton fileName={`Salaries_${sheet.period}_${sheet.sheetNumber}`} message={`${BUSINESS.name} — salaries ${periodLabel(sheet.period)}`} />
            <Button variant="secondary" onClick={() => printReport('portrait')}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </div>
        {sheet.status === 'CANCELLED' && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p className="font-bold">CANCELLED — the money went back to {sheet.paymentAccountName}.</p>
            <p className="text-xs">
              {formatDateTime(sheet.cancelledAt)}
              {sheet.cancelledByName ? ` by ${sheet.cancelledByName}` : ''}
              {sheet.cancelReason ? ` · ${sheet.cancelReason}` : ''}
            </p>
          </div>
        )}
        {sheet.status === 'PAID' && (
          <p className="mb-4 flex items-center gap-1.5 text-sm text-slate-600">
            <CheckCircle2 className="h-4 w-4 text-brand-600" /> Recorded {formatDateTime(sheet.paidAt)}
            {sheet.paidByName ? ` by ${sheet.paidByName}` : ''} · each salary is a "Salaries" expense
          </p>
        )}
      </div>

      <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <SalaryPrintSheet sheetNumber={sheet.sheetNumber} period={sheet.period} rows={rows} paid={paid} hidden={false} />
      </div>

      <CancelPaymentDialog
        open={cancelOpen}
        title={`Cancel salaries ${sheet.sheetNumber}`}
        amount={sheet.total}
        account={sheet.paymentAccountName}
        loading={cancelling}
        onConfirm={cancel}
        onClose={() => setCancelOpen(false)}
      />
    </div>
  );
}
