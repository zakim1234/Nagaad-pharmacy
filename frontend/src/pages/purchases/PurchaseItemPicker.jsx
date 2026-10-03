import { useEffect, useRef, useState } from 'react';
import { Search, Package, PackagePlus } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Input, Label } from '../../components/ui/Field.jsx';
import Button from '../../components/ui/Button.jsx';

export default function PurchaseItemPicker({ onAdd }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', unit: 'pcs' });
  const [creating, setCreating] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    client
      .get('/inventory/search', { params: { q: debouncedQuery } })
      .then((res) => setResults(res.data.data))
      .catch(() => setResults([]));
  }, [debouncedQuery]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleAdd = (item) => {
    onAdd(item);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newItem.name.trim()) {
      toast.error('Please enter the item name.');
      return;
    }
    setCreating(true);
    try {
      const res = await client.post('/inventory', { ...newItem, quantity: 0, costPrice: 0, sellingPrice: 0 });
      toast.success(`Item "${res.data.data.name}" created. Set its selling price after this purchase.`);
      handleAdd(res.data.data);
      setShowCreateForm(false);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not create item.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <Label>Add Product to Purchase</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search inventory by name, Item ID or serial number..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && query.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => handleAdd(p)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-indigo-50">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <Package className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">
                        {p.itemCode} · current stock: {p.quantity}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500">No matching items.</div>
          )}
          <button
            onClick={() => {
              setNewItem({ name: query, unit: 'pcs' });
              setShowCreateForm(true);
              setShowDropdown(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            <PackagePlus className="h-4 w-4" /> Create New Item "{query}"
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <p className="mb-3 text-sm font-semibold text-slate-800">Create New Inventory Item</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input autoFocus placeholder="Item name" value={newItem.name} onChange={(e) => setNewItem((f) => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Unit (pcs, kg...)" value={newItem.unit} onChange={(e) => setNewItem((f) => ({ ...f, unit: e.target.value }))} />
            <p className="text-xs text-slate-400">Category can be set later from the Inventory page. New item will be Uncategorized for now.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={creating}>
                Create &amp; Add
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
