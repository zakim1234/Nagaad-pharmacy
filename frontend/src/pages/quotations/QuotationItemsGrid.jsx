import { useEffect, useRef, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency } from '../../utils/format.js';

// Trailing "add new item" search cell, shared shape with the Seller grid's
// ItemSearchCell: search matches by item name, Item ID, or serial number.
function ItemSearchCell({ onSelect, inputRef }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounced = useDebounce(query, 200);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    client.get('/inventory/search', { params: { q: debounced } }).then((res) => setResults(res.data.data)).catch(() => setResults([]));
  }, [debounced]);

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const choose = (item) => {
    if (!item) return;
    onSelect(item);
    setQuery(''); setResults([]); setOpen(false); setHighlighted(0);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[highlighted]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlighted(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search item, serial number, or item ID..."
          className="w-full rounded-md border border-transparent bg-transparent py-1.5 pl-7 pr-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-1 focus:ring-indigo-200"
        />
      </div>
      {open && query.trim() && (
        <div className="absolute z-30 mt-1 w-80 max-w-[85vw] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matching items</div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(r); }} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${i === highlighted ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                      <p className="truncate text-slate-400">{r.itemCode}{r.serialNumber ? ` · SN: ${r.serialNumber}` : ''}</p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-700">{formatCurrency(r.sellingPrice)}</span>
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

function RemoveButton({ onClick }) {
  return (
    <button type="button" tabIndex={-1} onClick={onClick} className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600" title="Remove row">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

// Compact, spreadsheet-style item entry grid for Quotations: ITEM, QTY,
// RATE, DISCOUNT, AMOUNT. Tab flows from a row's Discount input straight into
// the next row's Qty (native DOM order), or into the trailing search cell
// once the last row is reached, so a whole quotation can be entered by
// keyboard alone: select item -> Tab -> Qty -> Tab -> Rate -> Tab -> Discount
// -> Tab -> next row.
export default function QuotationItemsGrid({ items, onAddLine, onChangeLine, onRemoveLine }) {
  const qtyRefs = useRef({});
  const newRowRef = useRef(null);
  const lastAddedIdRef = useRef(null);

  useEffect(() => {
    if (lastAddedIdRef.current) {
      qtyRefs.current[lastAddedIdRef.current]?.focus();
      qtyRefs.current[lastAddedIdRef.current]?.select();
      lastAddedIdRef.current = null;
    }
  }, [items]);

  const handleSelect = (item) => {
    lastAddedIdRef.current = item.id;
    onAddLine(item);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[13%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[15%]" />
          <col className="w-[5%]" />
        </colgroup>
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Item</th>
            <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Qty</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Rate</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Discount</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((line) => {
            const amount = Number(line.unitPrice || 0) * Number(line.quantity || 0) - Number(line.discount || 0);
            return (
              <tr key={line.itemId}>
                <td className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-800">{line.name}</p>
                </td>
                <td className="px-2 py-2">
                  <input
                    ref={(el) => { qtyRefs.current[line.itemId] = el; }}
                    type="number" min="1" step="1" value={line.quantity}
                    onChange={(e) => onChangeLine(line.itemId, 'quantity', e.target.value)}
                    className="no-spinner mx-auto block w-16 rounded-md border border-slate-200 px-2 py-1.5 text-center text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01" value={line.unitPrice}
                    onChange={(e) => onChangeLine(line.itemId, 'unitPrice', e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number" min="0" step="0.01" value={line.discount}
                    onChange={(e) => onChangeLine(line.itemId, 'discount', e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                  />
                </td>
                <td className="px-3 py-2 text-right text-[15px] font-semibold tabular-nums text-slate-900">{formatCurrency(amount)}</td>
                <td className="px-1 py-2 text-center">
                  <RemoveButton onClick={() => onRemoveLine(line.itemId)} />
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="px-1 py-1.5"><ItemSearchCell onSelect={handleSelect} inputRef={newRowRef} /></td>
            <td className="px-2 py-1.5 text-center text-sm text-slate-300">—</td>
            <td className="px-3 py-1.5 text-right text-sm text-slate-300">—</td>
            <td className="px-3 py-1.5 text-right text-sm text-slate-300">—</td>
            <td className="px-3 py-1.5 text-right text-sm text-slate-300">—</td>
            <td className="px-2 py-1.5" />
          </tr>
        </tbody>
      </table>
      {items.length === 0 && <p className="px-3 py-2 text-center text-sm text-slate-400">Search for a product to begin. Quotation quantities do not reserve stock.</p>}
    </div>
  );
}
