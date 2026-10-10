import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import SupplierPicker from './SupplierPicker.jsx';

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Records goods taken on credit from a supplier: their invoice serial number
// and the amount, added to what we owe them. Paying is done separately
// (Pay this supplier / Vendor Balances), against the supplier's total.
export default function PurchaseFormModal({ open, onClose, onSaved, initialSupplier = null }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [serial, setSerial] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayString());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplier(initialSupplier);
    setSerial('');
    setAmount('');
    setDate(todayString());
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = Number(amount) || 0;

  async function save() {
    if (!supplier) return toast.error('Select the supplier.');
    if (!serial.trim()) return toast.error('Enter the invoice serial number from the supplier.');
    if (!(total > 0)) return toast.error('Enter the invoice amount.');
    setSaving(true);
    try {
      const res = await client.post('/purchases', { supplierId: supplier.id, supplierInvoiceNumber: serial.trim(), amount: total, amountPaid: 0, purchaseDate: date });
      toast.success(`${res.data.data.purchaseNumber} saved — ${formatCurrency(total)} added to what you owe ${supplier.name}.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save invoice.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Add supplier invoice"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save invoice
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
        <FormField label="Invoice serial number (on their invoice)" required>
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} maxLength={60} placeholder="e.g. 5546466" autoFocus />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Amount" required>
            <Input type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </FormField>
          <FormField label="Date">
            <Input type="date" value={date} max={todayString()} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        </div>
        {supplier && total > 0 && (
          <p className="rounded-lg bg-neutral-950 px-3 py-2.5 text-sm text-white">
            <span className="font-bold text-brand-400">{formatCurrency(total)}</span> will be added to what you owe <span className="font-semibold">{supplier.name}</span>.
          </p>
        )}
      </div>
    </Modal>
  );
}
