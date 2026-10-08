import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Textarea } from '../../components/ui/Field.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

const DECREASE = [
  ['COUNT_CORRECTION', 'Count correction'],
  ['DAMAGED', 'Damaged'],
  ['EXPIRED', 'Expired'],
  ['LOST', 'Lost'],
  ['THEFT', 'Theft'],
  ['OTHER', 'Other'],
];
const INCREASE = [
  ['COUNT_CORRECTION', 'Count correction'],
  ['FOUND', 'Found'],
  ['OTHER', 'Other'],
];

// Count the whole stock at once: every item is listed with its system
// quantity; type what is actually on the shelf for any of them. Items left
// empty (or matching the system) are skipped. Saved all-or-nothing as one
// stock count (BADJ number) -- see POST /stock-adjustments/count.
export default function StockCountModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState({}); // id -> { counted, reason }
  const [query, setQuery] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setCounts({});
    setQuery('');
    setOnlyChanged(false);
    setNote('');
    client
      .get('/stock-adjustments/count-sheet')
      .then((r) => setItems(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the item list.'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!items) return [];
    return items.map((item) => {
      const entry = counts[item.id] || {};
      const raw = entry.counted ?? '';
      const counted = raw === '' ? null : Number(raw);
      const valid = counted === null || (Number.isInteger(counted) && counted >= 0);
      const diff = counted === null || !valid ? 0 : counted - item.quantity;
      let error = '';
      if (!valid) error = 'Whole number, 0 or more';
      else if (counted !== null && counted < item.reservedQuantity) error = `Below the ${item.reservedQuantity} held by pending invoices`;
      return { ...item, raw, counted, diff, error, reason: entry.reason || 'COUNT_CORRECTION' };
    });
  }, [items, counts]);

  const changed = rows.filter((r) => r.diff !== 0 && !r.error);
  const errors = rows.filter((r) => r.error);
  const writtenOff = changed.filter((r) => r.diff < 0).reduce((s, r) => s + -r.diff * r.unitCost, 0);
  const added = changed.filter((r) => r.diff > 0).reduce((s, r) => s + r.diff * r.unitCost, 0);
  const needsNote = changed.some((r) => r.reason === 'OTHER') && !note.trim();

  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (!q || r.name.toLowerCase().includes(q) || (r.itemCode || '').toLowerCase().includes(q)) && (!onlyChanged || r.diff !== 0 || r.error));

  const setRow = (id, patch) => setCounts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await client.post('/stock-adjustments/count', {
        note,
        rows: changed.map((r) => ({ itemId: r.id, countedQuantity: r.counted, reason: r.reason })),
      });
      toast.success(`${res.data.data.countNumber} saved — ${res.data.data.adjusted} item(s) adjusted.`);
      onSaved();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the stock count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => (saving ? null : onClose())}
      title="Stock Count — all items"
      size="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            <strong className="text-slate-900">{changed.length}</strong> item(s) will change
            {changed.length > 0 && (
              <>
                {' · '}
                <span className="text-rose-600">{formatCurrency(writtenOff)} written off</span>
                {' · '}
                <span className="text-emerald-600">{formatCurrency(added)} added</span>
              </>
            )}
            {errors.length > 0 && <span className="ml-2 font-semibold text-rose-600">{errors.length} row(s) to fix</span>}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={changed.length === 0 || errors.length > 0 || needsNote}>
              Save Count
            </Button>
          </div>
        </div>
      }
    >
      {!items ? (
        <PageSpinner />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Type the quantity actually on the shelf. Leave an item empty to skip it. Everything is saved together — if one row has a problem, nothing changes.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" placeholder={`Search ${items.length} items by name or code`} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
              Show only changed
            </label>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5 text-right">In stock</th>
                  <th className="px-3 py-2.5 text-right">Held</th>
                  <th className="w-32 px-3 py-2.5">Counted</th>
                  <th className="px-3 py-2.5 text-right">Difference</th>
                  <th className="w-44 px-3 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      {onlyChanged ? 'No changes yet.' : 'No items match.'}
                    </td>
                  </tr>
                )}
                {visible.map((r) => (
                  <tr key={r.id} className={r.error ? 'bg-rose-50/60' : r.diff !== 0 ? 'bg-slate-50/70' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{r.name}</p>
                      <p className="text-xs text-slate-400">{r.itemCode}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.quantity} <span className="text-xs text-slate-400">{r.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">{r.reservedQuantity || '—'}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={r.raw}
                        onChange={(e) => setRow(r.id, { counted: e.target.value })}
                        placeholder={String(r.quantity)}
                        className={`no-spinner w-full rounded-lg border px-2.5 py-1.5 text-right text-sm tabular-nums outline-none focus:ring-2 ${
                          r.error ? 'border-rose-300 focus:ring-rose-100' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-100'
                        }`}
                        aria-label={`Counted quantity for ${r.name}`}
                      />
                      {r.error && <p className="mt-0.5 text-[11px] text-rose-600">{r.error}</p>}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.diff < 0 ? 'text-rose-600' : r.diff > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                      {r.diff > 0 ? '+' : ''}
                      {r.diff !== 0 ? r.diff : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.diff !== 0 && !r.error ? (
                        <select
                          value={r.reason}
                          onChange={(e) => setRow(r.id, { reason: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                          aria-label={`Reason for ${r.name}`}
                        >
                          {(r.diff < 0 ? DECREASE : INCREASE).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">Note {needsNote ? <span className="text-rose-500">*</span> : '(optional)'}</p>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Month-end stock count" />
            {needsNote && <p className="mt-1 text-xs text-rose-600">A note is required when a reason is "Other".</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
