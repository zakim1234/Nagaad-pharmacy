import { useEffect, useRef, useState } from 'react';
import { Search, X, Printer, FileText, Boxes, PenLine } from 'lucide-react';
import ManualSupplierInvoiceArchive from './ManualSupplierInvoiceArchive.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import logo from '../../images/logo.png';

// Reads existing supplier + stock-entry data to build a purchase-facing
// invoice. Nothing here creates or duplicates stock/product records -- it is
// a read-only document generated from Stock (see SUPPLIER -> STOCK ENTRY ->
// STOCK PRODUCTS -> SUPPLIER INVOICE relationship).
function SupplierPicker({ supplier, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(query, 250);
  const wrapRef = useRef(null);

  useEffect(() => {
    client.get('/suppliers/search', { params: { q: debounced } }).then((res) => setResults(res.data.data)).catch(() => setResults([]));
  }, [debounced]);

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (supplier) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
        <span className="font-medium text-slate-800">{supplier.name}</span>
        {supplier.phone && <span className="text-slate-400">{supplier.phone}</span>}
        <button type="button" onClick={onClear} className="ml-auto text-slate-400 hover:text-rose-600" aria-label="Change supplier">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input className="pl-9" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search supplier by name..." />
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matching suppliers</div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {results.map((s) => (
                <li key={s.id}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); onSelect(s); setQuery(''); setOpen(false); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span>{s.name}</span>
                    {s.phone && <span className="text-xs text-slate-400">{s.phone}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function SupplierInvoicesPage() {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [entrySearch, setEntrySearch] = useState('');
  const debouncedEntrySearch = useDebounce(entrySearch, 250);
  const [tab, setTab] = useState('stock');

  useEffect(() => {
    if (!supplier) { setEntries([]); setSelected(null); return; }
    setLoading(true);
    client
      .get('/stock', { params: { supplier: supplier.id, q: debouncedEntrySearch, page: 1 } })
      .then((res) => { setEntries(res.data.data); setSelected((prev) => res.data.data.find((e) => e._id === prev?._id) || res.data.data[0] || null); })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load stock entries for this supplier.'))
      .finally(() => setLoading(false));
  }, [supplier, debouncedEntrySearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setEntrySearch(''), [supplier]);

  const totalCost = selected ? selected.rows.reduce((sum, r) => sum + r.quantity * r.costPriceCents, 0) / 100 : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Supplier Invoices"
        subtitle="Generate purchase-facing invoices directly from existing Stock Entries -- no selling price, no duplicated products."
      />

      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 no-print sm:inline-flex">
        <button
          onClick={() => setTab('stock')}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            tab === 'stock' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Boxes className="h-4 w-4" /> From Stock
        </button>
        <button
          onClick={() => setTab('manual')}
          className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            tab === 'manual' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <PenLine className="h-4 w-4" /> Manual Entry / Archive
        </button>
      </div>

      {tab === 'manual' ? (
        <ManualSupplierInvoiceArchive />
      ) : (
      <>
      <Card className="no-print">
        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">Supplier</label>
          <SupplierPicker supplier={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
        </div>
      </Card>

      {!supplier && (
        <Card><p className="py-8 text-center text-sm text-slate-400">Select a supplier to see their stock entries and generate a Supplier Invoice.</p></Card>
      )}

      {supplier && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card title={`Stock Entries (${entries.length})`} className="no-print h-fit">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={entrySearch}
                onChange={(e) => setEntrySearch(e.target.value)}
                placeholder="Search by shop/supplier serial or stock no..."
              />
            </div>
            {loading ? (
              <p className="py-6 text-center text-sm text-slate-400">Loading...</p>
            ) : entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">{entrySearch ? 'No stock entries match that search.' : 'No stock entries linked to this supplier yet.'}</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <button
                    key={entry._id}
                    onClick={() => setSelected(entry)}
                    className={`block w-full rounded-md p-2.5 text-left text-sm transition-colors ${selected?._id === entry._id ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                  >
                    <p className="font-semibold text-slate-800">{entry.stockSerial}</p>
                    {entry.externalSerialNumber && <p className="text-xs text-slate-500">Shop Serial: {entry.externalSerialNumber}</p>}
                    <p className="text-xs text-slate-400">{formatDateTime(entry.createdAt)}</p>
                  </button>
                ))}
              </div>
            )}
          </Card>

          {selected && (
            <div>
              <div className="mb-3 flex justify-end no-print">
                <Button onClick={() => printReport('portrait')}>
                  <Printer className="h-4 w-4" /> Print Supplier Invoice
                </Button>
              </div>

              <div id="print-area" className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
                <div className="flex flex-col items-center text-center">
                  <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
                  <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
                  <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
                  <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
                </div>

                <div className="my-4 border-t border-dashed border-slate-300" />
                <p className="text-center text-lg font-bold uppercase tracking-wide text-slate-900 flex items-center justify-center gap-2">
                  <FileText className="h-4 w-4 no-print" /> Supplier Invoice
                </p>

                <div className="my-4 flex flex-wrap items-start justify-between gap-4 border-t border-dashed border-slate-300 pt-4">
                  <div>
                    <p className="text-xs uppercase text-slate-400">Supplier</p>
                    <p className="text-sm font-bold text-slate-900">{selected.supplier?.name || supplier.name}</p>
                    {(selected.supplier?.phone || supplier.phone) && <p className="text-xs text-slate-500">{selected.supplier?.phone || supplier.phone}</p>}
                    {(selected.supplier?.address || supplier.address) && <p className="text-xs text-slate-500">{selected.supplier?.address || supplier.address}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase text-slate-400">Stock Entry No.</p>
                    <p className="text-sm font-bold text-slate-900">{selected.stockSerial}</p>
                    {selected.externalSerialNumber && (
                      <>
                        <p className="mt-1 text-xs uppercase text-slate-400">Supplier/Shop Serial</p>
                        <p className="text-sm font-semibold text-slate-800">{selected.externalSerialNumber}</p>
                      </>
                    )}
                    <p className="mt-1 text-xs text-slate-500">{formatDate(selected.createdAt)}</p>
                  </div>
                </div>

                <div className="my-3 border-t border-dashed border-slate-300" />

                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
                      <th className="w-8 py-1.5 font-medium">No</th>
                      <th className="py-1.5 font-medium">Item</th>
                      <th className="py-1.5 text-center font-medium">Qty</th>
                      <th className="py-1.5 text-right font-medium">Unit Cost</th>
                      <th className="py-1.5 text-right font-medium">Amount</th>
                      <th className="py-1.5 text-right font-medium">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.rows.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 text-slate-500">{i + 1}</td>
                        <td className="py-1.5 text-slate-700">{r.itemName}</td>
                        <td className="py-1.5 text-center text-slate-600">{r.quantity}</td>
                        <td className="py-1.5 text-right text-slate-600">{formatCurrency(r.costPriceCents / 100)}</td>
                        <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency((r.quantity * r.costPriceCents) / 100)}</td>
                        <td className="py-1.5 text-right text-slate-500">{r.expiryDate ? formatDate(r.expiryDate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="my-3 border-t border-dashed border-slate-300" />

                <div className="flex justify-end">
                  <div className="w-56 space-y-1 text-sm">
                    <div className="flex justify-between rounded-md bg-slate-50 px-3 py-2 font-bold text-slate-900">
                      <span>Total Cost</span>
                      <span>{formatCurrency(totalCost)}</span>
                    </div>
                  </div>
                </div>

                <div className="my-3 border-t border-dashed border-slate-300" />
                <p className="text-center text-[11px] text-slate-400">Generated from Stock Entry {selected.stockSerial}.</p>
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
