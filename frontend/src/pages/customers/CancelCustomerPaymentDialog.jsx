import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Textarea } from '../../components/ui/Field.jsx';

function Choice({ active, onClick, title, text, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-brand-600' : 'border-slate-300'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-brand-600" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

// Undo a customer's debt payment: the amount is owed again on the same
// invoices, and the money is kept as wallet credit or handed back out of
// the account it came into.
export default function CancelCustomerPaymentDialog({ customerId, payment, onClose, onCancelled }) {
  const toast = useToast();
  const fromWallet = payment && (!payment.paymentAccountName || payment.paymentAccountName === 'Customer Wallet');
  const [refundTo, setRefundTo] = useState('WALLET');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (payment) {
      setRefundTo('WALLET');
      setReason('');
    }
  }, [payment]);

  if (!payment) return null;

  const confirm = async () => {
    setSaving(true);
    try {
      await client.post(`/customers/${customerId}/payments/${payment.id}/cancel`, { refundTo, reason });
      toast.success(
        `${payment.receiptNumber} cancelled — ${formatCurrency(payment.amount)} ${refundTo === 'WALLET' ? 'kept in the customer\'s wallet' : `given back from ${payment.paymentAccountName}`}.`
      );
      onCancelled();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!payment} onClose={saving ? undefined : onClose} title={`Cancel payment ${payment.receiptNumber}`} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-neutral-950 px-4 py-3 text-white">
          <p className="text-xs uppercase tracking-wide text-neutral-400">The customer will owe this again</p>
          <p className="text-2xl font-bold">{formatCurrency(payment.amount)}</p>
          {payment.allocations?.length > 0 && <p className="text-xs text-neutral-400">on {payment.allocations.map((a) => a.receiptNumber).join(', ')}</p>}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Where does the money go?</p>
          <Choice
            active={refundTo === 'WALLET'}
            onClick={() => setRefundTo('WALLET')}
            title="Keep it in the customer's wallet"
            text="We keep the money; it shows as wallet credit the customer can use later."
          />
          <Choice
            active={refundTo === 'ACCOUNT'}
            disabled={fromWallet}
            onClick={() => setRefundTo('ACCOUNT')}
            title={fromWallet ? 'Give it back (not possible)' : `Give it back from ${payment.paymentAccountName}`}
            text={fromWallet ? 'This payment was taken from the wallet, so it goes back to the wallet.' : 'The money leaves that account — you hand it back to the customer.'}
          />
        </div>
        <FormField label="Reason (optional)">
          <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered by mistake" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" loading={saving} onClick={confirm}>
            <Undo2 className="h-4 w-4" /> Cancel payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
