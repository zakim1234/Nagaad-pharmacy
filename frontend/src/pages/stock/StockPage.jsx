import { Fragment, useEffect, useRef, useState } from 'react';

import { Link, useSearchParams } from 'react-router-dom';

import client from '../../api/client.js';

import Button from '../../components/ui/Button.jsx';

import { useToast } from '../../context/ToastContext.jsx';

import { BUSINESS } from '../../constants/business.js';

import logo from '../../images/logo.png';

import { printPage } from '../../utils/print.js';

import { formatCurrency, formatDateTime } from '../../utils/format.js';

import { previewWeightedAverageCost } from '../../utils/wac.js';

const blank = () => ({ key: crypto.randomUUID(), name: '', itemId: '', quantity: '', costPrice: '', sellingPrice: '', expiryDate: '' });

function SupplierInput({ supplierId, supplierName, onChange }) {

  const [query, setQuery] = useState(supplierName || '');

  const [matches, setMatches] = useState([]);

  const [active, setActive] = useState(false);

  useEffect(() => { setQuery(supplierName || ''); }, [supplierName]);

  useEffect(() => {

    let alive = true;

    const timer = setTimeout(() => { if (query && query !== supplierName) client.get('/suppliers/search', { params: { q: query } }).then(r => { if (alive) setMatches(r.data.data); }).catch(() => { if (alive) setMatches([]); }); }, 180);

    return () => { alive = false; clearTimeout(timer); };

  }, [query, supplierName]);

  const choose = s => { onChange(s.id, s.name); setQuery(s.name); setActive(false); };

  return <div className="relative max-w-sm">

    <label className="mb-1 block text-sm font-medium text-slate-700">Supplier (optional)</label>

    <input className="w-full rounded border p-2" placeholder="Search supplier..." value={query} onFocus={() => setActive(true)} onBlur={() => setActive(false)} onChange={e => { setQuery(e.target.value); if (supplierId) onChange('', ''); }} />

    {active && query && query !== supplierName && <div className="absolute z-20 max-h-56 w-full overflow-auto rounded border bg-white shadow-lg">{matches.map(s => <button type="button" key={s.id} className="block w-full p-2 text-left hover:bg-indigo-50" onMouseDown={e => { e.preventDefault(); choose(s); }}>{s.name}{s.phone ? <small className="block text-slate-500">{s.phone}</small> : null}</button>)}{!matches.length && <p className="p-2 text-sm text-slate-400">No matching suppliers</p>}</div>}

    <p className="mt-1 text-xs text-slate-500">Links this stock entry to a supplier so a Supplier Invoice can be generated from it.</p>

  </div>;

}

function ItemInput({ row, update, inputRef }) {

  const [matches, setMatches] = useState([]);

  const [active, setActive] = useState(false);

  useEffect(() => {

    let alive = true;

    const timer = setTimeout(() => { if (row.name && !row.itemId) client.get('/inventory/search', { params: { q: row.name } }).then(r => { if (alive) setMatches(r.data.data); }).catch(() => { if (alive) setMatches([]); }); }, 180);

    return () => { alive = false; clearTimeout(timer); };

  }, [row.name, row.itemId]);

  const choose = item => { update({ itemId: item.id, name: item.name, costPrice: item.costPrice, sellingPrice: item.sellingPrice, currentQuantity: item.quantity, currentAvgCost: item.costPrice }); setActive(false); };

  return <div className="relative min-w-60"><input ref={inputRef} className="w-full rounded border p-2" aria-label="Item name" placeholder="Search item..." value={row.name} onFocus={() => setActive(true)} onBlur={() => setActive(false)} onChange={e => { update({ name: e.target.value, itemId: '' }); setActive(true); }} onKeyDown={e => { if (e.key === 'Enter' && active && matches.length) { e.preventDefault(); choose(matches[0]); } }} />

    {active && row.name && !row.itemId && <div className="absolute z-20 max-h-56 w-full overflow-auto rounded border bg-white shadow-lg">{matches.map(item => <button type="button" key={item.id} className="block w-full p-2 text-left hover:bg-indigo-50" onMouseDown={e => { e.preventDefault(); choose(item); }}>{item.name}<small className="block text-slate-500">{item.itemCode} · {item.availableQuantity} available</small></button>)}<button type="button" className="w-full p-2 text-left text-indigo-700" onMouseDown={e => { e.preventDefault(); setActive(false); }}>+ Create “{row.name}” on save</button></div>}

  </div>;

}

