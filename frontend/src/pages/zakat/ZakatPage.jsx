import { useCallback, useEffect, useState } from 'react';
import { Calculator as CalculatorIcon, History as HistoryIcon, CheckCircle2, Pencil, Trash2 } from 'lucide-react';
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

function SummaryRow({ label, value, tone = '', bold = false, indent = false, negative = false }) {
  return (
    <div className={`flex items-center justify-between border-b border-slate-100 py-2 text-sm ${bold ? 'font-bold' : ''}`}>
      <span className={indent ? 'pl-5 text-slate-500' : 'text-slate-700'}>{label}</span>
      <span className={`tabular-nums ${tone || 'text-slate-900'}`}>
        {negative ? `− ${value}` : value}
      </span>
    </div>
  );
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Zakat Calculation Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </FormField>
          <FormField label="Zakat Rate (%)">
            <Input type="number" min="0" max="100" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} />
          </FormField>
          <div className="flex items-end pb-2.5">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={includeFixedAssets} onChange={(e) => setIncludeFixedAssets(e.target.checked)} />
              Include Fixed Assets in Zakat calculation
            </label>
          </div>
        </div>
      </Card>

      {loading && !preview ? (
        <PageSpinner />
      ) : preview ? (
        <>
          <Card title="Zakatable Assets">
            <div className="max-w-lg">
              <SummaryRow label="Cash & Bank Balances (Accounts)" value={formatCurrency(preview.assets.cash)} />
              <SummaryRow label="Inventory Value (Stock)" value={formatCurrency(preview.assets.inventory)} />
              <SummaryRow label="Accounts Receivable (Customer Debt)" value={formatCurrency(preview.assets.receivable)} />
              {includeFixedAssets && <SummaryRow label="Fixed Assets" value={formatCurrency(preview.assets.fixedAssets)} />}
              <SummaryRow label="Total Zakatable Assets" value={formatCurrency(preview.assets.total)} bold />
              <div className="pt-2" />
              <SummaryRow label="Accounts Payable (Supplier Debt)" value={formatCurrency(preview.liabilities.payable)} negative tone="text-rose-600" />
              <SummaryRow label="Net Zakatable Wealth" value={formatCurrency(preview.netZakatableWealth)} bold />
              <div className="pt-2" />
              <SummaryRow label={`Zakat Due (${preview.ratePct}%)`} value={formatCurrency(preview.zakatDue)} bold tone="text-emerald-700" />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Approximate Hijri year for this date: {preview.hijriYear} AH. Fixed Assets aren't included by default -- most fatwas treat trade goods
              only.
            </p>
          </Card>

          {preview.breakdown.length > 0 && (
            <Card title="Zakat Breakdown by Partner">
              <Table>
                <THead>
                  <tr>
                    <Th>Partner</Th>
                    <Th>Equity %</Th>
                    <Th>Zakat Share</Th>
                  </tr>
                </THead>
                <TBody>
                  {preview.breakdown.map((b) => (
                    <tr key={b.partnerId}>
                      <Td className="font-medium text-slate-900">{b.partnerName}</Td>
                      <Td>{b.equityPct}%</Td>
                      <Td>{formatCurrency(b.share)}</Td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <Td>Total Zakat Due</Td>
                    <Td />
                    <Td>{formatCurrency(preview.zakatDue)}</Td>
                  </tr>
                </TBody>
              </Table>
            </Card>
          )}

          <Card title="Confirm Zakat">
            <div className="max-w-xl space-y-4">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">How will Zakat be paid?</legend>
                <div className="mt-2 space-y-2 text-sm text-slate-700">
                  <label className="flex items-start gap-2">
                    <input type="radio" name="mode" className="mt-0.5" checked={deductionMode === 'AUTO'} onChange={() => setDeductionMode('AUTO')} />
                    <span>
                      <strong>Deduct automatically</strong> from an account, as an Expense (category "Zakat").
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="mode" className="mt-0.5" checked={deductionMode === 'MANUAL'} onChange={() => setDeductionMode('MANUAL')} />
                    <span>
                      <strong>Just record it</strong> -- each partner pays their own share separately; no money moves in the system.
                    </span>
                  </label>
                </div>
              </fieldset>
              {deductionMode === 'AUTO' && (
                <FormField label="Payment Account" required>
                  <AccountSelect value={paymentAccountId} onChange={setPaymentAccountId} placeholder="Select account..." />
                </FormField>
              )}
              <FormField label="Note">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </FormField>
              <Button size="lg" loading={confirming} disabled={!(preview.zakatDue > 0)} onClick={confirm}>
                <CheckCircle2 className="h-4 w-4" /> Confirm {formatCurrency(preview.zakatDue)} Zakat
              </Button>
              {!(preview.zakatDue > 0) && <p className="text-xs text-slate-400">Zakat due is zero -- nothing to confirm for this date/rate.</p>}
            </div>
          </Card>
        </>
      ) : null}
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
            tab === 'calculator' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
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
            tab === 'history' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <HistoryIcon className="h-4 w-4" /> History
        </button>
      </div>

      {tab === 'calculator' ? <ZakatCalculator onConfirmed={handleConfirmed} /> : <HistoryTab key={historyKey} />}
    </div>
  );
}
