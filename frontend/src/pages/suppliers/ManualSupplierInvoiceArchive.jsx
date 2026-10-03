import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Plus, Search, Save, FileText, Building2 } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import SupplierPicker from '../purchases/SupplierPicker.jsx';

const emptyRow = () => ({ itemName: '', quantity: '', cost: '' });

// A manually-entered archive of a supplier's paper invoice, saved exactly as
// typed. This NEVER touches Stock or Inventory -- see
// supplierInvoiceArchiveController.createArchive on the backend. Default
// view is a searchable file browser of every archived invoice; the entry
// form only appears inside the "+ Manual Entry Invoice" modal.
export default function ManualSupplierInvoiceArchive() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 250);
  const [archives, setArchives] = useState(null); // null = loading
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [entryOpen, setEntryOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/supplier-invoice-archives', { params: { q: debouncedQuery, limit: 50 } })
      .then((res) => setArchives(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load supplier invoice archives.'))
      .finally(() => setLoading(false));
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Shop/Supplier Serial Number, Supplier name..."
          />
        </div>
        <Button onClick={() => setEntryOpen(true)}>
          <Plus className="h-4 w-4" /> Manual Entry Invoice
        </Button>
      </div>

      {loading && archives === null ? (
        <PageSpinner />
      ) : archives.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-14 text-center text-sm text-slate-400">
          {query ? 'Wax natiijo ah lama helin.' : 'No supplier invoice archives yet. Click "+ Manual Entry Invoice" to add one.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {archives.map((a) => (
            <button
              key={a.id}
              onClick={() => setViewing(a)}
              className="group flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <div className="flex w-full items-center gap-2">
                <FileText className="h-8 w-8 shrink-0 text-indigo-400 group-hover:text-indigo-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">Serial: {a.serialNumber}</p>
                  <p className="truncate text-xs text-slate-400">{a.archiveNumber}</p>
                </div>
              </div>
              <div className="mt-1 flex w-full items-center gap-1.5 text-xs text-slate-500">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{a.supplierName || '(no supplier)'}</span>
              </div>
              <p className="text-xs text-slate-400">{formatDate(a.createdAt)}</p>
              <p className="mt-1 text-base font-bold tabular-nums text-slate-900">{formatCurrency(a.grandTotal)}</p>
            </button>
          ))}
        </div>
      )}

      <ArchiveDetailModal archive={viewing} onClose={() => setViewing(null)} />
      <ManualEntryModal
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        onSaved={() => {
          setEntryOpen(false);
          load();
        }}
      />
    </div>
  );
}

function ArchiveDetailModal({ archive, onClose }) {
  if (!archive) return null;
  return (
    <Modal open={!!archive} onClose={onClose} title={`Serial: ${archive.serialNumber}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label="Archive No." value={archive.archiveNumber} />
          <Field label="Supplier" value={archive.supplierName || '(none)'} />
          <Field label="Date" value={formatDateTime(archive.createdAt)} />
          <Field label="Grand Total" value={formatCurrency(archive.grandTotal)} />
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Item Name</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Qty</th>
                <th className="px-2 py-2 text-right text-xs font-medium uppercase text-slate-500">Cost</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase text-slate-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {archive.rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 text-slate-700">{r.itemName}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums text-slate-600">{r.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatCurrency(r.cost)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-900">{formatCurrency(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {archive.notes && (
          <div>
            <p className="text-xs font-medium uppercase text-slate-400">Notes</p>
            <p className="text-sm text-slate-600">{archive.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function ManualEntryModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const nameRefs = useRef({});

  useEffect(() => {
    if (open) {
      setSupplier(null);
      setSerialNumber('');
      setNotes('');
      setRows([emptyRow()]);
    }
  }, [open]);

  const grandTotal = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.cost) || 0), 0), [rows]);

  const setRow = (index, key, value) => setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const addRow = (focus = true) => {
    setRows((prev) => [...prev, emptyRow()]);
    if (focus) setTimeout(() => nameRefs.current[rows.length]?.focus(), 0);
  };

  const removeRow = (index) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const handleLastCellKeyDown = (index, e) => {
    const isLastRow = index === rows.length - 1;
    if (isLastRow && e.key === 'Tab' && !e.shiftKey && rows[index].itemName.trim()) {
      e.preventDefault();
      addRow();
    }
  };

  const handleSave = async () => {
    if (!serialNumber.trim()) return toast.error('Enter the Shop/Supplier Serial Number.');
    const validRows = rows.filter((r) => r.itemName.trim());
    if (!validRows.length) return toast.error('Add at least one row.');
    for (const r of validRows) {
      if (!Number(r.quantity) || Number(r.quantity) <= 0) return toast.error(`Enter a valid quantity for "${r.itemName}".`);
      if (r.cost === '' || Number(r.cost) < 0) return toast.error(`Enter a valid cost for "${r.itemName}".`);
    }
    setSaving(true);
    try {
      const res = await client.post('/supplier-invoice-archives', {
        serialNumber: serialNumber.trim(),
        supplierId: supplier?.id || null,
        rows: validRows.map((r) => ({ itemName: r.itemName.trim(), quantity: Number(r.quantity), cost: Number(r.cost) })),
        notes,
      });
      toast.success(`Supplier invoice archive ${res.data.data.archiveNumber} saved.`);
      onSaved();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this archive.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manual Entry Invoice"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            <Save className="h-4 w-4" /> Save Archive
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Enter exactly what the supplier's paper invoice shows -- this never changes Stock or Inventory.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Supplier (optional)">
            <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
          </FormField>
          <FormField label="Shop/Supplier Serial Number" required>
            <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. 585858" />
          </FormField>
        </div>

        <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <colgroup>
              <col className="w-[50%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
              <col className="w-[5%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Item Name</th>
                <th className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500">Qty</th>
                <th className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Cost</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5">
                    <input
                      ref={(el) => { nameRefs.current[i] = el; }}
                      value={row.itemName}
                      onChange={(e) => setRow(i, 'itemName', e.target.value)}
                      placeholder="Item name..."
                      className="w-full rounded-md border border-transparent px-2 py-1.5 text-sm outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.quantity}
                      onChange={(e) => setRow(i, 'quantity', e.target.value)}
                      className="no-spinner w-full rounded-md border border-slate-200 px-2 py-1.5 text-center text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-1 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.cost}
                      onChange={(e) => setRow(i, 'cost', e.target.value)}
                      onKeyDown={(e) => handleLastCellKeyDown(i, e)}
                      className="no-spinner w-full rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatCurrency((Number(row.quantity) || 0) * (Number(row.cost) || 0))}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <button type="button" tabIndex={-1} onClick={() => removeRow(i)} className="rounded-md p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between">
          <button type="button" onClick={() => addRow()} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </button>
          <div className="text-right">
            <p className="text-xs uppercase text-slate-400">Grand Total</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(grandTotal)}</p>
          </div>
        </div>

        <FormField label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional" />
        </FormField>
      </div>
    </Modal>
  );
}
