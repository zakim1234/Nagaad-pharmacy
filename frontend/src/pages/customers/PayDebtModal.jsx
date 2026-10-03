import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../../components/ui/Modal.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';

export default function PayDebtModal({ open, onClose, customerId, onPaid }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('amount'); // 'amount' (auto-allocate oldest first) | 'specific' (per-invoice)
  const [amount, setAmount] = useState('');
  const [allocations, setAllocations] = useState({}); // saleId -> amount string
  const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [paymentAccountId, setPaymentAccountId] = useState(null);
  const [requestKey, setRequestKey] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMode('amount');
    setAmount('');
    setAllocations({});
    setNotes('');
    setPaymentAccountId(null);
    setRequestKey(crypto.randomUUID());
    client
      .get(`/customers/${customerId}/debt`)
      .then((res) => {
        setInvoices(res.data.data.invoices);
        setTotalOutstanding(res.data.data.totalOutstanding);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load outstanding debt.'))
      .finally(() => setLoading(false));
  }, [open, customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const specificTotal = useMemo(
    () => Object.values(allocations).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [allocations]
  );

  const setAllocation = (saleId, value, max) => {
    const num = Math.max(0, Math.min(Number(value) || 0, max));
    setAllocations((a) => ({ ...a, [saleId]: value === '' ? '' : String(num) }));
  };

  const payAll = () => setAmount(String(totalOutstanding));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (paying) return;
    if (!paymentAccountId) return toast.error('Please select an account for this payment.');
    setPaying(true);
    try {
      let payload;
      if (mode === 'specific') {
        const allocList = invoices
          .filter((inv) => Number(allocations[inv.id]) > 0)
          .map((inv) => ({ saleId: inv.id, amount: Number(allocations[inv.id]) }));
        if (allocList.length === 0) {
          toast.error('Enter an amount for at least one invoice.');
          setPaying(false);
          return;
        }
        payload = { amount: specificTotal, allocations: allocList, notes };
      } else {
        if (!amount || Number(amount) <= 0) {
          toast.error('Enter a valid payment amount.');
          setPaying(false);
          return;
        }
        payload = { amount: Number(amount), notes };
      }

      const res = await client.post(`/customers/${customerId}/payments`, { ...payload, paymentAccountId, requestKey });
      toast.success(`Payment recorded (${res.data.data.receiptNumber}).`);
      onPaid();
      onClose();
      navigate(`/payment-receipt/${res.data.data.paymentId}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not record payment.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Pay Debt" size="lg">
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Loading outstanding invoices...</p>
      ) : invoices.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">This customer has no outstanding debt.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg bg-rose-50 px-4 py-3">
            <p className="text-xs uppercase text-rose-500">Total Outstanding Debt</p>
            <p className="text-xl font-bold text-rose-700">{formatCurrency(totalOutstanding)}</p>
          </div>

          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode('amount')}
              className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${mode === 'amount' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
            >
              Pay an Amount
            </button>
            <button
              type="button"
              onClick={() => setMode('specific')}
              className={`flex-1 rounded-md px-3 py-1.5 font-semibold ${mode === 'specific' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}
            >
              Pay Specific Invoices
            </button>
          </div>

          {mode === 'amount' ? (
            <div>
              <FormField label="Payment Amount" required>
                <div className="flex gap-2">
                  <Input type="number" min="0.01" step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  <Button type="button" variant="secondary" onClick={payAll}>
                    Pay All
                  </Button>
                </div>
              </FormField>
              <p className="mt-1 text-xs text-slate-400">
                Applied automatically to the oldest outstanding invoices first.
              </p>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Outstanding Invoices</p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{inv.receiptNumber}</p>
                      <p className="text-xs text-slate-400">
                        {formatDate(inv.createdAt)} · Total {formatCurrency(inv.total)} · Owed {formatCurrency(inv.outstanding)}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={inv.outstanding}
                      step="0.01"
                      value={allocations[inv.id] ?? ''}
                      onChange={(e) => setAllocation(inv.id, e.target.value, inv.outstanding)}
                      className="w-24 text-right"
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-sm font-semibold text-slate-700">
                <span>Total to Pay</span>
                <span>{formatCurrency(specificTotal)}</span>
              </div>
            </div>
          )}

          <FormField label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Receive Into Account" required>
            <AccountSelect value={paymentAccountId} onChange={setPaymentAccountId} disabled={paying} placeholder="Select account..." />
          </FormField>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={paying}>
              Cancel
            </Button>
            <Button type="submit" loading={paying} disabled={!paymentAccountId || paying}>
              Record Payment
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
