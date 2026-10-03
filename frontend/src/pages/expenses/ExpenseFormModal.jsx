import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyForm = () => ({ category: '', amount: '', date: today(), paymentAccountId: '', note: '' });

const NEW_CATEGORY = '__new__';

export default function ExpenseFormModal({ open, onClose, onSaved, categories, onCategoriesChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const canAddCategory = user?.role === 'admin' || user?.role === 'manager';
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(emptyForm());
      setErrors({});
      setNewCategory('');
    }
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const addCategory = async () => {
    setAddingCategory(true);
    try {
      const res = await client.post('/expenses/categories', { name: newCategory });
      await onCategoriesChanged?.();
      setForm((f) => ({ ...f, category: res.data.data.name }));
      setNewCategory('');
      toast.success(`Category "${res.data.data.name}" added.`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not add category.');
    } finally {
      setAddingCategory(false);
    }
  };

  const validate = () => {
    const e = {};
    if (!form.category || form.category === NEW_CATEGORY) e.category = 'Select a category.';
    if (!(Number(form.amount) > 0)) e.amount = 'Enter an amount greater than zero.';
    if (!form.paymentAccountId) e.paymentAccountId = 'Select the account this was paid from.';
    if (!form.date) e.date = 'Select a date.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await client.post('/expenses', { ...form, amount: Number(form.amount) });
      toast.success('Expense saved and deducted from the account.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save expense.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Expense" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Category" required error={errors.category}>
          <Select value={form.category} onChange={set('category')} error={errors.category}>
            <option value="">Select category...</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {canAddCategory && <option value={NEW_CATEGORY}>+ Add new category...</option>}
          </Select>
          {form.category === NEW_CATEGORY && (
            <div className="mt-2 flex gap-2">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={60} placeholder="e.g. Internet, Cleaning" autoFocus />
              <Button type="button" onClick={addCategory} loading={addingCategory} disabled={!newCategory.trim()}>
                Add
              </Button>
            </div>
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Amount" required error={errors.amount}>
            <Input type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} placeholder="0.00" error={errors.amount} />
          </FormField>
          <FormField label="Date" required error={errors.date}>
            <Input type="date" value={form.date} onChange={set('date')} error={errors.date} />
          </FormField>
        </div>
        <FormField label="Payment Account" required error={errors.paymentAccountId}>
          <AccountSelect value={form.paymentAccountId} onChange={(id) => setForm((f) => ({ ...f, paymentAccountId: id || '' }))} />
        </FormField>
        <FormField label="Note">
          <Textarea rows={2} maxLength={500} value={form.note} onChange={set('note')} placeholder="e.g. Cumar's salary" />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Expense
          </Button>
        </div>
      </form>
    </Modal>
  );
}
