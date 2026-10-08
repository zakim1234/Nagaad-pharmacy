import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import SupplierPicker from './SupplierPicker.jsx';

function dayString(date) {
  const d = date ? new Date(date) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Corrects an existing purchase invoice. Payments are not changed here
// (they have their own Edit/Delete in Payment History); the total can never
// go below what has already been paid.
export default function PurchaseEditModal({ purchase, onClose, onSaved }) {
  const toast = useToast();
  const open = !!purchase;
  const [supplier, setSupplier] = useState(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!purchase) return;
    setSupplier({ id: purchase.supplier, name: purchase.supplierName });
    setSupplierInvoiceNumber(purchase.supplierInvoiceNumber || '');
    setAmount(String(purchase.totalAmount));
    setPurchaseDate(dayString(purchase.purchaseDate || purchase.createdAt));
    setNotes(purchase.notes || '');
  }, [purchase]);

  if (!purchase) return null;

  const total = Number(amount) || 0;
  const paid = purchase.paidAmount;
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);
  const status = paid <= 0 ? 'Unpaid' : paid >= total ? 'Paid' : 'Partial';
  const tooLow = total > 0 && total < paid;

  const save = async () => {
    if (!supplier) return toast.error('Select a supplier.');
    if (!(total > 0)) return toast.error('Enter a positive Total Amount.');
    if (tooLow) return toast.error(`Total cannot be less than what has already been paid (${formatCurrency(paid)}).`);
    setSaving(true);
    try {
      await client.put(`/purchases/${purchase.id}`, { supplierId: supplier.id, supplierInvoiceNumber, amount: total, purchaseDate, notes });
      toast.success(`${purchase.purchaseNumber} updated.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not update this invoice.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit ${purchase.purchaseNumber}`} size="md">
      <div className="space-y-4">
        <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
        <FormField label="Supplier Invoice / Serial Number">
          <Input value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Total Amount" required>
            <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} error={tooLow} />
          </FormField>
          <FormField label="Date">
            <Input type="date" value={purchaseDate} max={dayString()} onChange={(e) => setPurchaseDate(e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
          <div>
            <p className="text-xs text-slate-400">Already paid</p>
            <p className="font-semibold tabular-nums text-slate-800">{formatCurrency(paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Balance due</p>
            <p className={`font-semibold tabular-nums ${balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(balance)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Status</p>
            <p className="font-semibold text-slate-800">{status}</p>
          </div>
        </div>
        {tooLow && <p className="text-sm text-rose-600">Total cannot be less than the {formatCurrency(paid)} already paid. Edit or delete a payment first.</p>}
        <FormField label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={save} disabled={tooLow}>Save Changes</Button>
        </div>
      </div>
    </Modal>
  );
}
