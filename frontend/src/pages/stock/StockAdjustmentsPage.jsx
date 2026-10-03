import { useCallback, useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, ClipboardCheck, Plus, Search, SlidersHorizontal, Scale, PackageMinus, PackagePlus, X } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

export const REASONS = {
  DAMAGED: { label: 'Damaged', color: 'red' },
  EXPIRED: { label: 'Expired', color: 'amber' },
  LOST: { label: 'Lost', color: 'red' },
  THEFT: { label: 'Theft', color: 'red' },
  COUNT_CORRECTION: { label: 'Count correction', color: 'blue' },
  FOUND: { label: 'Found', color: 'green' },
  OTHER: { label: 'Other', color: 'slate' },
};
const DECREASE_REASONS = ['DAMAGED', 'EXPIRED', 'LOST', 'THEFT', 'COUNT_CORRECTION', 'OTHER'];
const INCREASE_REASONS = ['COUNT_CORRECTION', 'FOUND', 'OTHER'];

// Stock Adjustment: manual corrections of on-hand stock outside purchases
// and sales -- damaged/expired/lost goods written off, or a physical count
// difference. Every adjustment is permanent; a mistake is fixed with an
// opposite adjustment.
export default function StockAdjustmentsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canAdjust = user?.role === 'admin' || user?.role === 'manager';
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [reason, setReason] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/stock-adjustments', { params: { q: q || undefined, direction: direction || undefined, reason: reason || undefined, from: from || undefined, to: to || undefined, page } })
      .then((res) => {
        setRows(res.data.data);
        setSummary(res.data.summary);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load stock adjustments.'))
      .finally(() => setLoading(false));
  }, [q, direction, reason, from, to, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  if (loading && !summary) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <SlidersHorizontal className="h-5 w-5 text-indigo-600" /> Stock Adjustment
          </h1>
          <p className="mt-1 text-sm text-slate-500">Correct stock for damaged, expired or lost goods, or after a physical count.</p>
        </div>
        {canAdjust && (
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> New Adjustment
          </Button>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard icon={PackageMinus} tone="rose" label="Stock written off" value={formatCurrency(summary.decreaseValue)} hint={`${summary.decreaseCount} adjustment(s)`} />
          <SummaryCard icon={PackagePlus} tone="emerald" label="Stock added back" value={formatCurrency(summary.increaseValue)} hint={`${summary.increaseCount} adjustment(s)`} />
          <SummaryCard
            icon={Scale}
            tone={summary.netLoss > 0 ? 'amber' : 'indigo'}
            label="Net loss (at cost)"
            value={formatCurrency(summary.netLoss)}
            hint="shown in Profit & Loss under Cost of Goods Sold"
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
        <FormField label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Item or ADJ number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </FormField>
        <FormField label="Type">
          <Select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="DECREASE">Decrease</option>
            <option value="INCREASE">Increase</option>
          </Select>
        </FormField>
        <FormField label="Reason">
          <Select value={reason} onChange={(e) => { setReason(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {Object.entries(REASONS).map(([key, r]) => (
              <option key={key} value={key}>{r.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="From">
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </FormField>
        <FormField label="To">
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </FormField>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
              <ClipboardCheck className="h-6 w-6" />
            </div>
            <p className="text-sm text-slate-400">No stock adjustments yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 font-medium">Adjustment</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 text-right font-medium">Change</th>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Batches</th>
                  <th className="px-4 py-3 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => {
                  const down = a.direction === 'DECREASE';
                  return (
                    <tr key={a.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{a.adjustmentNumber}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{a.itemName}</p>
                        <p className="text-xs text-slate-400">{a.itemCode}</p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${down ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {down ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
                          {down ? '−' : '+'}
                          {a.quantity} {a.unit}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">
                        {a.quantityBefore} → <span className="font-semibold text-slate-800">{a.quantityAfter}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={REASONS[a.reason]?.color || 'slate'}>{REASONS[a.reason]?.label || a.reason}</Badge>
                        {a.note && <p className="mt-1 max-w-[220px] text-xs text-slate-500">{a.note}</p>}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${down ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {down ? '−' : '+'}
                        {formatCurrency(a.value)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {a.lots.map((l) => (
                          <p key={String(l.lot)}>
                            {l.stockSerial || 'Batch'}
                            {l.expiryDate ? ` · exp ${formatDate(l.expiryDate)}` : ''} ({l.quantity > 0 ? '+' : ''}{l.quantity})
                          </p>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{a.createdByName || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Pagination {...pagination} onChange={setPage} />

      <NewAdjustmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(adj) => {
          toast.success(`${adj.adjustmentNumber} saved — ${adj.itemName} is now ${adj.quantityAfter} ${adj.unit}.`);
          setModalOpen(false);
          setPage(1);
          load();
        }}
      />
    </div>
  );
}

function NewAdjustmentModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [info, setInfo] = useState(null); // { item, lots, untrackedQuantity }
  const [mode, setMode] = useState('DECREASE'); // DECREASE | INCREASE | COUNT
  const [quantity, setQuantity] = useState('');
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('DAMAGED');
  const [lotId, setLotId] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setMatches([]);
      setInfo(null);
      setMode('DECREASE');
      setQuantity('');
      setCounted('');
      setReason('DAMAGED');
      setLotId('');
      setExpiryDate('');
      setNote('');
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim() || info) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      client
        .get('/inventory/search', { params: { q: query.trim() } })
        .then((r) => alive && setMatches(r.data.data))
        .catch(() => alive && setMatches([]));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, info]);

  const pick = (item) => {
    setMatches([]);
    setQuery(item.name);
    client
      .get(`/stock-adjustments/item/${item.id}`)
      .then((r) => setInfo(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load this item.'));
  };

  const item = info?.item;
  const free = item ? item.quantity - item.reservedQuantity : 0;

  // A physical count becomes a decrease or increase of the difference.
  const countDiff = mode === 'COUNT' && counted !== '' && item ? Number(counted) - item.quantity : null;
  const direction = mode === 'COUNT' ? (countDiff < 0 ? 'DECREASE' : 'INCREASE') : mode;
  const qty = mode === 'COUNT' ? Math.abs(countDiff ?? 0) : Number(quantity) || 0;
  const effectiveReason = mode === 'COUNT' ? 'COUNT_CORRECTION' : reason;
  const after = item ? item.quantity + (direction === 'DECREASE' ? -qty : qty) : 0;
  const value = item ? qty * item.unitCost : 0;
  const reasons = direction === 'DECREASE' ? DECREASE_REASONS : INCREASE_REASONS;

  let problem = '';
  if (item) {
    if (mode === 'COUNT' && counted !== '' && (!Number.isInteger(Number(counted)) || Number(counted) < 0)) problem = 'Enter the counted quantity as a whole number.';
    else if (mode === 'COUNT' && countDiff === 0) problem = 'The count matches the system — nothing to adjust.';
    else if (qty > 0 && direction === 'DECREASE' && qty > free) problem = `Only ${free} ${item.unit} can be adjusted${item.reservedQuantity ? ` (${item.reservedQuantity} are held by pending invoices)` : ''}.`;
    else if (effectiveReason === 'OTHER' && !note.trim()) problem = 'Write a note explaining the adjustment.';
  }
  const canSave = item && qty > 0 && Number.isInteger(qty) && !problem && !saving;

  const save = async () => {
    setSaving(true);
    try {
      const res = await client.post('/stock-adjustments', {
        itemId: item.id,
        direction,
        quantity: qty,
        reason: effectiveReason,
        note,
        lotId: direction === 'DECREASE' && lotId ? lotId : undefined,
        expiryDate: direction === 'INCREASE' && expiryDate ? expiryDate : undefined,
      });
      onSaved(res.data.data);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the adjustment.');
    } finally {
      setSaving(false);
    }
  };

  const modes = [
    { key: 'DECREASE', label: 'Decrease', icon: PackageMinus, hint: 'Damaged, expired, lost' },
    { key: 'INCREASE', label: 'Increase', icon: PackagePlus, hint: 'Found extra stock' },
    { key: 'COUNT', label: 'Physical count', icon: ClipboardCheck, hint: 'Enter what you counted' },
  ];

  return (
    <Modal
      open={open}
      onClose={() => (saving ? null : onClose())}
      title="New Stock Adjustment"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave} loading={saving}>
            Save Adjustment
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Item */}
        <FormField label="Item" required>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9 pr-9"
              placeholder="Search item by name or code"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setInfo(null);
                setLotId('');
              }}
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setInfo(null); setMatches([]); setLotId(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                aria-label="Clear item"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {matches.length > 0 && !info && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => pick(m)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-indigo-50">
                      <span>
                        <span className="font-medium text-slate-800">{m.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{m.itemCode}</span>
                      </span>
                      <span className="text-xs text-slate-500">{m.quantity} {m.unit}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FormField>

        {item && (
          <>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">In stock</p>
                <p className="text-base font-bold text-slate-800">{item.quantity} {item.unit}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Held by pending invoices</p>
                <p className="text-base font-bold text-slate-800">{item.reservedQuantity}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Average cost</p>
                <p className="text-base font-bold text-slate-800">{formatCurrency(item.unitCost)}</p>
              </div>
            </div>

            {/* Mode */}
            <div className="grid grid-cols-3 gap-2">
              {modes.map(({ key, label, icon: Icon, hint }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setMode(key);
                    setReason(key === 'INCREASE' ? 'FOUND' : 'DAMAGED');
                    setLotId('');
                  }}
                  className={`rounded-xl border p-3 text-left transition ${
                    mode === key ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <p className={`flex items-center gap-1.5 text-sm font-semibold ${mode === key ? 'text-indigo-700' : 'text-slate-700'}`}>
                    <Icon className="h-4 w-4" /> {label}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mode === 'COUNT' ? (
                <FormField label={`Counted quantity (${item.unit})`} required>
                  <Input type="number" min="0" step="1" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="What is on the shelf" />
                </FormField>
              ) : (
                <FormField label={`Quantity to ${mode === 'DECREASE' ? 'remove' : 'add'} (${item.unit})`} required>
                  <Input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </FormField>
              )}
              {mode === 'COUNT' ? (
                <FormField label="Reason">
                  <Input value="Count correction" disabled />
                </FormField>
              ) : (
                <FormField label="Reason" required>
                  <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                    {reasons.map((r) => (
                      <option key={r} value={r}>{REASONS[r].label}</option>
                    ))}
                  </Select>
                </FormField>
              )}
            </div>

            {direction === 'DECREASE' && info.lots.length > 0 && (
              <FormField label="Take from batch">
                <Select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  <option value="">Automatic — nearest expiry first</option>
                  {info.lots.map((l) => (
                    <option key={l.id} value={l.id} disabled={l.remaining - l.reserved <= 0}>
                      {l.stockSerial || 'Batch'} · {l.remaining - l.reserved} available
                      {l.expiryDate ? ` · exp ${formatDate(l.expiryDate)}` : ''}
                      {l.expired ? ' (EXPIRED)' : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}

            {direction === 'INCREASE' && (
              <FormField label="Expiry date (optional)">
                <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </FormField>
            )}

            <FormField label={effectiveReason === 'OTHER' ? 'Note' : 'Note (optional)'} required={effectiveReason === 'OTHER'}>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Box crushed during delivery" />
            </FormField>

            {qty > 0 && !problem && (
              <div className={`rounded-xl p-3 text-sm ${direction === 'DECREASE' ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
                Stock will go from <strong>{item.quantity}</strong> to <strong>{after} {item.unit}</strong> —{' '}
                {direction === 'DECREASE' ? `${formatCurrency(value)} written off` : `${formatCurrency(value)} added back`} at average cost.
              </div>
            )}
            {problem && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{problem}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

const TONES = {
  rose: 'from-rose-500 to-pink-500',
  emerald: 'from-emerald-500 to-teal-500',
  amber: 'from-amber-400 to-orange-500',
  indigo: 'from-indigo-500 to-violet-500',
};

function SummaryCard({ icon: Icon, tone, label, value, hint }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${TONES[tone]} text-white shadow-md`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="text-2xl font-bold leading-tight tabular-nums text-slate-900">{value}</p>
        <p className="truncate text-xs text-slate-400">{hint}</p>
      </div>
    </div>
  );
}
