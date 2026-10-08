import { useCallback, useEffect, useState } from 'react';
import { Calculator as CalculatorIcon, History as HistoryIcon, CheckCircle2, Pencil, Trash2, Moon, Wallet, Package, Users, Building2, Truck } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ZakatCalculator({ onConfirmed }) {
  const toast = useToast();
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('2.5');
  const [includeFixedAssets, setIncludeFixedAssets] = useState(false);
  // Debounced individually: each is a primitive, stable across renders by
  // value. An inline `{ date, rate, includeFixedAssets }` object literal
  // would be a new reference every render, which inside useDebounce's own
  // effect (keyed on that reference) re-arms its timer every render --
  // never settling, and hammering the API in an infinite loop.
  const debouncedDate = useDebounce(date, 300);
  const debouncedRate = useDebounce(rate, 300);
  const debouncedIncludeFixedAssets = useDebounce(includeFixedAssets, 300);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);

  const [deductionMode, setDeductionMode] = useState('MANUAL');
  const [paymentAccountId, setPaymentAccountId] = useState(null);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setLoading(true);
    client
      .get('/zakat/preview', { params: { date: debouncedDate, rate: debouncedRate, includeFixedAssets: debouncedIncludeFixedAssets } })
      .then((res) => setPreview(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to calculate Zakat.'))
      .finally(() => setLoading(false));
  }, [debouncedDate, debouncedRate, debouncedIncludeFixedAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (deductionMode === 'AUTO' && !paymentAccountId) return toast.error('Select the account Zakat will be deducted from.');
    setConfirming(true);
    try {
      await client.post('/zakat', { date, rate, includeFixedAssets, deductionMode, paymentAccountId, note });
      toast.success(deductionMode === 'AUTO' ? 'Zakat confirmed and deducted.' : 'Zakat calculation recorded.');
      setNote('');
      onConfirmed();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not confirm Zakat.');
    } finally {
      setConfirming(false);
    }
  };

  const modeCard = (value, title, text) => (
    <button
      type="button"
      onClick={() => setDeductionMode(value)}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        deductionMode === value ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          deductionMode === value ? 'border-brand-600' : 'border-slate-300'
        }`}
      >
        {deductionMode === value && <span className="h-2 w-2 rounded-full bg-brand-600" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Hero: the answer first, with the settings that change it. */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-6 px-6 pt-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-400">
              <Moon className="h-3.5 w-3.5" /> Zakat due{preview ? ` · ${preview.hijriYear} AH` : ''}
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight">{preview ? formatCurrency(preview.zakatDue) : '—'}</p>
            <p className="mt-1 text-sm text-neutral-400">
              {preview ? (
                <>
                  {preview.ratePct}% of net zakatable wealth <span className="font-semibold text-white">{formatCurrency(preview.netZakatableWealth)}</span>
                </>
              ) : (
                'Calculating…'
              )}
            </p>
          </div>
          {loading && preview && <span className="text-xs text-neutral-400">Updating…</span>}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-white/10 bg-white/5 px-6 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">Calculation date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-brand-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-400">Zakat rate (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-brand-400"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/15 px-3 py-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={includeFixedAssets} onChange={(e) => setIncludeFixedAssets(e.target.checked)} />
            Include Fixed Assets
          </label>
        </div>
      </div>

      {loading && !preview ? (
        <PageSpinner />
      ) : preview ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* How it was worked out */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">How it is calculated</h3>
              <p className="text-xs text-slate-400">What the business owns, minus what it owes, times the rate.</p>
            </div>
            <div className="space-y-1 p-3">
              <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Zakatable assets</p>
              <CalcLine icon={Wallet} label="Cash & bank balances" hint="All accounts" value={preview.assets.cash} />
              <CalcLine icon={Package} label="Inventory value" hint="Stock at cost" value={preview.assets.inventory} />
              <CalcLine icon={Users} label="Accounts receivable" hint="Customer debt" value={preview.assets.receivable} />
              {includeFixedAssets && <CalcLine icon={Building2} label="Fixed assets" hint="Included by choice" value={preview.assets.fixedAssets} />}
              <div className="mx-2 flex items-center justify-between border-t border-slate-200 pt-2 pb-1 text-sm font-bold text-slate-900">
                <span>Total zakatable assets</span>
                <span className="tabular-nums">{formatCurrency(preview.assets.total)}</span>
              </div>

              <p className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Less what is owed</p>
              <CalcLine icon={Truck} label="Accounts payable" hint="Supplier debt" value={preview.liabilities.payable} minus />

              <div className="mt-3 flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">Net zakatable wealth</span>
                <span className="text-lg font-bold tabular-nums text-slate-900">{formatCurrency(preview.netZakatableWealth)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-brand-600 px-4 py-3 text-white">
                <span className="text-sm font-semibold">× {preview.ratePct}% = Zakat due</span>
                <span className="text-xl font-bold tabular-nums">{formatCurrency(preview.zakatDue)}</span>
              </div>
            </div>
            <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
              Approximate Hijri year for this date: {preview.hijriYear} AH. Fixed Assets aren't included by default — most fatwas treat trade goods only.
            </p>
          </div>

          <div className="space-y-4">
            {preview.breakdown.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-3.5">
                  <h3 className="text-sm font-semibold text-slate-900">Share by partner</h3>
                </div>
                <ul className="divide-y divide-slate-100">
                  {preview.breakdown.map((b) => (
                    <li key={b.partnerId} className="px-5 py-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800">{b.partnerName}</span>
                        <span className="font-bold tabular-nums text-slate-900">{formatCurrency(b.share)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-neutral-900" style={{ width: `${Math.min(100, b.equityPct)}%` }} />
                        </div>
                        <span className="w-12 text-right text-xs text-slate-500">{b.equityPct}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-3.5">
                <h3 className="text-sm font-semibold text-slate-900">Confirm Zakat</h3>
                <p className="text-xs text-slate-400">How will it be paid?</p>
              </div>
              <div className="space-y-3 p-5">
                {modeCard('AUTO', 'Deduct automatically', 'Taken from an account as an Expense (category "Zakat").')}
                {modeCard('MANUAL', 'Just record it', 'Each partner pays their own share; no money moves in the system.')}
                {deductionMode === 'AUTO' && (
                  <FormField label="Payment Account" required>
                    <AccountSelect value={paymentAccountId} onChange={setPaymentAccountId} placeholder="Select account..." />
                  </FormField>
                )}
                <FormField label="Note">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </FormField>
                <Button size="lg" className="w-full justify-center" loading={confirming} disabled={!(preview.zakatDue > 0)} onClick={confirm}>
                  <CheckCircle2 className="h-4 w-4" /> Confirm {formatCurrency(preview.zakatDue)} Zakat
                </Button>
                {!(preview.zakatDue > 0) && <p className="text-center text-xs text-slate-400">Zakat due is zero — nothing to confirm for this date/rate.</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CalcLine({ icon: Icon, label, hint, value, minus = false }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${minus ? 'bg-brand-50 text-brand-600' : 'bg-neutral-100 text-neutral-700'}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <span className={`text-sm font-semibold tabular-nums ${minus ? 'text-brand-600' : value < 0 ? 'text-brand-600' : 'text-slate-900'}`}>
        {minus ? `− ${formatCurrency(value)}` : formatCurrency(value)}
      </span>
    </div>
  );
}

// Direct field-level correction of an already-confirmed record -- it never
// moves money. Changing Mode/Account here only relabels what the record
// says happened; if it was AUTO, the real Expense/Account deduction made at
// confirm time is untouched no matter what's edited here.
function ZakatEditModal({ record, onClose, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [rate, setRate] = useState('');
  const [totalZakat, setTotalZakat] = useState('');
  const [deductionMode, setDeductionMode] = useState('MANUAL');
  const [paymentAccountId, setPaymentAccountId] = useState(null);
  const [status, setStatus] = useState('RECORDED');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!record) return;
    setDate(record.calculationDate.slice(0, 10));
    setRate(String(record.ratePct));
    setTotalZakat(String(record.zakatDue));
    setDeductionMode(record.deductionMode);
    setPaymentAccountId(null); // re-selected explicitly if changing to/staying Auto
    setStatus(record.status);
    setNote(record.note || '');
  }, [record]);

  const save = async () => {
    if (!(Number(rate) >= 0) || Number(rate) > 100) return toast.error('Enter a valid rate between 0 and 100.');
    if (!(Number(totalZakat) >= 0)) return toast.error('Enter a valid Total Zakat amount.');
    if (deductionMode === 'AUTO' && !paymentAccountId && record.deductionMode !== 'AUTO') {
      return toast.error('Select the account for Auto mode.');
    }
    setSaving(true);
    try {
      // paymentAccountId is only sent when the admin actually picked one; if
      // Mode stays Auto and none was picked, the backend keeps the record's
      // existing account as-is.
      const payload = { date, rate, totalZakat, deductionMode, status, note, ...(paymentAccountId ? { paymentAccountId } : {}) };
      await client.put(`/zakat/${record.id}`, payload);
      toast.success('Zakat record updated.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not update this record.');
    } finally {
      setSaving(false);
    }
  };

  if (!record) return null;
  return (
    <Modal open={!!record} onClose={onClose} title="Edit Zakat Record" size="sm">
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Year (Hijri/Calendar): <span className="font-medium text-slate-800">{record.hijriYear} AH / {new Date(date || record.calculationDate).getFullYear()}</span>
          <br />
          Follows the Date below automatically.
        </div>
        <FormField label="Date" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Rate (%)" required>
          <Input type="number" min="0" max="100" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} />
        </FormField>
        <FormField label="Total Zakat" required>
          <Input type="number" min="0" step="0.01" value={totalZakat} onChange={(e) => setTotalZakat(e.target.value)} />
        </FormField>
        <p className="-mt-2 text-xs text-slate-400">
          This corrects the record only -- if this was Auto, the amount already deducted from the account is unaffected.
        </p>
        <FormField label="Mode">
          <Select value={deductionMode} onChange={(e) => setDeductionMode(e.target.value)}>
            <option value="MANUAL">Manual</option>
            <option value="AUTO">Auto (Select Account)</option>
          </Select>
        </FormField>
        {deductionMode === 'AUTO' && (
          <FormField label="Account">
            <AccountSelect
              value={paymentAccountId}
              onChange={setPaymentAccountId}
              placeholder={record.deductionMode === 'AUTO' ? `Current: ${record.paymentAccountName} (leave blank to keep)` : 'Select account...'}
            />
          </FormField>
        )}
        <FormField label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="RECORDED">Recorded (not yet paid)</option>
            <option value="PAID">Paid</option>
          </Select>
        </FormField>
        <FormField label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryTab() {
  const toast = useToast();
  const [records, setRecords] = useState(null);
  const [markingId, setMarkingId] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    client
      .get('/zakat')
      .then((res) => setRecords(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load Zakat history.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const markPaid = async (id) => {
    setMarkingId(id);
    try {
      await client.post(`/zakat/${id}/mark-paid`, {});
      toast.success('Marked as paid.');
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not update this record.');
    } finally {
      setMarkingId(null);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await client.delete(`/zakat/${deleteTarget.id}`);
      toast.success('Zakat record deleted.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete this record.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card title="Zakat History">
      <Table>
        <THead>
          <tr>
            <Th>Year (Hijri/Calendar)</Th>
            <Th>Date</Th>
            <Th>Rate</Th>
            <Th>Total Zakat</Th>
            <Th>Mode</Th>
            <Th>Status</Th>
            <Th>Note</Th>
            <Th>Actions</Th>
          </tr>
        </THead>
        <TBody>
          {records === null ? (
            <TableLoading colSpan={8} />
          ) : records.length === 0 ? (
            <TableEmpty colSpan={8} message="No Zakat calculations recorded yet." />
          ) : (
            records.map((r) => (
              <tr key={r.id}>
                <Td>
                  {r.hijriYear} AH / {new Date(r.calculationDate).getFullYear()}
                </Td>
                <Td>{formatDate(r.calculationDate)}</Td>
                <Td>{r.ratePct}%</Td>
                <Td className="font-semibold">{formatCurrency(r.zakatDue)}</Td>
                <Td>{r.deductionMode === 'AUTO' ? `Auto (${r.paymentAccountName})` : 'Manual'}</Td>
                <Td>
                  {r.status === 'PAID' ? (
                    <Badge color="green">Paid{r.paidAt ? ` · ${formatDate(r.paidAt)}` : ''}</Badge>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Badge color="amber">Recorded</Badge>
                      <Button size="sm" variant="secondary" loading={markingId === r.id} onClick={() => markPaid(r.id)}>
                        Mark Paid
                      </Button>
                    </div>
                  )}
                </Td>
                <Td>{r.note || '—'}</Td>
                <Td>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditRecord(r)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setDeleteTarget(r)}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>

      <ZakatEditModal record={editRecord} onClose={() => setEditRecord(null)} onSaved={load} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Confirm Delete"
        confirmLabel="Confirm Delete"
        loading={deleting}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        message={
          <>
            Are you sure you want to delete this Zakat record? This action cannot be undone.
            {deleteTarget?.deductionMode === 'AUTO' && (
              <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                This record relates to {deleteTarget && formatCurrency(deleteTarget.zakatDue)} already deducted from{' '}
                {deleteTarget?.paymentAccountName}. Deleting the record will NOT return that money to the account.
              </span>
            )}
          </>
        }
      />
    </Card>
  );
}

export default function ZakatPage() {
  const [tab, setTab] = useState('calculator');
  const [historyKey, setHistoryKey] = useState(0);

  const handleConfirmed = () => {
    setTab('history');
    setHistoryKey((k) => k + 1);
  };

  return (
    <div>
      <PageHeader title="Zakat" subtitle="Calculate Zakat on the business's net zakatable wealth and split it across partners." />

      <div className="mb-5 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 no-print sm:inline-flex">
        <button
          onClick={() => setTab('calculator')}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            tab === 'calculator' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <CalculatorIcon className="h-4 w-4" /> Calculator
        </button>
        <button
          onClick={() => {
            setTab('history');
            setHistoryKey((k) => k + 1);
          }}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            tab === 'history' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <HistoryIcon className="h-4 w-4" /> History
        </button>
      </div>

      {tab === 'calculator' ? <ZakatCalculator onConfirmed={handleConfirmed} /> : <HistoryTab key={historyKey} />}
    </div>
  );
}
