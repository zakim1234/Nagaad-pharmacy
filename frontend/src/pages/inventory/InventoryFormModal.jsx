import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';

const emptyForm = {
  name: '',
  serialNumber: '',
  genericName: '',
  manufacturer: '',
  batchNumber: '',
  barcode: '',
  lowStockThreshold: '10',
  category: '',
  quantity: '0',
  unit: 'pcs',
  costPrice: '',
  sellingPrice: '',
  expiryDate: '',
  supplier: '',
};

export default function InventoryFormModal({ open, onClose, item, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    if (!open) return;
    client.get('/categories').then((res) => setCategories(res.data.data));
    client.get('/suppliers?limit=100').then((res) => setSuppliers(res.data.data));
  }, [open]);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name || '',
        serialNumber: item.serialNumber || '',
        genericName: item.genericName || '',
        manufacturer: item.manufacturer || '',
        batchNumber: item.batchNumber || '',
        barcode: item.barcode || '',
        lowStockThreshold: String(item.lowStockThreshold ?? 10),
        category: item.category?.id || '',
        quantity: String(item.quantity ?? 0),
        unit: item.unit || 'pcs',
        costPrice: String(item.costPrice ?? ''),
        sellingPrice: String(item.sellingPrice ?? ''),
        expiryDate: item.expiryDate ? item.expiryDate.slice(0, 10) : '',
        supplier: item.supplier?._id || item.supplier || '',
      });
    } else {
      setForm(emptyForm);
    }
    setErrors({});
  }, [item, open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Item name is required.';
    if (form.costPrice === '' || Number(form.costPrice) < 0) e.costPrice = 'Enter a valid cost price.';
    if (form.sellingPrice === '' || Number(form.sellingPrice) < 0) e.sellingPrice = 'Enter a valid selling price.';
    if (Number(form.quantity) < 0) e.quantity = 'Quantity cannot be negative.';
    if (form.lowStockThreshold === '' || !Number.isInteger(Number(form.lowStockThreshold)) || Number(form.lowStockThreshold) < 0) {
      e.lowStockThreshold = 'Enter a whole number of 0 or more.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        serialNumber: form.serialNumber.trim(),
        genericName: form.genericName.trim(),
        manufacturer: form.manufacturer.trim(),
        batchNumber: form.batchNumber.trim(),
        barcode: form.barcode.trim(),
        lowStockThreshold: Number(form.lowStockThreshold),
        quantity: Number(form.quantity),
        costPrice: Number(form.costPrice),
        sellingPrice: Number(form.sellingPrice),
        expiryDate: form.expiryDate || null,
        supplier: form.supplier || null,
        category: form.category || null,
      };
      if (item) {
        await client.put(`/inventory/${item.id}`, payload);
        toast.success('Item updated successfully.');
      } else {
        await client.post('/inventory', payload);
        toast.success('Item added to inventory.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={item ? 'Edit Item' : 'Add Inventory Item'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Basic Information</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {item && (
              <FormField label="Item ID">
                <Input value={item.itemCode || ''} disabled className="bg-slate-50 font-mono text-slate-500" />
              </FormField>
            )}
            <FormField label="Item Name" required error={errors.name}>
              <Input value={form.name} onChange={set('name')} placeholder="e.g. Rice (5kg bag)" />
            </FormField>
            <FormField label="Serial Number">
              <Input value={form.serialNumber} onChange={set('serialNumber')} placeholder="e.g. SN-100245" />
            </FormField>
            <FormField label="Generic Name">
              <Input value={form.genericName} onChange={set('genericName')} placeholder="e.g. Amoxicillin" />
            </FormField>
            <FormField label="Manufacturer">
              <Input value={form.manufacturer} onChange={set('manufacturer')} placeholder="e.g. Pfizer" />
            </FormField>
            <FormField label="Batch Number">
              <Input value={form.batchNumber} onChange={set('batchNumber')} placeholder="e.g. B-2201" />
            </FormField>
            <FormField label="Barcode">
              <Input value={form.barcode} onChange={set('barcode')} placeholder="Scan or type the barcode" />
            </FormField>
            <FormField label="Category">
              {categories.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
                  No categories yet.{' '}
                  <Link to="/categories" className="font-medium text-indigo-600 hover:underline" onClick={onClose}>
                    Create one
                  </Link>
                </div>
              ) : (
                <Select value={form.category} onChange={set('category')}>
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Pricing</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={item ? 'Average Cost' : 'Cost Price'} required error={errors.costPrice}>
              <Input type="number" step="0.01" min="0" value={form.costPrice} onChange={set('costPrice')} placeholder="0.00" />
              {item && (
                <p className="mt-1 text-xs text-slate-400">
                  System-computed from Stock IN receipts. Editing this directly overrides the computed average.
                </p>
              )}
            </FormField>
            <FormField label="Selling Price" required error={errors.sellingPrice}>
              <Input type="number" step="0.01" min="0" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" />
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Stock Information</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Quantity (receive goods through Stock)" error={errors.quantity}>
              <Input type="number" min="0" value={form.quantity} readOnly />
            </FormField>
            <FormField label="Unit">
              <Input value={form.unit} onChange={set('unit')} placeholder="pcs, kg, bag..." />
            </FormField>
            <FormField label="Minimum Stock" required error={errors.lowStockThreshold}>
              <Input type="number" min="0" step="1" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />
              <p className="mt-1 text-xs text-slate-400">Low Stock alerts start at or below this quantity.</p>
            </FormField>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Supplier &amp; Expiration</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Supplier">
              <Select value={form.supplier} onChange={set('supplier')}>
                <option value="">No supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Expiry Date">
              <Input type="date" value={form.expiryDate} onChange={set('expiryDate')} />
            </FormField>
          </div>
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {item ? 'Save Changes' : 'Add Item'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
