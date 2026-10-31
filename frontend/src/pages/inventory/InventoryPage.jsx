import { canEditRecords, canDeleteRecords } from '../../constants/permissions.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useEffect, useState, useCallback } from 'react';
import { Search, Pencil, Trash2, Eye, Boxes, Package, Coins, TrendingUp, Tag, BellRing } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import { SHOW_EVENT } from '../../components/StockAlerts.jsx';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Badge, { stockStatusBadge, expiryStatusBadge } from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import InventoryFormModal from './InventoryFormModal.jsx';
import InventoryDetailsModal from './InventoryDetailsModal.jsx';

const num = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round(n * 100) / 100;

function Figure({ icon: Icon, label, value, hint, strong = false, className = "" }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${strong ? "surface-blue" : "border border-neutral-200/80 bg-white"} ${className}`}>
      <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${strong ? 'bg-white/60 text-brand-800' : 'bg-brand-50 text-brand-700'}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="figure truncate text-lg font-extrabold text-neutral-950 sm:text-xl">{value}</p>
        {hint && <p className="truncate text-[11px] text-neutral-500">{hint}</p>}
      </div>
    </div>
  );
}

const TH = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500';

export default function InventoryPage() {
  const { user: me } = useAuth();
  const canEdit = canEditRecords(me); // the server checks this too
  const canDelete = canDeleteRecords(me);
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [expiryFilter, setExpiryFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [sort, setSort] = useState('createdAt:desc');
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [detailsItem, setDetailsItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    client.get('/categories').then((res) => setCategories(res.data.data)).catch(() => setCategories([])); // no Categories permission: no filter
    client.get('/suppliers?limit=100').then((res) => setSuppliers(res.data.data)).catch(() => setSuppliers([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const [sortBy, sortDir] = sort.split(':');
    const params = {
      page,
      limit: 20,
      search: debouncedSearch,
      category: category || undefined,
      stockFilter: stockFilter || undefined,
      expiryFilter: expiryFilter || undefined,
      supplier: supplierFilter || undefined,
      sortBy,
      sortDir,
    };
    client
      .get('/inventory', { params })
      .then((res) => {
        setItems(res.data.data);
        setSummary(res.data.summary || null);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load inventory.'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, category, stockFilter, expiryFilter, supplierFilter, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => setPage(1), [debouncedSearch, category, stockFilter, expiryFilter, supplierFilter]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.delete(`/inventory/${deleteItem.id}`);
      toast.success('Item deleted.');
      setDeleteItem(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete item.');
    } finally {
      setDeleting(false);
    }
  };

  const filtered = !!(debouncedSearch || category || stockFilter || expiryFilter || supplierFilter);
  const margin = summary && summary.totalSell > 0 ? Math.round((summary.profit / summary.totalSell) * 100) : null;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Every product: stock in hand, its cost and selling price, and the profit it makes."
        actions={
          <Button
            variant="secondary"
            onClick={() => window.dispatchEvent(new CustomEvent(SHOW_EVENT, { detail: { onEmpty: () => toast.success('No alerts right now: nothing expiring within a month and no stock running low.') } }))}
          >
            <BellRing className="h-4 w-4" /> Show alerts
          </Button>
        }
      />

      {/* Totals for everything matching the filters */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Figure icon={Boxes} label={filtered ? 'Items (filtered)' : 'Items'} value={summary ? summary.items.toLocaleString() : '—'} />
        <Figure icon={Package} label="Units in stock" value={summary ? summary.units.toLocaleString() : '—'} />
        <Figure icon={Coins} label="Total cost" value={summary ? formatCurrency(summary.totalCost) : '—'} hint="What the stock cost" />
        <Figure icon={Tag} label="Total sell value" value={summary ? formatCurrency(summary.totalSell) : '—'} hint="At selling prices" />
        <Figure strong className="col-span-2 xl:col-span-1" icon={TrendingUp} label="Profit on stock" value={summary ? formatCurrency(summary.profit) : '—'} hint={margin !== null ? `${margin}% of the sell value` : null} />
      </div>

      {/* Filters */}
      <div className="mb-4 rounded-2xl border border-neutral-200/80 bg-white p-3">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input className="pl-10" placeholder="Search by item name, serial number or item ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
            <option value="">All stock levels</option>
            <option value="in_stock">In stock</option>
            <option value="low_stock">Low stock</option>
            <option value="out_of_stock">Out of stock</option>
          </Select>
          <Select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)}>
            <option value="">All expiry</option>
            <option value="near_expiry">Near expiry</option>
            <option value="expired">Expired</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="createdAt:desc">Newest first</option>
            <option value="createdAt:asc">Oldest first</option>
            <option value="name:asc">Name (A–Z)</option>
            <option value="quantity:asc">Quantity (low–high)</option>
            <option value="sellingPriceCents:desc">Price (high–low)</option>
          </Select>
        </div>
      </div>

      {/* Items */}
      <div className="overflow-hidden rounded-2xl border border-neutral-200/80 bg-white">
        {loading ? (
          <PageSpinner />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-neutral-500">
            <Boxes className="h-8 w-8 text-neutral-300" />
            No items found. Try other filters, or add items from Stock.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left">
                  <th className={TH}>Item</th>
                  <th className={TH}>Category · Supplier</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} text-right`}>Cost / Sell</th>
                  <th className={`${TH} text-right`}>Total cost / Total sell</th>
                  <th className={`${TH} text-right`}>Profit</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => {
                  const stock = stockStatusBadge(item.stockStatus);
                  const expiry = expiryStatusBadge(item.expiryStatus);
                  const totalCost = round2(item.quantity * item.costPrice);
                  const totalSell = round2(item.quantity * item.sellingPrice);
                  const profit = round2(totalSell - totalCost);
                  return (
                    <tr key={item.id} className="align-middle hover:bg-neutral-50/70">
                      <td className="px-4 py-3">
                        <button onClick={() => setDetailsItem(item)} className="text-left">
                          <span className="block font-semibold text-neutral-950 hover:text-brand-700">{item.name}</span>
                          <span className="block font-mono text-[11px] text-neutral-400">
                            {item.itemCode}
                            {item.serialNumber ? ` · SN ${item.serialNumber}` : ''}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block text-neutral-800">{item.category?.name || 'Uncategorized'}</span>
                        <span className="block text-xs text-neutral-400">{item.supplier?.name || 'No supplier'}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <span className="font-semibold text-neutral-900">{item.quantity.toLocaleString()}</span> <span className="text-xs text-neutral-400">{item.unit}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-800">
                        {num(item.costPrice)} <span className="text-neutral-300">/</span> {num(item.sellingPrice)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-800">
                        {num(totalCost)} <span className="text-neutral-300">/</span> {num(totalSell)}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums ${profit < 0 ? 'text-brand-700' : 'text-neutral-950'}`}>{formatCurrency(profit)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Badge color={stock.color}>{stock.label}</Badge>
                          {['expired', 'near_expiry'].includes(item.expiryStatus) && <Badge color={expiry.color}>{expiry.label}</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setDetailsItem(item)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => {
                                setEditItem(item);
                                setFormOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-brand-700"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => setDeleteItem(item)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-brand-700">
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-neutral-100">
          <Pagination {...pagination} onChange={setPage} />
        </div>
      </div>

      <InventoryFormModal open={formOpen} onClose={() => setFormOpen(false)} item={editItem} onSaved={load} />
      <InventoryDetailsModal open={!!detailsItem} onClose={() => setDetailsItem(null)} item={detailsItem} />
      <ConfirmDialog
        open={!!deleteItem}
        title="Delete Item"
        message={`Ma hubtaa inaad tirtirto "${deleteItem?.name}"? Alaabta iyo stock-geeda (${deleteItem?.quantity ?? 0}) waa la tirtirayaa, dib looma celin karo. Boonooyinkii hore way sii jiraan. (The item and its stock are removed for good; past invoices keep it.)`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
