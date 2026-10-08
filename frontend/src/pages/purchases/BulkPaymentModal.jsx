import { useEffect, useMemo, useState } from 'react';
import { Ban } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';

const PRESETS = [5, 10, 20, 30];
const STATUS_COLOR = { Unpaid: 'slate', Partial: 'amber', Paid: 'green' };

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Pay one supplier across several of their unpaid invoices at once. The
// amount is usually a % of what the ticked invoices owe; the server applies
// it oldest invoice first, as one transaction with one receipt.
export default function BulkPaymentModal({ open, onClose, onPaid, initialSupplierId = '' }) {
  const toast = useToast();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [voided, setVoided] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [percentage, setPercentage] = useState(null);
  const [customPct, setCustomPct] = useState('');
  const [amount, setAmount] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayString());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId(initialSupplierId || '');
    setInvoices([]);
    setVoided([]);
    setSelected(new Set());
    setPercentage(null);
    setCustomPct('');
    setAmount('');
    setAccountId('');
    setPaymentDate(todayString());
    setNote('');
    client.get('/purchases/bulk-payments/suppliers').then((r) => setSuppliers(r.data.data)).catch(() => setSuppliers([]));
    client.get('/accounts').then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive))).catch(() => setAccounts([]));
  }, [open]);

  useEffect(() => {
    if (!supplierId || !open) return;
    client
      .get('/purchases/bulk-payments/outstanding', { params: { supplierId } })
      .then((r) => {
        setInvoices(r.data.data.invoices);
        setVoided(r.data.data.voided);
        setSelected(new Set(r.data.data.invoices.map((i) => i.id)));
        setPercentage(null);
        setCustomPct('');
        setAmount('');
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load this supplier’s invoices.'));
  }, [supplierId, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalOwed = useMemo(() => round2(invoices.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.balanceDue, 0)), [invoices, selected]);

  // Keep the amount in step with the chosen % when the ticked invoices change.
  useEffect(() => {
    if (percentage != null) setAmount(String(round2((percentage / 100) * totalOwed)));
  }, [totalOwed]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickPct = (pct) => {
    setPercentage(pct);
    setAmount(String(round2((pct / 100) * totalOwed)));
  };

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Preview: oldest first, exactly as the server will apply it.
  const amountNum = Number(amount) || 0;
  const preview = [];
  let left = amountNum;
  for (const inv of invoices) {
    if (!selected.has(inv.id)) continue;
    const take = round2(Math.min(Math.max(left, 0), inv.balanceDue));
    left = round2(left - take);
    const after = round2(inv.balanceDue - take);
    preview.push({ ...inv, take, after, status: take <= 0 ? inv.paymentStatus : after <= 0 ? 'Paid' : 'Partial' });
  }

  let problem = '';
  if (supplierId && selected.size === 0) problem = 'Tick at least one invoice.';
  else if (amountNum > totalOwed) problem = `Amount is more than the selected invoices owe (${formatCurrency(totalOwed)}).`;
  const canSave = supplierId && selected.size > 0 && amountNum > 0 && !problem && accountId && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const res = await client.post('/purchases/bulk-payments', {
        supplierId,
        purchaseIds: [...selected],
        amount: amountNum,
        percentage,
        paymentAccountId: accountId,
        paymentDate,
        note,
      });
      toast.success(`${res.data.data.bulkNumber} saved — ${formatCurrency(res.data.data.amount)} paid to ${res.data.data.supplierName}.`);
      onPaid(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the bulk payment.');
    } finally {
      setSaving(false);
    }
  };

  const supplierName = suppliers.find((s) => String(s.id) === String(supplierId))?.name;

  return (
    <Modal
      open={open}
      onClose={() => (saving ? null : onClose())}
      title={supplierName ? `Bulk Payment — ${supplierName}` : 'Bulk Payment'}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave} loading={saving}>
            Confirm Bulk Payment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <FormField label="Supplier" required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{suppliers.length ? 'Select a supplier' : 'No supplier is owed money'}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — owed {formatCurrency(s.owed)} ({s.invoiceCount} invoice{s.invoiceCount > 1 ? 's' : ''})
              </option>
            ))}
          </Select>
        </FormField>

        {supplierId && (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Outstanding invoices — paid oldest first</span>
                <button
                  type="button"
                  className="normal-case tracking-normal text-brand-600 hover:underline"
                  onClick={() => setSelected(selected.size === invoices.length ? new Set() : new Set(invoices.map((i) => i.id)))}
                >
                  {selected.size === invoices.length ? 'Untick all' : 'Tick all'}
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {preview.length === 0 && invoices.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">This supplier has no unpaid invoices.</li>}
                {invoices.map((inv) => {
                  const p = preview.find((x) => x.id === inv.id);
                  return (
                    <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} aria-label={`Include ${inv.purchaseNumber}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800">{inv.purchaseNumber}</p>
                        <p className="text-xs text-slate-400">
                          {formatDate(inv.purchaseDate || inv.createdAt)}
                          {inv.supplierInvoiceNumber ? ` · ${inv.supplierInvoiceNumber}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular-nums text-slate-700">Owed {formatCurrency(inv.balanceDue)}</p>
                        {p && p.take > 0 && (
                          <p className="text-xs tabular-nums text-emerald-600">
                            pays {formatCurrency(p.take)} → <Badge color={STATUS_COLOR[p.status]}>{p.status}</Badge>
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
                {voided.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 bg-slate-50/60 px-3 py-2 text-sm text-slate-400">
                    <Ban className="h-4 w-4" />
                    <span className="flex-1 line-through">{v.purchaseNumber}</span>
                    <span className="text-xs">Voided — cannot be included</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800">
                <span>Total owed (selected)</span>
                <span className="tabular-nums">{formatCurrency(totalOwed)}</span>
              </div>
            </div>

            <FormField label="Pay by percentage">
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setCustomPct('');
                      pickPct(pct);
                    }}
                    className={`rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition ${
                      percentage === pct && customPct === '' ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-brand-50'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-500">Custom</span>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    className="w-24!"
                    placeholder="%"
                    value={customPct}
                    onChange={(e) => {
                      setCustomPct(e.target.value);
                      const n = Number(e.target.value);
                      if (e.target.value !== '' && n > 0 && n <= 100) pickPct(n);
                    }}
                  />
                </div>
              </div>
            </FormField>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Amount to pay" required>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setPercentage(null);
                    setCustomPct('');
                  }}
                />
              </FormField>
              <FormField label="Payment account" required>
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Select account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Date">
                <Input type="date" value={paymentDate} max={todayString()} onChange={(e) => setPaymentDate(e.target.value)} />
              </FormField>
              <FormField label="Note (optional)">
                <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </FormField>
            </div>

            {amountNum > 0 && !problem && (
              <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
                {percentage != null ? `${percentage}% × ${formatCurrency(totalOwed)} = ` : ''}
                <strong>{formatCurrency(amountNum)}</strong> leaves the account as one payment, covering{' '}
                {preview.filter((p) => p.take > 0).length} invoice(s).
              </div>
            )}
            {problem && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{problem}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
