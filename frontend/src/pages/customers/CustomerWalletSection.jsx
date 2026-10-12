import { useEffect, useState } from 'react';
import { PiggyBank, Search, HandCoins } from 'lucide-react';
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

function ChoiceCard({ active, onClick, title, text }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
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

function AddDepositModal({ open, onClose, customerId, customerName, customerDebt = 0, walletAutoPay = false, onDeposited }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [applyToDebt, setApplyToDebt] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount('');
    setAccountId('');
    setNote('');
    setApplyToDebt(walletAutoPay);
    client.get('/accounts').then((r) => setAccounts(r.data.data.accounts.filter((a) => a.isActive))).catch(() => setAccounts([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a valid deposit amount.');
    if (!accountId) return toast.error('Select a payment account.');
    setSaving(true);
    try {
      const res = await client.post(`/customers/${customerId}/wallet/deposit`, { amount: amt, paymentAccountId: accountId, note, applyToDebt: customerDebt > 0 ? applyToDebt : false });
      const { debtCleared, walletCredited } = res.data.data;
      toast.success(
        debtCleared > 0
          ? `Deposit ${formatCurrency(amt)} — ${formatCurrency(debtCleared)} paid off the debt${walletCredited > 0 ? `, ${formatCurrency(walletCredited)} kept in the wallet` : ''}.`
          : `Deposit ${formatCurrency(amt)} kept in the wallet.`
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
        <FormField label="Amount" required>
          <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Payment Account" required>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </FormField>
        {customerDebt > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">This customer owes {formatCurrency(customerDebt)}. What should this money do?</p>
            <ChoiceCard
              active={!applyToDebt}
              onClick={() => setApplyToDebt(false)}
              title="Keep it in the wallet"
              text="The debt stays as it is. The customer can choose later to pay it from the wallet."
            />
            <ChoiceCard
              active={applyToDebt}
              onClick={() => setApplyToDebt(true)}
              title="Pay the debt with it"
              text="Pays the oldest invoices first; anything left over goes into the wallet."
            />
          </div>
        )}
        <FormField label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={handleSave}>
            Confirm Deposit
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// The customer agreed: pay (some of) the debt out of the wallet.
function PayFromWalletModal({ open, onClose, customerId, walletBalance, customerDebt, onPaid }) {
  const toast = useToast();
  const max = Math.min(walletBalance, customerDebt);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setAmount(String(Math.round(max * 100) / 100));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('Enter a valid amount.');
    if (amt > max + 0.0001) return toast.error(`At most ${formatCurrency(max)}.`);
    setSaving(true);
    try {
      const res = await client.post(`/customers/${customerId}/wallet/pay-debt`, { amount: amt });
      toast.success(`${formatCurrency(res.data.data.applied)} paid off the debt from the wallet.`);
      onPaid();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not pay the debt from the wallet.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Pay debt from wallet" size="sm">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">In wallet</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(walletBalance)}</p>
          </div>
          <div className="rounded-lg bg-brand-600 px-3 py-2 text-white">
            <p className="text-[10px] uppercase tracking-wide text-white/75">Debt</p>
            <p className="text-lg font-bold">{formatCurrency(customerDebt)}</p>
          </div>
        </div>
        <FormField label={`Amount to take from the wallet (up to ${formatCurrency(max)})`} required>
          <Input type="number" min="0.01" step="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </FormField>
        <p className="text-xs text-slate-500">Only do this when the customer agrees. It pays the oldest invoices first.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={pay}>
            <HandCoins className="h-4 w-4" /> Pay {amount ? formatCurrency(Number(amount) || 0) : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function CustomerWalletSection({ customerId, customerName, walletBalance, customerDebt = 0, walletAutoPay = false, onChanged }) {
  const toast = useToast();
  const [depositOpen, setDepositOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [togglingAuto, setTogglingAuto] = useState(false);

  const load = () => {
    setLoading(true);
    client
      .get(`/customers/${customerId}/wallet/history`, { params: { q: search || undefined } })
      .then((res) => setHistory(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load wallet history.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [customerId, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAuto = async () => {
    setTogglingAuto(true);
    try {
      await client.put(`/customers/${customerId}/wallet/auto-pay`, { enabled: !walletAutoPay });
      toast.success(!walletAutoPay ? 'Wallet money will now pay this customer\'s debt automatically.' : 'Wallet money now stays in the wallet until you choose to use it.');
      onChanged();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not change this setting.');
    } finally {
      setTogglingAuto(false);
    }
  };

  const canPayFromWallet = walletBalance > 0 && customerDebt > 0;

  return (
    <div className="space-y-4">
      <Card dense>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-400">Current Wallet Balance</p>
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(walletBalance)}</p>
            {customerDebt > 0 && <p className="text-xs font-medium text-rose-600">Debt: {formatCurrency(customerDebt)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canPayFromWallet && (
              <Button variant="secondary" onClick={() => setPayOpen(true)}>
                <HandCoins className="h-4 w-4" /> Pay debt from wallet
              </Button>
            )}
            <Button onClick={() => setDepositOpen(true)}>
              <PiggyBank className="h-4 w-4" /> Add Deposit
            </Button>
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
          <span>
            <span className="block text-sm font-semibold text-slate-800">Pay debt from wallet automatically</span>
            <span className="block text-xs text-slate-500">
              {walletAutoPay
                ? 'On: deposits and wallet money go to the debt by themselves.'
                : 'Off: wallet money stays in the wallet; use "Pay debt from wallet" when the customer agrees.'}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={walletAutoPay}
            disabled={togglingAuto}
            onClick={toggleAuto}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${walletAutoPay ? 'bg-brand-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${walletAutoPay ? 'left-5.5' : 'left-0.5'}`} />
          </button>
        </label>
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
                      {t.amount > 0 ? '+' : ''}
                      {formatCurrency(t.amount)}
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
        walletAutoPay={walletAutoPay}
        onDeposited={() => {
          load();
          onChanged();
        }}
      />
      <PayFromWalletModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        customerId={customerId}
        walletBalance={walletBalance}
        customerDebt={customerDebt}
        onPaid={() => {
          load();
          onChanged();
        }}
      />
    </div>
  );
}
