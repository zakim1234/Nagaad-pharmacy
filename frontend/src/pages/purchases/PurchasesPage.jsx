import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Printer, Search, Pencil, Trash2, Sheet, Wallet, FileText } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import BulkPaymentModal from './BulkPaymentModal.jsx';
import PurchaseEditModal from './PurchaseEditModal.jsx';

const ACTION = 'flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50';
const ACTION_DANGER = 'flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50';

const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';

// Purchase invoices, kept together by supplier: the supplier list on the
// left, and on the right only the chosen supplier's invoices (or every
// invoice grouped under its supplier when "All suppliers" is chosen).
export default function PurchasesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const supplierId = searchParams.get('supplier') || '';
  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [voidItem, setVoidItem] = useState(null);
  const [voiding, setVoiding] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadSuppliers = useCallback(() => {
    client
      .get('/purchases/suppliers-summary')
      .then((res) => setSuppliers(res.data.data))
      .catch(() => setSuppliers([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/purchases', {
        params: {
          page,
          limit: 20,
          q: debouncedQ || undefined,
          supplier: supplierId || undefined,
          sort: supplierId ? undefined : 'supplier',
        },
      })
      .then((res) => {
        setItems(res.data.data);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load purchases.'))
      .finally(() => setLoading(false));
  }, [page, debouncedQ, supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setPage(1), [debouncedQ, supplierId]);
  useEffect(() => load(), [load]);
  useEffect(() => loadSuppliers(), [loadSuppliers]);

  const reload = () => {
    load();
    loadSuppliers();
  };

  const pickSupplier = (id) => setSearchParams(id ? { supplier: id } : {});

  const canVoid = user?.role === 'admin' || user?.role === 'manager';
  const bySupplier = useMemo(() => new Map(suppliers.map((s) => [String(s.id), s])), [suppliers]);
  const selected = supplierId ? bySupplier.get(supplierId) : null;
  const allCount = suppliers.reduce((s, x) => s + x.invoiceCount, 0);
  const cols = 4;

  const handleVoid = async () => {
    setVoiding(true);
    try {
      await client.post(`/purchases/${voidItem.id}/void`, { reason: 'Voided by staff' });
      toast.success('Purchase voided and stock reversed.');
      setVoidItem(null);
      reload();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not void this purchase.');
    } finally {
      setVoiding(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.delete(`/purchases/${deleteItem.id}`);
      toast.success(`${deleteItem.purchaseNumber} deleted.`);
      setDeleteItem(null);
      reload();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete this invoice.');
    } finally {
      setDeleting(false);
    }
  };

  const invoiceRow = (p) => (
    <tr key={p.id} className="hover:bg-slate-50">
      <Td>
        <Link to={`/purchases/${p.id}`} className="whitespace-nowrap font-medium text-brand-600 hover:underline">
          {p.purchaseNumber}
        </Link>
        {p.supplierInvoiceNumber && <div className="text-xs text-slate-400">Supplier #{p.supplierInvoiceNumber}</div>}
      </Td>
      <Td className="whitespace-nowrap">
        <span className={p.status === 'voided' ? 'text-slate-400 line-through' : 'font-medium text-slate-900'}>{formatCurrency(p.totalCost)}</span>
        {p.status === 'voided' && (
          <span className="ml-2">
            <Badge color="red">Voided</Badge>
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap">{formatDate(p.createdAt)}</Td>
      <Td>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Link to={`/purchases/${p.id}/receipt`} className={ACTION} title="Print">
            <Printer className="h-3.5 w-3.5" /> Print
          </Link>
          {canVoid && p.status !== 'voided' && (
            <button onClick={() => setEditItem(p)} className={ACTION}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {canVoid && p.status !== 'voided' && (
            <button onClick={() => setVoidItem(p)} className={ACTION} title="Void: reverses the invoice and refunds what was paid">
              <Ban className="h-3.5 w-3.5" /> Void
            </button>
          )}
          {canVoid && (
            <button onClick={() => setDeleteItem(p)} className={ACTION_DANGER}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </Td>
    </tr>
  );

  // In "All suppliers", a header row opens each supplier's group.
  const rows = items.map((p, i) => {
    const sid = String(p.supplier);
    const newGroup = !supplierId && (i === 0 || String(items[i - 1].supplier) !== sid);
    const s = bySupplier.get(sid);
    return (
      <Fragment key={p.id}>
        {newGroup && (
          <tr className="border-t-2 border-slate-200 bg-neutral-50">
            <td colSpan={cols} className="px-4 py-2">
              <button onClick={() => pickSupplier(sid)} className="group flex w-full items-center gap-2.5 text-left">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-bold text-white">{initials(p.supplierName)}</span>
                <span className="font-semibold text-slate-900 group-hover:text-brand-600 group-hover:underline">{p.supplierName}</span>
                {s && (
                  <span className="text-xs text-slate-500">
                    {s.invoiceCount} invoice{s.invoiceCount === 1 ? '' : 's'}
                  </span>
                )}
                {s && (
                  <span className={`ml-auto text-xs font-semibold ${s.owed > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {s.owed > 0 ? `Owed ${formatCurrency(s.owed)}` : 'Paid up'}
                  </span>
                )}
              </button>
            </td>
          </tr>
        )}
        {invoiceRow(p)}
      </Fragment>
    );
  });

  return (
    <div>
      <PageHeader
        title="Purchase Invoices"
        subtitle="Invoices for goods purchased, kept together by supplier"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/purchases/vendor-balances')}>
              <Sheet className="h-4 w-4" /> Vendor Balances
            </Button>
          </div>
        }
      />

      <div>
          {selected && (
            <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 text-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-sm font-bold">{initials(selected.name)}</span>
                  <div>
                    <h2 className="text-lg font-bold">{selected.name}</h2>
                    <p className="text-xs text-neutral-400">
                      {selected.invoiceCount} invoice{selected.invoiceCount === 1 ? '' : 's'}
                      {selected.voidedCount > 0 && ` · ${selected.voidedCount} voided`}
                      {selected.lastPurchaseAt && ` · last ${formatDate(selected.lastPurchaseAt)}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => navigate(`/purchases/suppliers/${selected.id}/statement`)}>
                  <FileText className="h-4 w-4" /> Statement
                </Button>
                {selected.owed > 0 && (
                  <Button onClick={() => setBulkOpen(true)}>
                    <Wallet className="h-4 w-4" /> Pay this supplier
                  </Button>
                )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
                <HeroStat label="Total bought" value={formatCurrency(selected.total)} />
                <HeroStat label="Paid" value={formatCurrency(selected.paid)} />
                <HeroStat label="Still owed" value={formatCurrency(selected.owed)} accent={selected.owed > 0} />
              </div>
            </div>
          )}

          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder={selected ? `Search ${selected.name} invoices...` : 'Search by invoice number or supplier...'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={supplierId} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">All suppliers ({allCount} invoices)</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} — {s.owed > 0 ? `owed ${formatCurrency(s.owed)}` : 'paid up'}
                </option>
              ))}
            </Select>
          </div>

          <Table>
            <THead>
              <tr>
                <Th>Invoice</Th>
                <Th>Amount</Th>
                <Th>Date</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </THead>
            <TBody>
              {loading ? (
                <TableLoading colSpan={cols} />
              ) : items.length === 0 ? (
                <TableEmpty colSpan={cols} message={selected ? `No invoices from ${selected.name} match.` : 'No purchase invoices recorded yet.'} />
              ) : (
                rows
              )}
            </TBody>
          </Table>
          <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white">
            <Pagination {...pagination} onChange={setPage} />
          </div>
      </div>

      <PurchaseEditModal purchase={editItem} onClose={() => setEditItem(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!deleteItem}
        title="Delete Purchase Invoice"
        message={`Ma hubtaa inaad tirtirto ${deleteItem?.purchaseNumber} (${formatCurrency(deleteItem?.totalCost)})? Falkan dib looma celin karo. (Only possible when it has no active payments; otherwise delete its payments first or use Void.)`}
        confirmLabel="Confirm Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteItem(null)}
      />
      <BulkPaymentModal
        open={bulkOpen}
        initialSupplierId={selected && selected.owed > 0 ? String(selected.id) : ''}
        onClose={() => setBulkOpen(false)}
        onPaid={(bulk) => {
          setBulkOpen(false);
          navigate(`/purchases/bulk-payments/${bulk.id}`);
        }}
      />
      <ConfirmDialog
        open={!!voidItem}
        title="Void Purchase"
        message={`Void purchase "${voidItem?.purchaseNumber}"? This will reverse the stock increase it caused.`}
        confirmLabel="Void Purchase"
        loading={voiding}
        onConfirm={handleVoid}
        onClose={() => setVoidItem(null)}
      />
    </div>
  );
}

function HeroStat({ label, value, accent }) {
  return (
    <div className="px-5 py-3">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`text-lg font-bold ${accent ? 'text-brand-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}
