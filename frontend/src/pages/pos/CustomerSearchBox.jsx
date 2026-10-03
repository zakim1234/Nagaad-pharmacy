import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X, Phone, AlertTriangle } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import { Input, Label } from '../../components/ui/Field.jsx';
import Button from '../../components/ui/Button.jsx';

// The core POS UX requirement: the seller TYPES a customer name (never
// browses a dropdown). Matches appear live; if none match, a "Create New
// Customer" action lets the seller add one without leaving the sale.
export default function CustomerSearchBox({ activeCustomer, onSelect, onClear, cartTotal = 0, paidAmount = 0, walletAmount = 0, searchValue, onSearchChange, enteredCustomer, onEnteredCustomerChange }) {
  const toast = useToast();
  const [localQuery, setLocalQuery] = useState('');
  const query = searchValue ?? localQuery;
  const setQuery = onSearchChange || setLocalQuery;
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [localCustomer, setLocalCustomer] = useState({ name: '', phone: '' });
  const newCustomer = enteredCustomer ?? localCustomer;
  const setNewCustomer = onEnteredCustomerChange || setLocalCustomer;
  const [creating, setCreating] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    client
      .get('/customers/search', { params: { q: debouncedQuery } })
      .then((res) => setResults(res.data.data))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  }, [debouncedQuery]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleSelect = (customer) => {
    onSelect(customer);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  const openCreateForm = () => {
    setNewCustomer({ name: query, phone: '' });
    setShowCreateForm(true);
    setShowDropdown(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCustomer.name.trim()) {
      toast.error('Please enter the customer name.');
      return;
    }
    setCreating(true);
    try {
      const res = await client.post('/customers', newCustomer);
      toast.success(`Customer "${res.data.data.name}" created.`);
      handleSelect(res.data.data);
      setShowCreateForm(false);
      setQuery('');
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not create customer.');
    } finally {
      setCreating(false);
    }
  };

  if (activeCustomer) {
    const previousDebt = activeCustomer.balance;
    const potentialNewBalance = previousDebt + Math.max(0, cartTotal - paidAmount - walletAmount);
    const hasPreviousDebt = previousDebt > 0;

    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Customer</p>
            <p className="text-lg font-bold text-slate-900">{activeCustomer.name}</p>
            {activeCustomer.phone && (
              <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                <Phone className="h-3.5 w-3.5" /> {activeCustomer.phone}
              </p>
            )}
          </div>
          <button onClick={onClear} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600" title="Change customer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {hasPreviousDebt && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-rose-100 px-3 py-2 text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="text-sm font-semibold">
              This customer already owes {formatCurrency(previousDebt)} from previous sales.
            </p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white px-3 py-2">
            <p className="text-xs text-slate-400">Previous Debt</p>
            <p className={`text-base font-bold ${previousDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(previousDebt)}
            </p>
          </div>
          <div className="rounded-lg bg-white px-3 py-2">
            <p className="text-xs text-slate-400">Wallet Available</p>
            <p className="text-base font-bold text-indigo-600">{formatCurrency(activeCustomer.walletBalance || 0)}</p>
          </div>
          <div className="rounded-lg bg-white px-3 py-2">
            <p className="text-xs text-slate-400">Current Cart</p>
            <p className="text-base font-bold text-slate-800">{formatCurrency(cartTotal)}</p>
          </div>
          <div className="rounded-lg bg-white px-3 py-2">
            <p className="text-xs text-slate-400">Current Payment</p>
            <p className="text-base font-bold text-slate-800">{formatCurrency(paidAmount + walletAmount)}</p>
          </div>
          <div className="col-span-2 rounded-lg bg-white px-3 py-2">
            <p className="text-xs text-slate-400">Potential New Balance</p>
            <p className={`text-base font-bold ${potentialNewBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {formatCurrency(potentialNewBalance)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Label>Customer</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          autoFocus
          className="pl-9"
          placeholder="Type customer name to search..."
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
          {searching ? (
            <div className="px-4 py-3 text-sm text-slate-400">Searching...</div>
          ) : results.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => handleSelect(c)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-indigo-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.phone || 'No phone'}</p>
                    </div>
                    <span className={`text-sm font-semibold ${c.balance > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {formatCurrency(c.balance)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3">
              <p className="mb-2 text-sm text-slate-500">
                No customer found for "<span className="font-medium">{query}</span>"
              </p>
              <button
                onClick={openCreateForm}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <UserPlus className="h-4 w-4" /> Create New Customer "{query}"
              </button>
            </div>
          )}
        </div>
      )}

      {showCreateForm && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <p className="mb-3 text-sm font-semibold text-slate-800">Create New Customer</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <Input autoFocus placeholder="Full name" value={newCustomer.name} onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))} />
            <Input placeholder="Phone (optional)" value={newCustomer.phone} onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={creating}>
                Create &amp; Continue
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
