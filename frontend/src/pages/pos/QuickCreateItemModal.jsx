import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

// Quick-create for an item that is not in Stock yet, opened from the POS item
// search. Saving creates the item AND receives the Initial Qty into Stock in
// one step (server-side, through the normal Stock IN path), then hands the new
// item back so the sale can add it as an ordinary line.
export default function QuickCreateItemModal({ open, initialName, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', categoryId: '', sellingPrice: '', initialQuantity: '', cost: '' });
  const [errors, setErrors] = useState({});
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ name: initialName || '', categoryId: '', sellingPrice: '', initialQuantity: '', cost: '' });
    setErrors({});
    client
      .get('/quick-items/categories')
      .then((res) => setCategories(res.data.data))
      .catch(() => setCategories([]));
  }, [open, initialName]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Item name is required.';
    if (form.sellingPrice === '' || Number(form.sellingPrice) < 0) e.sellingPrice = 'Enter the selling price.';
    if (!Number.isInteger(Number(form.initialQuantity)) || Number(form.initialQuantity) <= 0) e.initialQuantity = 'Enter a whole number above 0.';
    if (form.cost !== '' && Number(form.cost) < 0) e.cost = 'Cost cannot be negative.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    try {
      const res = await client.post('/quick-items', {
        name: form.name,
        categoryId: form.categoryId || null,
        sellingPrice: Number(form.sellingPrice),
        initialQuantity: Number(form.initialQuantity),
        cost: form.cost === '' ? null : Number(form.cost),
      });
      toast.success(`"${res.data.data.name}" created with ${form.initialQuantity} in Stock and added to the sale.`);
      onCreated({ ...res.data.data, saleQuantity: Number(form.initialQuantity) });
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not create this item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={saving ? undefined : onClose} title={`Quick Create Item — "${initialName || ''}"`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Item Name" required error={errors.name}>
          <Input value={form.name} onChange={set('name')} error={errors.name} autoFocus maxLength={200} />
        </FormField>
        {categories.length > 0 && (
          <FormField label="Category">
            <Select value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Selling Price" required error={errors.sellingPrice}>
            <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" error={errors.sellingPrice} />
          </FormField>
          <FormField label="Initial Qty" required error={errors.initialQuantity}>
            <Input type="number" min="1" step="1" value={form.initialQuantity} onChange={set('initialQuantity')} placeholder="0" error={errors.initialQuantity} />
          </FormField>
        </div>
        <FormField label="Cost (optional)" error={errors.cost}>
          <Input type="number" min="0" step="0.01" value={form.cost} onChange={set('cost')} placeholder="0.00" error={errors.cost} />
          <p className="mt-1 text-xs text-slate-400">
            The purchase cost per unit, if you know it — it becomes the item's starting Average Cost. Left blank, the cost is 0 and profit on this item will look like 100%
            until a real purchase is recorded.
          </p>
        </FormField>
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
          Saving adds the item to Inventory, receives the Initial Qty into Stock, and puts that quantity on this sale.
        </p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create &amp; Add to Sale
          </Button>
        </div>
      </form>
    </Modal>
  );
}
