import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer, Save, Wallet, Search, FilePlus2, Eye, History, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import Badge from '../../components/ui/Badge.jsx';
import { printReport } from '../../utils/printReport.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import { PlanPrintSheet, PaidPlan, planPrintRows, round2 } from './VendorPlanShared.jsx';


function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The Vendor Balance Summary: every supplier we owe, with a box to type how
// much to give each this round. Saved while being prepared, printed like the
// paper sheet, then paid all at once (admin/manager).
export default function VendorBalancesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canPay = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState(null);
  const [alloc, setAlloc] = useState({}); // supplierId -> typed text
  const [receipt, setReceipt] = useState({}); // supplierId -> supplier's receipt serial
  const [dirty, setDirty] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [history, setHistory] = useState([]);

  const load = useCallback(() => {
    client
      .get('/purchases/payment-plans')
      .then((res) => setHistory(res.data.data))
      .catch(() => setHistory([]));
    return client
      .get('/purchases/payment-plan')
      .then((res) => {
        const d = res.data.data;
        setData(d);
        const open = d.plan?.status === 'OPEN' ? d.plan : null;
        setAlloc(Object.fromEntries((open?.rows || []).map((r) => [String(r.supplier), String(r.allocation)])));
        setReceipt(Object.fromEntries((open?.rows || []).map((r) => [String(r.supplier), r.receiptNo || ''])));
        setShowPaid(d.plan?.status === 'PAID');
        setDirty(false);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load vendor balances.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(
    () =>
      (data?.balances || []).map((b) => {
        const text = alloc[String(b.supplierId)] ?? '';
        const value = Number(text) || 0;
        let error = '';
        if (text !== '' && (!Number.isFinite(Number(text)) || Number(text) < 0)) error = 'Invalid amount';
        else if (value > b.owed) error = `More than ${formatCurrency(b.owed)} owed`;
        return { ...b, text, value: error ? 0 : value, error, receiptNo: receipt[String(b.supplierId)] ?? '' };
      }),
    [data, alloc, receipt]
  );
  const totalOwed = data?.totalOwed || 0;
  const totalAllocated = round2(rows.reduce((s, r) => s + r.value, 0));
  const hasErrors = rows.some((r) => r.error);
  const allocatedCount = rows.filter((r) => r.value > 0).length;
  const visible = q ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : rows;

  const setReceiptNo = (id, text) => {
    setReceipt((prev) => ({ ...prev, [String(id)]: text }));
    setDirty(true);
  };

  const setOne = (id, text) => {
    setAlloc((prev) => ({ ...prev, [String(id)]: text }));
    setDirty(true);
  };

  const save = async ({ quiet = false } = {}) => {
    if (hasErrors) {
      toast.error('Fix the allocations marked in red first.');
      return false;
    }
    setSaving(true);
    try {
      const res = await client.put('/purchases/payment-plan', {
        rows: rows.filter((r) => r.value > 0).map((r) => ({ supplierId: r.supplierId, allocation: r.value, receiptNo: r.receiptNo.trim() })),
      });
      setData((d) => ({ ...d, plan: res.data.data }));
      setDirty(false);
      if (!quiet) toast.success('Allocations saved.');
      return true;
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save allocations.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!data) return <PageSpinner />;

  const paidPlan = data.plan?.status === 'PAID' ? data.plan : null;
  const printDate = formatDate(paidPlan && showPaid ? paidPlan.paymentDate : new Date());

  // What goes on paper: the paid plan when viewing it, otherwise the sheet being prepared.
  const printRows =
    paidPlan && showPaid
      ? planPrintRows(paidPlan)
      : rows.map((r) => ({ key: String(r.supplierId), name: r.name, owed: r.owed, allocation: r.value, receiptNo: r.value > 0 ? r.receiptNo : '', ok: false }));

  return (
    <div>
      <div className="no-print">
        <Link to="/purchases" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Invoices
        </Link>

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Vendor Balance Summary</h1>
            <p className="text-sm text-slate-500">
              Everything owed to suppliers, and how much to give each one.
              {data.plan && <span className="ml-1 text-slate-400">· {data.plan.planNumber}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {showPaid ? (
              <>
                {canPay && paidPlan && (
                  <Link
                    to={`/purchases/vendor-balances/${paidPlan.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Undo2 className="h-4 w-4" /> Cancel payments
                  </Link>
                )}
                <Button variant="secondary" onClick={() => setShowPaid(false)}>
                  <FilePlus2 className="h-4 w-4" /> New allocation
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => save()} loading={saving} disabled={!dirty || hasErrors}>
                <Save className="h-4 w-4" /> Save
              </Button>
            )}
            <SharePdfButton fileName={`Vendor-Balances_${data.plan?.planNumber || new Date().toISOString().slice(0, 10)}`} message="Vendor Balance Summary" />
            <Button variant="secondary" onClick={() => printReport('portrait')}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            {!showPaid && canPay && (
              <Button onClick={() => setPayOpen(true)} disabled={allocatedCount === 0 || hasErrors}>
                <Wallet className="h-4 w-4" /> Pay allocations
              </Button>
            )}
          </div>
        </div>

        <div className={`mb-4 grid-cols-1 gap-3 sm:grid-cols-3 ${showPaid && paidPlan ? 'hidden' : 'grid'}`}>
          <Stat label="Total owed to suppliers" value={formatCurrency(totalOwed)} hint={`${rows.length} supplier${rows.length === 1 ? '' : 's'}`} />
          <Stat label="Allocated this round" value={formatCurrency(showPaid && paidPlan ? paidPlan.totalPaid : totalAllocated)} hint={showPaid && paidPlan ? 'Paid' : `${allocatedCount} supplier${allocatedCount === 1 ? '' : 's'}`} accent />
          <Stat label="Still owed after" value={formatCurrency(showPaid ? totalOwed : round2(totalOwed - totalAllocated))} hint={showPaid ? 'Current balances' : 'If allocations are paid'} />
        </div>

        {showPaid && paidPlan ? (
          <PaidPlan plan={paidPlan} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" placeholder="Search supplier..." value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-12 px-4 py-2.5 font-medium">#</th>
                    <th className="px-4 py-2.5 font-medium">Supplier</th>
                    <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                    <th className="w-56 px-4 py-2.5 text-right font-medium">Allocation</th>
                    <th className="w-44 px-4 py-2.5 font-medium">Receipt No.</th>
                    <th className="px-4 py-2.5 text-right font-medium">Left after</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                        {rows.length ? 'No supplier matches your search.' : 'No supplier is owed money right now.'}
                      </td>
                    </tr>
                  )}
                  {visible.map((r) => (
                    <tr key={r.supplierId} className={`border-t border-slate-100 ${r.value > 0 ? 'bg-brand-50/40' : ''}`}>
                      <td className="px-4 py-2 text-slate-400">{rows.indexOf(r) + 1}</td>
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-800">{r.name}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-slate-900">{formatCurrency(r.owed)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setOne(r.supplierId, String(r.owed))}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Full
                          </button>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            className="w-32! text-right"
                            placeholder="0.00"
                            value={r.text}
                            error={r.error}
                            onChange={(e) => setOne(r.supplierId, e.target.value)}
                          />
                        </div>
                        {r.error && <p className="mt-0.5 text-right text-xs text-rose-600">{r.error}</p>}
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          className="w-40!"
                          maxLength={60}
                          placeholder={r.value > 0 ? 'Their receipt serial' : '—'}
                          disabled={!(r.value > 0)}
                          value={r.receiptNo}
                          onChange={(e) => setReceiptNo(r.supplierId, e.target.value)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-slate-500">{formatCurrency(round2(r.owed - r.value))}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold text-slate-900">
                      <td className="px-4 py-3" colSpan={2}>
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(totalOwed)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-brand-700">{formatCurrency(totalAllocated)}</td>
                      <td />
                      <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(round2(totalOwed - totalAllocated))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <History className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-slate-900">Saved sheets</h3>
            <span className="text-xs text-slate-400">· every sheet is kept; open one to view or print it again</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-2.5 font-medium">Sheet</th>
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Suppliers</th>
                  <th className="px-5 py-2.5 text-right font-medium">Owed then</th>
                  <th className="px-5 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                      No sheets saved yet.
                    </td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <Link to={`/purchases/vendor-balances/${h.id}`} className="font-semibold text-brand-600 hover:underline">
                        {h.planNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{formatDate(h.status === 'PAID' ? h.paymentDate : h.updatedAt)}</td>
                    <td className="px-5 py-2.5 text-slate-600">{h.supplierCount}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right text-slate-600">{formatCurrency(h.totalOwed)}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold text-slate-900">
                      {h.status === 'PAID' ? formatCurrency(h.totalPaid) : <span className="font-normal text-slate-400">{formatCurrency(h.totalAllocated)} planned</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge color={h.status === 'PAID' ? 'green' : h.status === 'CANCELLED' ? 'red' : 'amber'}>
                        {h.status === 'PAID' ? `Paid · ${h.paymentAccountName}` : h.status === 'CANCELLED' ? 'Cancelled · money returned' : 'Not paid yet'}
                      </Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Link
                        to={`/purchases/vendor-balances/${h.id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Paper copy, laid out like the hand-made sheet. */}
      <PlanPrintSheet rows={printRows} date={printDate} planNumber={data.plan?.planNumber} paid={!!(paidPlan && showPaid)} />

      <PayModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        count={allocatedCount}
        total={totalAllocated}
        beforePay={() => (dirty ? save({ quiet: true }) : true)}
        onPaid={() => {
          setPayOpen(false);
          toast.success('Allocations paid.');
          load();
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint, accent }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${accent ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ? 'text-brand-700' : 'text-slate-900'}`}>{value}</p>
      <p className="text-xs text-slate-400">{hint}</p>
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
      await client.post('/purchases/payment-plan/pay', { paymentAccountId: accountId, paymentDate });
      onPaid();
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
      title="Pay allocations"
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
          <p className="text-xs uppercase tracking-wide text-neutral-400">Paying {count} supplier{count === 1 ? '' : 's'}</p>
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
        <p className="text-xs text-slate-500">
          Each supplier is paid oldest invoice first and gets its own receipt. If anything fails, nothing is paid.
        </p>
      </div>
    </Modal>
  );
}
