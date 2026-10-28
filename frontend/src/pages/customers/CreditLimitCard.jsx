import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';

// The most this customer may owe. Everyone sees it (and what is left); only
// an admin sets or removes it. Sales that would go over it are refused.
export default function CreditLimitCard({ customer, isAdmin, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const limit = customer.creditLimit;
  const left = limit == null ? null : Math.max(0, Math.round((limit - Math.max(0, customer.balance)) * 100) / 100);

  const save = async (next) => {
    setSaving(true);
    try {
      await client.put(`/customers/${customer.id}/credit-limit`, { limit: next });
      toast.success(next === null ? `${customer.name} has no credit limit now.` : `${customer.name} can now owe up to ${formatCurrency(Number(next))}.`);
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the credit limit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 px-5 py-3">
      <ShieldCheck className="h-4 w-4 text-brand-600" />
      <p className="text-sm text-neutral-700">
        <span className="font-semibold text-neutral-900">Credit limit:</span>{' '}
        {limit == null ? (
          <span className="text-neutral-500">No limit</span>
        ) : (
          <>
            <span className="font-bold text-neutral-950">{formatCurrency(limit)}</span>
            <span className="text-neutral-500"> · {formatCurrency(left)} left on credit (pending invoices count too)</span>
          </>
        )}
      </p>
      {isAdmin && (
        <button
          type="button"
          onClick={() => {
            setValue(limit == null ? '' : String(limit));
            setOpen(true);
          }}
          className="ml-auto rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          {limit == null ? 'Set limit' : 'Change limit'}
        </button>
      )}

      <Modal open={open} onClose={saving ? undefined : () => setOpen(false)} title={`Credit limit – ${customer.name}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            The most {customer.name} may owe. A sale that would take their debt over it is refused; paying is always fine. They owe {formatCurrency(customer.balance)} now.
          </p>
          <FormField label="Limit">
            <Input type="number" min="0" step="0.01" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 300" />
          </FormField>
          <div className="flex flex-wrap justify-between gap-2">
            {limit != null ? (
              <Button variant="ghost" onClick={() => save(null)} disabled={saving}>
                Remove limit
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                Close
              </Button>
              <Button loading={saving} disabled={value === '' || Number(value) < 0} onClick={() => save(Number(value))}>
                Save limit
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
