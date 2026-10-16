import { useEffect, useState } from 'react';
import { Store, Plus, Pencil, Power } from 'lucide-react';
import client, { setSelectedBranch } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';

// Super Admin: open new branches, rename them, close/reopen them.
export default function BranchesPage() {
  const toast = useToast();
  const [branches, setBranches] = useState(null);
  const [editing, setEditing] = useState(null); // {} new, or a branch

  const load = () =>
    client
      .get('/branches')
      .then((r) => setBranches(r.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load branches.'));

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleActive = async (b) => {
    try {
      await client.put(`/branches/${b.id}`, { active: !b.active });
      toast.success(`${b.name} ${b.active ? 'closed' : 'reopened'}.`);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not change this branch.');
    }
  };

  if (!branches) return <PageSpinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Branches</h1>
          <p className="text-sm text-slate-500">Each branch keeps its own items, stock, customers, suppliers, accounts and day closing.</p>
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus className="h-4 w-4" /> New branch
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((b) => (
          <div key={b.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${b.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white">
                <Store className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate font-bold text-slate-900">
                  {b.name}
                  {!b.active && <Badge color="red">Closed</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">{[b.address, b.phone].filter(Boolean).join(' · ') || 'No address'}</p>
                <p className="text-xs text-slate-400">
                  {b.users ?? 0} user{b.users === 1 ? '' : 's'} · since {formatDate(b.createdAt)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
              {b.active && (
                <button
                  onClick={() => {
                    setSelectedBranch(String(b.id));
                    window.location.href = '/dashboard';
                  }}
                  className="rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                >
                  Open branch
                </button>
              )}
              <button onClick={() => setEditing(b)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button onClick={() => toggleActive(b)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Power className="h-3.5 w-3.5" /> {b.active ? 'Close' : 'Reopen'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <BranchModal branch={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

function BranchModal({ branch, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', address: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const isNew = branch && !branch.id;

  useEffect(() => {
    if (branch) setForm({ name: branch.name || '', address: branch.address || '', phone: branch.phone || '' });
  }, [branch]);

  if (!branch) return null;

  const save = async () => {
    if (!form.name.trim()) return toast.error('Enter the branch name.');
    setSaving(true);
    try {
      if (isNew) await client.post('/branches', form);
      else await client.put(`/branches/${branch.id}`, form);
      toast.success(isNew ? `${form.name} opened.` : `${form.name} saved.`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the branch.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!branch}
      onClose={saving ? undefined : onClose}
      title={isNew ? 'New branch' : `Edit ${branch.name}`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {isNew ? 'Open branch' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <FormField label="Name" required>
          <Input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hodan Branch" autoFocus />
        </FormField>
        <FormField label="Address">
          <Input value={form.address} maxLength={200} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </FormField>
        <FormField label="Phone">
          <Input value={form.phone} maxLength={100} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </FormField>
        {isNew && <p className="text-xs text-slate-500">A new branch starts empty, with the default payment accounts. Add its users under Users.</p>}
      </div>
    </Modal>
  );
}
