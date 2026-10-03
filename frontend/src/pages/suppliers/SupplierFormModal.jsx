import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', phone: '', email: '', address: '', notes: '' };

export default function SupplierFormModal({ open, onClose, supplier, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(supplier ? { name: supplier.name || '', phone: supplier.phone || '', email: supplier.email || '', address: supplier.address || '', notes: supplier.notes || '' } : empty);
    setError('');
  }, [supplier, open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Supplier name is required.');
      return;
    }
    setSaving(true);
    try {
      if (supplier) {
        await client.put(`/suppliers/${supplier.id}`, form);
        toast.success('Supplier updated.');
      } else {
        await client.post('/suppliers', form);
        toast.success('Supplier created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save supplier.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit Supplier' : 'Add Supplier'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <FormField label="Supplier Name" required>
          <Input value={form.name} onChange={set('name')} placeholder="e.g. General Wholesale Co." />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone">
            <Input value={form.phone} onChange={set('phone')} placeholder="Optional" />
          </FormField>
          <FormField label="Email">
            <Input value={form.email} onChange={set('email')} placeholder="Optional" />
          </FormField>
        </div>
        <FormField label="Address">
          <Input value={form.address} onChange={set('address')} placeholder="Optional" />
        </FormField>
        <FormField label="Notes">
          <Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {supplier ? 'Save Changes' : 'Create Supplier'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
