import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Tag } from 'lucide-react';
import client from '../../api/client.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { Input, FormField } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';

function CategoryFormModal({ open, onClose, category, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(category?.name || '');
      setError('');
    }
  }, [open, category]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }
    setSaving(true);
    try {
      if (category) {
        await client.put(`/categories/${category.id}`, { name });
        toast.success('Category updated.');
      } else {
        await client.post('/categories', { name });
        toast.success('Category created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save category.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={category ? 'Edit Category' : 'Create Category'} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Category Name" required error={error}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Medicine" />
        </FormField>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {category ? 'Save Changes' : 'Create Category'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function CategoriesPage() {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);

  const [formOpen, setFormOpen] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const [deleteCategory, setDeleteCategory] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/categories', { params: { search: debouncedSearch || undefined } })
      .then((res) => setCategories(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load categories.'))
      .finally(() => setLoading(false));
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.delete(`/categories/${deleteCategory.id}`);
      toast.success('Category deleted.');
      setDeleteCategory(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not delete category.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Manage product categories"
        actions={
          <Button
            onClick={() => {
              setEditCategory(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Create Category
          </Button>
        }
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search categories..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Category Name</Th>
            <Th>Items Count</Th>
            <Th>Created Date</Th>
            <Th>Last Updated</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <TableLoading colSpan={5} />
          ) : categories.length === 0 ? (
            <TableEmpty colSpan={5} message="No categories yet. Create one to start organizing inventory." />
          ) : (
            categories.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  <div className="flex items-center gap-2 font-medium text-slate-900">
                    <Tag className="h-4 w-4 text-slate-400" /> {c.name}
                  </div>
                </Td>
                <Td>{c.itemCount}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(c.createdAt)}</Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(c.updatedAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => {
                        setEditCategory(c);
                        setFormOpen(true);
                      }}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteCategory(c)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>

      <CategoryFormModal open={formOpen} onClose={() => setFormOpen(false)} category={editCategory} onSaved={load} />
      <ConfirmDialog
        open={!!deleteCategory}
        title="Delete Category"
        message={
          deleteCategory?.itemCount > 0
            ? `"${deleteCategory?.name}" is used by ${deleteCategory?.itemCount} inventory item(s) and cannot be deleted until they are recategorized.`
            : `Are you sure you want to delete "${deleteCategory?.name}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteCategory(null)}
      />
    </div>
  );
}
