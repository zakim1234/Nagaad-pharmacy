import { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';

function Choice({ active, onClick, title, text }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-500' : 'border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-brand-400' : 'border-neutral-300'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-brand-400" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-neutral-900">{title}</span>
        <span className="block text-xs text-neutral-500">{text}</span>
      </span>
    </button>
  );
}

// Cancel a confirmed invoice. Stock comes back and what is still owed on it
// is removed; the money already paid on it (at the sale and later) goes to the
// customer's wallet, or is handed back out of a chosen account -- with the
// number it was sent to. Either way it shows on the Refunds report.
export default function CancelInvoiceDialog({ sale, onClose, onCancelled }) {
  const toast = useToast();
  const [refundTo, setRefundTo] = useState('WALLET');
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sale) return;
    setRefundTo('WALLET');
    setReference('');
    setReason('');
    setAccountId(sale.paymentAccount ? String(sale.paymentAccount) : '');
    client
      .get('/accounts')
      .then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive)))
      .catch(() => setAccounts([]));
  }, [sale]);

  if (!sale) return null;

  const paidLater = Math.max(0, (sale.balanceAdded || 0) - (sale.outstanding || 0));
  const paidBack = (sale.paidAmount || 0) + paidLater;
  const fromWallet = sale.walletAmount || 0;

  const confirm = async () => {
    if (paidBack > 0 && refundTo === 'ACCOUNT' && !accountId) {
      toast.error('Choose the account the money is given back from.');
      return;
    }
    setSaving(true);
    try {
      await client.post(`/sales/${sale.id}/reverse`, {
        reason: reason.trim() || 'Cancelled by customer',
        refundTo,
        accountId: refundTo === 'ACCOUNT' ? accountId : undefined,
        reference: refundTo === 'ACCOUNT' ? reference : '',
      });
      const account = accounts.find((a) => String(a.id) === String(accountId));
      toast.success(
        paidBack > 0
          ? `${sale.receiptNumber} cancelled — ${formatCurrency(paidBack)} ${refundTo === 'WALLET' ? "put in the customer's wallet" : `given back from ${account?.name || 'the account'}${reference ? ` to ${reference}` : ''}`}.`
          : `${sale.receiptNumber} cancelled.`
      );
      onCancelled();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel this invoice.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={!!sale} onClose={saving ? undefined : onClose} title={`Cancel invoice ${sale.receiptNumber}`} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl surface-blue px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-neutral-400">{paidBack > 0 ? 'Money paid on this invoice' : 'Invoice total'}</p>
          <p className="text-2xl font-bold">{formatCurrency(paidBack > 0 ? paidBack : sale.total)}</p>
          <p className="text-xs text-neutral-400">
            {paidBack > 0
              ? [sale.paidAmount > 0 && `${formatCurrency(sale.paidAmount)} at the sale`, paidLater > 0 && `${formatCurrency(paidLater)} paid later`].filter(Boolean).join(' · ')
              : 'Nothing was paid on it — what is owed is removed.'}
          </p>
        </div>

        {paidBack > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-neutral-700">Where does the money go?</p>
            <Choice
              active={refundTo === 'WALLET'}
              onClick={() => setRefundTo('WALLET')}
              title="Put it in the customer's wallet"
              text="We keep the money; it shows as wallet credit the customer can use later."
            />
            <Choice
              active={refundTo === 'ACCOUNT'}
              onClick={() => setRefundTo('ACCOUNT')}
              title="Give it back to the customer"
              text="The money leaves the account you choose — you send or hand it back."
            />
          </div>
        )}

        {paidBack > 0 && refundTo === 'ACCOUNT' && (
          <>
            <FormField label="Account the money is given back from">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatCurrency(a.currentBalance)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Number the money was sent to">
              <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 615123456" />
            </FormField>
          </>
        )}

        {fromWallet > 0 && <p className="text-xs text-neutral-500">{formatCurrency(fromWallet)} paid from the wallet goes back to the wallet.</p>}

        <FormField label="Reason (optional)">
          <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer returned everything" />
        </FormField>
        <p className="text-xs text-neutral-500">Stock is restored and the invoice is marked Cancelled (never deleted).</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" loading={saving} onClick={confirm}>
            <XCircle className="h-4 w-4" /> Cancel invoice
          </Button>
        </div>
      </div>
    </Modal>
  );
}
