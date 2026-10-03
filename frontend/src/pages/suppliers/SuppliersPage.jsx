import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import SupplierFormModal from './SupplierFormModal.jsx';

export default function SuppliersPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/suppliers', { params: { page, limit: 20, search: debouncedSearch } })
      .then((res) => {
        setItems(res.data.data);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load suppliers.'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);
  useEffect(() => setPage(1), [debouncedSearch]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.delete(`/suppliers/${deleteItem.id}`);
      toast.success('Supplier deleted.');
      setDeleteItem(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete supplier.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Manage supplier records and purchase history"
        actions={
          <Button
            onClick={() => {
              setEditItem(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Supplier
          </Button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Phone</Th>
            <Th>Email</Th>
            <Th>Total Spent</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <TableLoading colSpan={5} />
          ) : items.length === 0 ? (
            <TableEmpty colSpan={5} message="No suppliers found." />
          ) : (
            items.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>
                  <Link to={`/suppliers/${s.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                    {s.name}
                  </Link>
                </Td>
                <Td>{s.phone || '—'}</Td>
                <Td>{s.email || '—'}</Td>
                <Td>{formatCurrency(s.totalSpent)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => {
                        setEditItem(s);
                        setFormOpen(true);
                      }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleteItem(s)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white">
        <Pagination {...pagination} onChange={setPage} />
      </div>

      <SupplierFormModal open={formOpen} onClose={() => setFormOpen(false)} supplier={editItem} onSaved={load} />
      <ConfirmDialog
        open={!!deleteItem}
        title="Delete Supplier"
        message={`Are you sure you want to delete "${deleteItem?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteItem(null)}
      />
    </div>
  );
}
