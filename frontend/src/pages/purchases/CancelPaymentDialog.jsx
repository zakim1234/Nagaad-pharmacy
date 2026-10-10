import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Textarea } from '../../components/ui/Field.jsx';
import { formatCurrency } from '../../utils/format.js';

// Confirms cancelling supplier payment(s): the money goes back to the
// account it came from and the supplier is owed that much again.
export default function CancelPaymentDialog({ open, title, amount, account, loading, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Modal open={open} onClose={loading ? undefined : onClose} title={title} size="sm">
      <div className="space-y-4">
        <div className="rounded-xl bg-neutral-950 px-4 py-3 text-white">
          <p className="text-xs uppercase tracking-wide text-neutral-400">Goes back to {account || 'the account it came from'}</p>
          <p className="text-2xl font-bold">{formatCurrency(amount)}</p>
        </div>
        <p className="text-sm text-slate-600">
          Ma hubtaa? Lacagta waxay dib ugu laabanaysaa account-kii laga bixiyey, shirkaddana lacagtaas ayaa mar kale lagu leeyahay. (The money goes back
          to the account and the supplier is owed it again.)
        </p>
        <FormField label="Reason (optional)">
          <Textarea rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. paid twice, wrong amount" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Keep it
          </Button>
          <Button variant="danger" loading={loading} onClick={() => onConfirm(reason)}>
            <Undo2 className="h-4 w-4" /> Cancel payment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