export default function StockPage() {

  const toast = useToast();
  const [params] = useSearchParams();

  const [rows, setRows] = useState([blank()]);

  const [externalSerialNumber, setExternalSerialNumber] = useState('');

  const [supplierId, setSupplierId] = useState('');

  const [supplierName, setSupplierName] = useState('');

  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState(params.get('q') || '');

  const [entries, setEntries] = useState([]);

  const [selected, setSelected] = useState(null);

  const [page, setPage] = useState(1);

  const [total, setTotal] = useState(0);

  const refs = useRef({});

  const load = () => client.get('/stock', { params: { q: query, page } }).then(r => { setEntries(r.data.data); setTotal(r.data.total); if (query) { const exact = r.data.data.find(e => e.stockSerial === query || e.externalSerialNumber === query); if (exact) setSelected(exact); } }).catch(e => toast.error(e.friendlyMessage || 'Could not load stock.'));

  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer); }, [query, page]);

  const update = (key, changes) => setRows(previous => previous.map(r => r.key === key ? { ...r, ...changes } : r));

  const add = () => { const row = blank(); setRows(previous => [...previous, row]); setTimeout(() => refs.current[row.key]?.focus(), 0); };

  async function save() {

    const used = rows.filter(r => r.name || r.quantity || r.costPrice !== '' || r.sellingPrice !== '' || r.expiryDate);

    if (!used.length) return toast.error('Enter at least one stock row.');

    setSaving(true);

    try { const result = await client.post('/stock', { rows: used, externalSerialNumber, supplierId: supplierId || undefined }); setSelected(result.data.data); setRows([blank()]); setExternalSerialNumber(''); setSupplierId(''); setSupplierName(''); await load(); toast.success('Stock entry created.'); }

    catch (e) { toast.error(e.friendlyMessage || 'Could not create stock.'); } finally { setSaving(false); }

  }

  return <div className="space-y-5">

    <section className="no-print space-y-4"><h1 className="text-2xl font-semibold">Stock</h1><p className="text-slate-500">Add incoming products to inventory</p>

      <div className="flex flex-wrap gap-4">
        <div className="max-w-sm"><label className="mb-1 block text-sm font-medium text-slate-700">Shop / Supplier Serial Number</label><input aria-label="Shop / Supplier Serial Number" className="w-full rounded border p-2" placeholder="e.g. ABC-INV-93822 (the shop's own invoice/serial)" value={externalSerialNumber} onChange={e => setExternalSerialNumber(e.target.value)} /><p className="mt-1 text-xs text-slate-500">The supplier's own receipt/invoice number. Separate from our internal Stock Serial, which is generated on save.</p></div>
        <SupplierInput supplierId={supplierId} supplierName={supplierName} onChange={(id, name) => { setSupplierId(id); setSupplierName(name); }} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white pb-24"><table className="w-full text-sm"><thead><tr>{['Item', 'Qty', 'Cost', 'Selling', 'Expiry', ''].map((h, i) => <th key={i} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{rows.map((row, index) => { const preview = row.itemId && row.quantity && row.costPrice !== '' ? previewWeightedAverageCost({ currentQuantity: row.currentQuantity, currentAverageCost: row.currentAvgCost, incomingQuantity: row.quantity, incomingUnitCost: row.costPrice }) : null; return <Fragment key={row.key}><tr><td className="p-2"><ItemInput row={row} update={changes => update(row.key, changes)} inputRef={el => { refs.current[row.key] = el; }} /></td>{['quantity', 'costPrice', 'sellingPrice', 'expiryDate'].map(field => <td key={field} className="p-2"><input aria-label={`Row ${index + 1} ${field}`} type={field === 'expiryDate' ? 'date' : 'number'} min={field === 'quantity' ? 1 : 0} step={field === 'quantity' ? 1 : '0.01'} className="w-full min-w-24 rounded border p-2" value={row[field]} onChange={e => update(row.key, { [field]: e.target.value })} onKeyDown={e => { if (field === 'expiryDate' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); if (index === rows.length - 1) add(); else refs.current[rows[index + 1].key]?.focus(); } }} /></td>)}<td><button aria-label={`Remove row ${index + 1}`} onClick={() => setRows(previous => previous.length === 1 ? [blank()] : previous.filter(r => r.key !== row.key))}>×</button></td></tr>{preview && <tr className="bg-indigo-50/60"><td colSpan={6} className="px-2 pb-2 text-xs text-indigo-700">Average Cost-ka {row.name} wuxuu ka beddelmayaa {formatCurrency(preview.currentAverageCost)} una gudbayaa <strong>{formatCurrency(preview.projectedAverageCost)}</strong> (Qty: {preview.currentQuantity} → {preview.projectedQuantity}). Informational only -- confirmed on save.</td></tr>}</Fragment>; })}</tbody></table></div>

      <p className="text-xs text-slate-500">Press Tab after Expiry to continue to the next row. Stock Serial: automatically generated on save.</p><div className="flex gap-3"><Button variant="secondary" onClick={add}>+ Add Row</Button><Button onClick={save} loading={saving}>Create Stock</Button></div>

      <h2 className="text-lg font-semibold">Stock history</h2><input aria-label="Search stock" className="w-full rounded border p-2" placeholder="Search product name, stock serial, or shop/supplier serial" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />

      <div className="divide-y rounded border bg-white">{entries.map(entry => <button key={entry._id} onClick={() => setSelected(entry)} className="block w-full p-3 text-left hover:bg-indigo-50"><strong>{entry.stockSerial}</strong>{entry.externalSerialNumber && <span className="ml-2 text-slate-500">· Shop Serial: {entry.externalSerialNumber}</span>} · {formatDateTime(entry.createdAt)}<span className="block text-sm text-slate-500">{entry.rows.map(r => `${r.itemName} (${r.quantity} received, ${r.batch?.remainingQuantity ?? r.quantity} remaining)`).join(' · ')}</span></button>)}{!entries.length && <p className="p-3">No stock entries found.</p>}</div><div className="flex gap-3"><Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} · {total} entries</span><Button disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button></div>

    </section>

    {selected && <><div className="no-print"><Button onClick={() => printPage('A4')}>Print Stock Entry</Button></div><section id="print-area" className="rounded border bg-white p-6"><header className="text-center"><img src={logo} alt={BUSINESS.name} className="mx-auto h-16" /><h2>{BUSINESS.name}</h2><p>{BUSINESS.addressLine}</p><p>{BUSINESS.phone}</p></header><h2 className="my-4 text-xl font-semibold">Stock Entry {selected.stockSerial}</h2>{selected.externalSerialNumber && <p>Shop/Supplier Serial: <strong>{selected.externalSerialNumber}</strong></p>}{selected.supplier && <p>Supplier: <strong>{selected.supplier.name}</strong></p>}<p>{formatDateTime(selected.createdAt)}</p><table className="my-4 w-full text-sm"><thead><tr>{['No', 'Item', 'Qty', 'Cost', 'Selling', 'Expiry'].map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{selected.rows.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{i + 1}</td><td><Link to={`/inventory/${r.item}/print`}>{r.itemName}</Link></td><td>{r.quantity}</td><td>{formatCurrency(r.costPriceCents / 100)}</td><td>{formatCurrency(r.sellingPriceCents / 100)}</td><td>{r.expiryDate?.slice(0, 10) || '—'}</td></tr>)}</tbody></table><p>Total Cost: {formatCurrency(selected.rows.reduce((s, r) => s + r.quantity * r.costPriceCents, 0) / 100)}</p></section></>}

  </div>;

}

