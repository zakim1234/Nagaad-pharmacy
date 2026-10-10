import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Trash2, Plus } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency } from '../../utils/format.js';

const INITIAL_BLANK_ROWS = 3;
let blankSeq = 0;
const newBlankId = () => ++blankSeq;

const HEAD = 'px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500';
const CELL_INPUT = 'no-spinner w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm tabular-nums focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200';

// The item cell of an empty row: searches Stock/Inventory by name, item ID or
// serial number. Unlike a sale, a quotation reserves no stock, so items that
// are out of stock can still be quoted (they are only flagged). The dropdown
// lives in a portal so the table can never clip it.
function ItemSearchCell({ onSelect, inputRef }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [pos, setPos] = useState(null);
  const debounced = useDebounce(query, 200);
  const wrapRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      setSearched(false);
      return undefined;
    }
    let active = true;
    client
      .get('/inventory/search', { params: { q: debounced } })
      .then((res) => {
        if (!active) return;
        setResults(res.data.data);
        setHighlighted(0);
        setSearched(true);
      })
      .catch(() => {
        if (active) {
          setResults([]);
          setSearched(true);
        }
      });
    return () => {
      active = false;
    };
  }, [debounced]);

  const place = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 280 && r.top > spaceBelow;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 348)),
      width: Math.max(r.width, 340),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const choose = (item) => {
    if (!item) return;
    onSelect(item);
    setQuery('');
    setResults([]);
    setSearched(false);
    setOpen(false);
    setHighlighted(0);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      choose(results[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = open && query.trim() && pos;

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search item..."
        autoComplete="off"
        className="w-full rounded-md border border-transparent bg-transparent py-1.5 pl-7 pr-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:ring-1 focus:ring-brand-200"
      />
      {showDropdown &&
        createPortal(
          <div
            ref={dropRef}
            style={{ position: 'fixed', zIndex: 60, left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            className="max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {results.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">{searched ? 'No matching item in Stock.' : 'Searching...'}</div>
            ) : (
              <ul className="max-h-64 overflow-y-auto py-1">
                {results.map((r, i) => {
                  const out = r.availableQuantity <= 0;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          choose(r);
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${i === highlighted ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">{r.name}</p>
                          <p className={`truncate text-xs ${out ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                            {r.itemCode}
                            {r.serialNumber ? ` · SN: ${r.serialNumber}` : ''} · Stock: {Math.max(0, r.availableQuantity ?? 0)} {r.unit || ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-700">{formatCurrency(r.sellingPrice)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

function RemoveButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
      title="Remove row"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

// Quotation item entry, laid out like the Seller's sales grid: ITEM NAME /
// QTY / PRICE / DISCOUNT / TOTAL, a trash icon per row, empty "Search item"
// rows, "+ Add Row", and the totals (with the additional discount) at the
// bottom. Picking an item fills the row and jumps to its Qty.
export default function QuotationItemsGrid({ items, onAddLine, onChangeLine, onRemoveLine, subtotal, discount, onDiscountChange, totalDiscount }) {
  const [blanks, setBlanks] = useState(() => Array.from({ length: INITIAL_BLANK_ROWS }, newBlankId));
  const qtyRefs = useRef({});
  const blankRefs = useRef({});
  const lastAddedIdRef = useRef(null);
  const focusBlankRef = useRef(null);

  useEffect(() => {
    if (lastAddedIdRef.current) {
      const el = qtyRefs.current[lastAddedIdRef.current];
      el?.focus();
      el?.select();
      lastAddedIdRef.current = null;
    }
  }, [items]);

  useEffect(() => {
    if (focusBlankRef.current != null) {
      blankRefs.current[focusBlankRef.current]?.focus();
      focusBlankRef.current = null;
    }
  }, [blanks]);

  const handleSelect = (blankId) => (item) => {
    lastAddedIdRef.current = item.id;
    onAddLine(item);
    setBlanks((prev) => {
      const next = prev.filter((id) => id !== blankId);
      return next.length ? next : [newBlankId()];
    });
  };

  const addBlankRow = () => {
    const id = newBlankId();
    focusBlankRef.current = id;
    setBlanks((prev) => [...prev, id]);
  };

  const removeBlank = (id) => setBlanks((prev) => (prev.length > 1 ? prev.filter((b) => b !== id) : prev));
  const lineTotal = (line) => Math.max(0, Number(line.unitPrice || 0) * Number(line.quantity || 0) - Number(line.discount || 0));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 sm:overflow-visible">
        <table className="w-full min-w-160 text-sm">
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
            <col className="w-[15%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead className="bg-slate-50">
            <tr>
              <th className={`${HEAD} text-left`}>Item Name</th>
              <th className={`${HEAD} text-center`}>Qty</th>
              <th className={`${HEAD} text-right`}>Price</th>
              <th className={`${HEAD} text-right`}>Discount</th>
              <th className={`${HEAD} text-right`}>Total</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {items.map((line) => (
              <tr key={line.itemId}>
                <td className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-800">{line.name}</p>
                  {(line.itemCode || line.serialNumber) && (
                    <p className="truncate text-xs text-slate-400">
                      {line.itemCode}
                      {line.serialNumber ? ` · SN: ${line.serialNumber}` : ''}
                    </p>
                  )}
                </td>
                <td className="px-1 py-2 align-top">
                  <input
                    ref={(el) => {
                      qtyRefs.current[line.itemId] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    value={line.quantity || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onChangeLine(line.itemId, 'quantity', e.target.value.replace(/\D/g, ''))}
                    className={`${CELL_INPUT} text-center`}
                  />
                </td>
                <td className="px-1 py-2 align-top">
                  <input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => onChangeLine(line.itemId, 'unitPrice', e.target.value)} className={`${CELL_INPUT} text-right`} />
                </td>
                <td className="px-1 py-2 align-top">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.discount}
                    placeholder="0.00"
                    onChange={(e) => onChangeLine(line.itemId, 'discount', e.target.value)}
                    className={`${CELL_INPUT} text-right`}
                  />
                </td>
                <td className="px-3 py-2 text-right align-top text-sm font-semibold tabular-nums text-slate-900">
                  <span className="inline-block pt-1.5">{formatCurrency(lineTotal(line))}</span>
                </td>
                <td className="px-1 py-2 text-center align-top">
                  <RemoveButton onClick={() => onRemoveLine(line.itemId)} />
                </td>
              </tr>
            ))}
            {blanks.map((id) => (
              <tr key={`blank-${id}`}>
                <td className="px-2 py-1.5">
                  <ItemSearchCell
                    onSelect={handleSelect(id)}
                    inputRef={(el) => {
                      blankRefs.current[id] = el;
                    }}
                  />
                </td>
                <td className="px-2 py-1.5 text-center text-sm text-slate-300">—</td>
                <td className="px-2 py-1.5 text-right text-sm text-slate-300">—</td>
                <td className="px-2 py-1.5 text-right text-sm text-slate-300">—</td>
                <td className="px-3 py-1.5 text-right text-sm text-slate-300">{formatCurrency(0)}</td>
                <td className="px-1 py-1.5 text-center">
                  <RemoveButton disabled={blanks.length <= 1} onClick={() => removeBlank(id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" onClick={addBlankRow} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </button>
          <p className="px-2 text-xs text-slate-400">Quotation quantities do not reserve stock.</p>
        </div>
        <div className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-slate-500">
            <span>Additional discount</span>
            <input type="number" min="0" step="0.01" value={discount} placeholder="0.00" onChange={(e) => onDiscountChange(e.target.value)} className={`${CELL_INPUT} w-28! text-right`} />
          </div>
          {totalDiscount > 0 && (
            <div className="flex justify-between text-brand-600">
              <span>Total discount</span>
              <span className="tabular-nums">−{formatCurrency(totalDiscount)}</span>
            </div>
          )}
          <div className="border-t border-slate-200 pt-1.5 text-right">
            <p className="text-xs uppercase text-slate-400">Grand Total</p>
            <p className="text-lg font-bold tabular-nums text-slate-900">{formatCurrency(Math.max(0, subtotal - totalDiscount))}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
