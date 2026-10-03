import { useEffect, useState, useCallback } from 'react';
import { Search, Pencil, Trash2, Eye } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Badge, { stockStatusBadge, expiryStatusBadge } from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import InventoryFormModal from './InventoryFormModal.jsx';
import InventoryDetailsModal from './InventoryDetailsModal.jsx';

export default function InventoryPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
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
    client.get('/categories').then((res) => setCategories(res.data.data));
    client.get('/suppliers?limit=100').then((res) => setSuppliers(res.data.data));
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

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Manage products, stock levels and pricing" />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search by item, serial number, or item ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
          <option value="">All Stock Levels</option>
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
        </Select>
        <Select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value)}>
          <option value="">All Expiry</option>
          <option value="near_expiry">Near Expiry</option>
          <option value="expired">Expired</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="createdAt:desc">Newest First</option>
          <option value="createdAt:asc">Oldest First</option>
          <option value="name:asc">Name (A-Z)</option>
          <option value="quantity:asc">Quantity (Low-High)</option>
          <option value="sellingPriceCents:desc">Price (High-Low)</option>
        </Select>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Item ID</Th>
            <Th>Item Name</Th>
            <Th>Serial Number</Th>
            <Th>Category</Th>
            <Th>Supplier</Th>
            <Th>Quantity</Th>
            <Th>Avg Cost / Sell</Th>
            <Th>Total Value</Th>
            <Th>Status</Th>
            <Th>Expiry</Th>
            <Th>Created</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <TableLoading colSpan={12} />
          ) : items.length === 0 ? (
            <TableEmpty colSpan={12} message="No inventory items found. Try adjusting your filters or add a new item." />
          ) : (
            items.map((item) => {
              const stock = stockStatusBadge(item.stockStatus);
              const expiry = expiryStatusBadge(item.expiryStatus);
              return (
                <tr key={item.id} className="hover:bg-slate-50">
                  <Td className="whitespace-nowrap font-mono text-xs text-slate-500">{item.itemCode}</Td>
                  <Td>
                    <button onClick={() => setDetailsItem(item)} className="text-left font-medium text-slate-900 hover:text-indigo-600">
                      {item.name}
                    </button>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{item.serialNumber || '—'}</Td>
                  <Td>{item.category?.name || 'Uncategorized'}</Td>
                  <Td>{item.supplier?.name || '—'}</Td>
                  <Td className="tabular-nums">
                    {item.quantity} {item.unit}
                  </Td>
                  <Td className="tabular-nums">
                    <span className="text-slate-500">{formatCurrency(item.costPrice)}</span>
                    {' / '}
                    <span className="font-medium">{formatCurrency(item.sellingPrice)}</span>
                  </Td>
                  <Td className="tabular-nums font-medium text-slate-700">{formatCurrency(item.quantity * item.costPrice)}</Td>
                  <Td>
                    <Badge color={stock.color}>{stock.label}</Badge>
                  </Td>
                  <Td>
                    {item.expiryDate ? <Badge color={expiry.color}>{expiry.label}</Badge> : <span className="text-slate-300">—</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(item.createdAt)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setDetailsItem(item)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="View details">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setEditItem(item);
                          setFormOpen(true);
                        }}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleteItem(item)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })
          )}
        </TBody>
      </Table>
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white">
        <Pagination {...pagination} onChange={setPage} />
      </div>

      <InventoryFormModal open={formOpen} onClose={() => setFormOpen(false)} item={editItem} onSaved={load} />
      <InventoryDetailsModal open={!!detailsItem} onClose={() => setDetailsItem(null)} item={detailsItem} />
      <ConfirmDialog
        open={!!deleteItem}
        title="Delete Item"
        message={`Are you sure you want to delete "${deleteItem?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
