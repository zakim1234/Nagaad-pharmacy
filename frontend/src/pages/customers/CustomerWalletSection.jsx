import { useEffect, useState } from 'react';
import { PiggyBank, Search } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';

const TYPE_LABEL = {
  DEPOSIT: { label: 'Deposit', color: 'green' },
  SALE_PAYMENT: { label: 'Used', color: 'amber' },
  REFUND: { label: 'Restored', color: 'blue' },
  ADJUSTMENT: { label: 'Adjustment', color: 'slate' },
};

function AddDepositModal({ open, onClose, customerId, customerName, customerDebt = 0, onDeposited }) {
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
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a valid deposit amount.');
    if (!accountId) return toast.error('Select a payment account.');
    setSaving(true);
    try {
      const res = await client.post(`/customers/${customerId}/wallet/deposit`, { amount: amt, paymentAccountId: accountId, note });
      const { debtCleared, walletCredited } = res.data.data;
      toast.success(
        debtCleared > 0
          ? `Deposit ${formatCurrency(amt)} — ${formatCurrency(debtCleared)} applied to debt, ${formatCurrency(walletCredited)} added to wallet.`
          : `Deposit ${formatCurrency(amt)} added to wallet.`
      );
      onDeposited();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not record deposit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Add Deposit – ${customerName}`} size="sm">
      <div className="space-y-4">
        {customerDebt > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            This customer owes {formatCurrency(customerDebt)}. This deposit will pay that off first (oldest invoice first); only the
            leftover, if any, is added to their wallet.
          </p>
        )}
        <FormField label="Amount" required>
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
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>Confirm Deposit</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CustomerWalletSection({ customerId, customerName, walletBalance, customerDebt = 0, onChanged }) {
  const toast = useToast();
  const [depositOpen, setDepositOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    client
      .get(`/customers/${customerId}/wallet/history`, { params: { q: search || undefined } })
      .then((res) => setHistory(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load wallet history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [customerId, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <Card dense>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-400">Current Wallet Balance</p>
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(walletBalance)}</p>
          </div>
          <Button onClick={() => setDepositOpen(true)}>
            <PiggyBank className="h-4 w-4" /> Add Deposit
          </Button>
        </div>
      </Card>

      <Card dense title="Wallet History">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by reference, type, or note..." />
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading...</p>
        ) : !history || history.transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No wallet activity yet.</p>
        ) : (
          <div className="space-y-2">
            {history.transactions.map((t) => {
              const meta = TYPE_LABEL[t.type] || { label: t.type, color: 'slate' };
              return (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold tabular-nums ${t.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {t.amount > 0 ? '+' : ''}{formatCurrency(t.amount)}
                    </span>
                    <Badge color={meta.color}>{meta.label}</Badge>
                    {t.saleReceiptNumber && <span className="text-xs text-slate-500">{t.saleReceiptNumber}</span>}
                    {t.accountName && <span className="text-xs text-slate-500">{t.accountName}</span>}
                    {t.note && <span className="text-xs text-slate-400">{t.note}</span>}
                  </div>
                  <span className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <AddDepositModal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        customerId={customerId}
        customerName={customerName}
        customerDebt={customerDebt}
        onDeposited={() => { load(); onChanged(); }}
      />
    </div>
  );
}
