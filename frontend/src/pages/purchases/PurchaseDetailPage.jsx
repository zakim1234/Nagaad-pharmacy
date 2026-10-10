import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, CreditCard, Pencil, Trash2, Layers } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';


function dayString(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function useActiveAccounts(open) {
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    if (!open) return;
    client.get('/accounts').then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive))).catch(() => setAccounts([]));
  }, [open]);
  return accounts;
}

// Add a new payment, or (with `payment`) edit an existing one. When editing,
// the most that can be paid is what is still owed plus this payment's own
// current amount.
function PaymentModal({ open, onClose, purchase, payment, onSaved }) {
  const toast = useToast();
  const editing = !!payment;
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState(dayString());
  const [note, setNote] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [saving, setSaving] = useState(false);
  const accounts = useActiveAccounts(open);

  useEffect(() => {
    if (!open) return;
    setAmount(editing ? String(payment.amount) : '');
    setAccountId(editing ? String(payment.paymentAccount) : '');
    setPaymentDate(dayString(editing ? payment.paymentDate : new Date()));
    setNote(editing ? payment.note || '' : '');
    setReceiptNo(editing ? payment.receiptNo || '' : '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxAmount = editing ? purchase.balanceDue + payment.amount : purchase.balanceDue;
  const amt = Number(amount);
  const newBalance = Math.round((maxAmount - (Number.isFinite(amt) ? amt : 0)) * 100) / 100;

  const handleSave = async () => {
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a valid amount.');
    if (amt > maxAmount) return toast.error(`Lacagtu waa ka badan tahay inta hadhay. (Cannot exceed ${formatCurrency(maxAmount)}.)`);
    if (!accountId) return toast.error('Select a payment account.');
    setSaving(true);
    try {
      const body = { amount: amt, paymentAccountId: accountId, paymentDate, note, receiptNo };
      if (editing) await client.put(`/purchases/${purchase.id}/payments/${payment.id}`, body);
      else await client.post(`/purchases/${purchase.id}/payments`, body);
      toast.success(editing ? 'Payment updated.' : 'Payment recorded.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the payment.');
    } finally {
      setSaving(false);
    }
  };

  // An inactive account can stay on a payment being edited, but is never offered for new ones.
  const options = editing && !accounts.some((a) => String(a.id) === String(payment.paymentAccount))
    ? [{ id: payment.paymentAccount, name: payment.paymentAccountName }, ...accounts]
    : accounts;

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit Payment ${payment.paymentNumber}` : 'Add Payment'} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          {editing ? 'Can be up to' : 'Balance Due'}: <strong>{formatCurrency(maxAmount)}</strong>
        </p>
        <FormField label="Amount" required>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Payment Account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select account</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Date">
          <Input type="date" value={paymentDate} max={dayString()} onChange={(e) => setPaymentDate(e.target.value)} />
        </FormField>
        <FormField label="Receipt No. (their receipt serial)">
          <Input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} maxLength={60} placeholder="e.g. 0457" />
        </FormField>
        <FormField label="Note / Reference">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={500} />
        </FormField>
        {Number.isFinite(amt) && amt > 0 && amt <= maxAmount && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Balance Due after saving: <strong className={newBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(newBalance)}</strong>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editing ? 'Save Changes' : 'Save Payment'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [purchase, setPurchase] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([client.get(`/purchases/${id}`), client.get(`/purchases/${id}/payments`)])
      .then(([p, pay]) => {
        setPurchase(p.data.data);
        setPayments(pay.data.data);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load purchase.'))
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  // Delete = the payment is reversed: refunded to its account and the
  // balance goes back up. The record stays, marked Deleted, for the audit trail.
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.post(`/purchases/${id}/payments/${deleteTarget.id}/reverse`, { reason: 'Deleted by staff' });
      toast.success('Payment deleted and refunded to its account.');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete this payment.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !purchase) return <PageSpinner />;
  if (!purchase) return null;

  const voided = purchase.status === 'voided';
  const canPay = !voided && (purchase.paymentStatus === 'Unpaid' || purchase.paymentStatus === 'Partial');
  const active = payments.filter((p) => p.status === 'POSTED');
  const deleted = payments.filter((p) => p.status !== 'POSTED');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/purchases" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Invoices
        </Link>
        <Link to={`/purchases/${id}/receipt`}>
          <Button variant="secondary"><Printer className="h-4 w-4" /> Print</Button>
        </Link>
      </div>

      <Card dense>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{purchase.purchaseNumber}</h1>
            <p className="text-sm text-slate-500"><Link to={`/purchases?supplier=${purchase.supplier}`} className="font-medium text-slate-700 hover:text-brand-600 hover:underline" title="All invoices from this supplier">{purchase.supplierName}</Link>{purchase.supplierInvoiceNumber ? ` · Supplier Invoice: ${purchase.supplierInvoiceNumber}` : ''}</p>
            <p className="mt-1 text-xs text-slate-400">{formatDateTime(purchase.createdAt)}</p>
          </div>
          <div className="flex gap-2">
            {voided && <Badge color="red">Voided</Badge>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-xs uppercase text-slate-400">Total Amount</p>
            <p className="text-lg font-bold text-slate-800">{formatCurrency(purchase.totalAmount)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Amount Paid</p>
            <p className="text-lg font-bold text-slate-800">{formatCurrency(purchase.paidAmount)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-400">Balance Due</p>
            <p className={`text-lg font-bold ${purchase.balanceDue > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(purchase.balanceDue)}</p>
          </div>
        </div>
        {canPay && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setPayOpen(true)}><CreditCard className="h-4 w-4" /> Add Payment</Button>
          </div>
        )}
      </Card>

      <Card dense title={`Payment History — ${purchase.purchaseNumber} (${active.length})`}>
        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {active.length === 0 && <p className="py-3 text-center text-sm text-slate-400">No active payments.</p>}
            {active.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                actions={
                  canManage &&
                  !voided && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setEditTarget(p)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        className="flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )
                }
              />
            ))}
            {deleted.length > 0 && (
              <div className="pt-2">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Deleted payments ({deleted.length})</p>
                {deleted.map((p) => (
                  <PaymentRow key={p.id} payment={p} faded />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} purchase={purchase} onSaved={load} />
      <PaymentModal open={!!editTarget} onClose={() => setEditTarget(null)} purchase={purchase} payment={editTarget} onSaved={load} />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Payment"
        message={`Ma hubtaa inaad tirtirto lacagtan ${formatCurrency(deleteTarget?.amount)}? Falkan wuxuu kordhin doonaa Balance Due-ga. (The ${formatCurrency(deleteTarget?.amount)} goes back into ${deleteTarget?.paymentAccountName} and the invoice's Balance Due increases.)`}
        confirmLabel="Confirm Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function PaymentRow({ payment: p, actions, faded = false }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3 ${faded ? 'bg-slate-50/60 opacity-70' : ''}`}>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${faded ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
          {formatCurrency(p.amount)} – {p.paymentAccountName} – {formatDate(p.paymentDate)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <span>{p.paymentNumber}</span>
          {p.receiptNo && <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">Receipt No. {p.receiptNo}</span>}
          {p.bulkPayment && (
            <Link to={`/purchases/bulk-payments/${p.bulkPayment}`} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
              <Layers className="h-3 w-3" /> Bulk payment receipt
            </Link>
          )}
          {p.editedAt && !faded && <Badge color="blue">Edited</Badge>}
          {faded && <Badge color="red">Deleted</Badge>}
          {p.note && <span className="text-slate-500">{p.note}</span>}
        </p>
      </div>
      {actions}
    </div>
  );
}
