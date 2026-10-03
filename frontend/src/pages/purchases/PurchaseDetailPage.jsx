import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Printer, CreditCard, Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Modal from '../../components/ui/Modal.jsx';

const STATUS_COLOR = { Unpaid: 'slate', Partial: 'amber', Paid: 'green' };

function AddPaymentModal({ open, onClose, purchase, onPaid }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setAccountId('');
    setNote('');
    client.get('/accounts').then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive))).catch(() => setAccounts([]));
  }, [open]);

  const handleSave = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a valid amount.');
    if (amt > purchase.balanceDue) return toast.error(`Lacagtu waa ka badan tahay inta hadhay. (Exceeds balance due of ${formatCurrency(purchase.balanceDue)}.)`);
    if (!accountId) return toast.error('Select a payment account.');
    setSaving(true);
    try {
      await client.post(`/purchases/${purchase.id}/payments`, { amount: amt, paymentAccountId: accountId, note });
      toast.success('Payment recorded.');
      onPaid();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Payment" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Balance Due: <strong>{formatCurrency(purchase.balanceDue)}</strong></p>
        <FormField label="Amount to Pay" required>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Payment Account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Note / Reference">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>Save Payment</Button>
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
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reversing, setReversing] = useState(false);

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

  const handleReverse = async () => {
    setReversing(true);
    try {
      await client.post(`/purchases/${id}/payments/${reverseTarget.id}/reverse`, { reason: 'Reversed by staff' });
      toast.success('Payment reversed.');
      setReverseTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not reverse this payment.');
    } finally {
      setReversing(false);
    }
  };

  if (loading && !purchase) return <PageSpinner />;
  if (!purchase) return null;

  const canPay = purchase.status !== 'voided' && (purchase.paymentStatus === 'Unpaid' || purchase.paymentStatus === 'Partial');

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
            <p className="text-sm text-slate-500">{purchase.supplierName}{purchase.supplierInvoiceNumber ? ` · Supplier Invoice: ${purchase.supplierInvoiceNumber}` : ''}</p>
            <p className="mt-1 text-xs text-slate-400">{formatDateTime(purchase.createdAt)}</p>
          </div>
          <div className="flex gap-2">
            {purchase.status === 'voided' && <Badge color="red">Voided</Badge>}
            <Badge color={STATUS_COLOR[purchase.paymentStatus]}>{purchase.paymentStatus}</Badge>
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

      <Card dense title={`Payment History (${payments.length})`}>
        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {p.paymentNumber} · {formatCurrency(p.amount)}
                    {p.status === 'REVERSED' && <Badge color="red" className="ml-2">Reversed</Badge>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.paymentAccountName} · {formatDateTime(p.createdAt)}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                {canManage && p.status === 'POSTED' && (
                  <button
                    onClick={() => setReverseTarget(p)}
                    className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-700"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Reverse
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <AddPaymentModal open={payOpen} onClose={() => setPayOpen(false)} purchase={purchase} onPaid={load} />
      <ConfirmDialog
        open={!!reverseTarget}
        title="Reverse Payment"
        message={`Reverse payment ${reverseTarget?.paymentNumber} of ${formatCurrency(reverseTarget?.amount)}? The amount will be refunded back into ${reverseTarget?.paymentAccountName}, and the invoice balance will be recalculated.`}
        confirmLabel="Reverse Payment"
        variant="danger"
        loading={reversing}
        onConfirm={handleReverse}
        onClose={() => setReverseTarget(null)}
      />
    </div>
  );
}
