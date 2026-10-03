import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', phone: '', email: '', address: '', openingBalance: '0', notes: '' };

export default function CustomerFormModal({ open, onClose, customer, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || '',
        openingBalance: '0',
        notes: customer.notes || '',
      });
    } else {
      setForm(empty);
    }
    setError('');
  }, [customer, open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Customer name is required.');
      return;
    }
    setSaving(true);
    try {
      if (customer) {
        await client.put(`/customers/${customer.id}`, form);
        toast.success('Customer updated.');
      } else {
        await client.post('/customers', form);
        toast.success('Customer created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save customer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit Customer' : 'Add Customer'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <FormField label="Full Name" required>
          <Input value={form.name} onChange={set('name')} placeholder="e.g. Ahmed Ali" />
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
        {!customer && (
          <FormField label="Opening Balance">
            <Input type="number" step="0.01" value={form.openingBalance} onChange={set('openingBalance')} />
          </FormField>
        )}
        <FormField label="Notes">
          <Textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Optional" />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {customer ? 'Save Changes' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
