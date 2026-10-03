import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Input, Label } from '../../components/ui/Field.jsx';
import Button from '../../components/ui/Button.jsx';

export default function SupplierPicker({ active, onSelect, onClear }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    client
      .get('/suppliers/search', { params: { q: debouncedQuery } })
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

  const handleSelect = (s) => {
    onSelect(s);
    setQuery('');
    setShowDropdown(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newSupplier.name.trim()) {
      toast.error('Please enter the supplier name.');
      return;
    }
    setCreating(true);
    try {
      const res = await client.post('/suppliers', newSupplier);
      toast.success(`Supplier "${res.data.data.name}" created.`);
      handleSelect(res.data.data);
      setShowCreateForm(false);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not create supplier.');
    } finally {
      setCreating(false);
    }
  };

  if (active) {
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Supplier</p>
            <p className="text-lg font-bold text-slate-900">{active.name}</p>
            {active.phone && <p className="text-sm text-slate-500">{active.phone}</p>}
          </div>
          <button onClick={onClear} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Label>Supplier</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search or type a new supplier name..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
        />
      </div>

      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {results.length > 0 ? (
            <ul className="max-h-56 overflow-y-auto">
              {results.map((s) => (
                <li key={s.id}>
                  <button onClick={() => handleSelect(s)} className="flex w-full flex-col items-start px-4 py-2.5 text-left hover:bg-indigo-50">
                    <span className="text-sm font-medium text-slate-800">{s.name}</span>
                    <span className="text-xs text-slate-400">{s.phone || 'No phone'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-500">No matching suppliers.</div>
          )}
          <button
            onClick={() => {
              setNewSupplier({ name: query, phone: '' });
              setShowCreateForm(true);
              setShowDropdown(false);
            }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            <UserPlus className="h-4 w-4" /> Create New Supplier
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <p className="mb-3 text-sm font-semibold text-slate-800">Create New Supplier</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input autoFocus placeholder="Supplier name" value={newSupplier.name} onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))} />
            <Input placeholder="Phone (optional)" value={newSupplier.phone} onChange={(e) => setNewSupplier((s) => ({ ...s, phone: e.target.value }))} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={creating}>
                Create
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
