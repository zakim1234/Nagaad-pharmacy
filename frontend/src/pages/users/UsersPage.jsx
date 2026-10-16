import { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';
import { PERMISSION_MODULES, ROLES } from '../../constants/permissions.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';

// Branches the Super Admin can put a user in (empty without branches or
// for branch admins, whose new users always join their own branch).
function UserFormModal({ open, onClose, user, onSaved, branches = [] }) {
  const toast = useToast();
  const isEdit = !!user;
  const [form, setForm] = useState({ username: '', password: '', name: '', role: 'cashier', permissions: [], branchId: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      user
        ? { username: user.username, password: '', name: user.name, role: user.role, permissions: user.permissions || [], branchId: user.branch ? String(user.branch) : '' }
        : { username: '', password: '', name: '', role: 'cashier', permissions: [], branchId: branches[0] ? String(branches[0].id) : '' }
    );
  }, [open, user]);

  const togglePermission = (key) =>
    setForm((f) => ({ ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Enter the full name.');
    if (!isEdit && !form.username.trim()) return toast.error('Enter a username.');
    if (!isEdit && form.password.length < 6) return toast.error('Password must be at least 6 characters.');
    setSaving(true);
    try {
      if (isEdit) {
        const payload = { name: form.name, role: form.role, permissions: form.permissions, ...(branches.length && !user.isSuperAdmin ? { branchId: form.branchId } : {}) };
        if (form.password) payload.password = form.password;
        await client.put(`/users/${user.id}`, payload);
        toast.success('User updated.');
      } else {
        await client.post('/users', { username: form.username, password: form.password, name: form.name, role: form.role, permissions: form.permissions, ...(branches.length ? { branchId: form.branchId } : {}) });
        toast.success('User created.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit User — ${user.name}` : 'Add New User'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Full Name" required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </FormField>
          <FormField label="Username / Email" required>
            <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} disabled={isEdit} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={isEdit ? 'New Password (leave blank to keep current)' : 'Password'} required={!isEdit}>
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </FormField>
          <FormField label="Role" required>
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </Select>
          </FormField>
        </div>

        {branches.length > 0 && !user?.isSuperAdmin && (
          <FormField label="Branch" required>
            <Select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}>
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                  {b.active ? '' : ' (closed)'}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {form.role === 'admin' ? (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            Admins always have access to every module{branches.length ? ' of their branch' : ''}.
          </p>
        ) : (
          <FormField label="Permissions">
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3">
              {PERMISSION_MODULES.map((m) => (
                <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.permissions.includes(m.key)} onChange={() => togglePermission(m.key)} />
                  {m.label}
                </label>
              ))}
            </div>
          </FormField>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save Changes' : 'Create User'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    if (!me?.isSuperAdmin) return;
    client.get('/branches').then((r) => setBranches(r.data.data)).catch(() => setBranches([]));
  }, [me]);
  const showBranch = users.some((u) => u.branchName || u.isSuperAdmin);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/users')
      .then((res) => setUsers(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load users.'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load]);

  const toggleCancel = async (u) => {
    const on = u.permissions.includes('cancelInvoices');
    try {
      await client.put(`/users/${u.id}`, { permissions: on ? u.permissions.filter((p) => p !== 'cancelInvoices') : [...u.permissions, 'cancelInvoices'] });
      toast.success(on ? `${u.name} can no longer cancel invoices.` : `${u.name} can now cancel invoices.`);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not change this permission.');
    }
  };

  const handleToggleActive = async () => {
    setToggling(true);
    try {
      await client.patch(`/users/${toggleTarget.id}/active`, { active: !toggleTarget.active });
      toast.success(toggleTarget.active ? 'User deactivated.' : 'User activated.');
      setToggleTarget(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not update this user.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Admin-only: manage staff accounts and per-user module permissions"
        actions={
          <Button onClick={() => { setEditUser(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" /> Add New User
          </Button>
        }
      />

      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Username</Th>
            <Th>Role</Th>
            {showBranch && <Th>Branch</Th>}
            <Th>Permissions</Th>
            <Th>Cancel invoices</Th>
            <Th>Status</Th>
            <Th>Created</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <TableLoading colSpan={showBranch ? 9 : 8} />
          ) : users.length === 0 ? (
            <TableEmpty colSpan={showBranch ? 9 : 8} message="No users found." />
          ) : (
            users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{u.name}</Td>
                <Td className="text-slate-500">{u.username}</Td>
                <Td><Badge color={u.role === 'admin' ? 'blue' : 'slate'}>{u.role}</Badge></Td>
                {showBranch && <Td>{u.isSuperAdmin ? <Badge color="red">Super Admin · all branches</Badge> : <span className="text-sm text-slate-700">{u.branchName || '—'}</span>}</Td>}
                <Td>
                  {u.role === 'admin' ? (
                    <span className="text-xs text-slate-400">All modules</span>
                  ) : u.permissions.length === 0 ? (
                    <span className="text-xs text-slate-300">None</span>
                  ) : (
                    <span className="text-xs text-slate-500">{u.permissions.length} module{u.permissions.length > 1 ? 's' : ''}</span>
                  )}
                </Td>
                <Td>
                  {u.role === 'admin' ? (
                    <span className="text-xs text-slate-400">Always</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleCancel(u)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${u.permissions.includes('cancelInvoices') ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                      {u.permissions.includes('cancelInvoices') ? 'On — click to turn off' : 'Off — click to allow'}
                    </button>
                  )}
                </Td>
                <Td><Badge color={u.active ? 'green' : 'red'}>{u.active ? 'Active' : 'Deactivated'}</Badge></Td>
                <Td className="text-xs text-slate-400">{formatDate(u.createdAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <button onClick={() => { setEditUser(u); setFormOpen(true); }} className="rounded-md px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                      Edit
                    </button>
                    {u.id !== me?.id && (
                      <button
                        onClick={() => setToggleTarget(u)}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${u.active ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {u.active ? <><ShieldOff className="h-3.5 w-3.5" /> Deactivate</> : <><ShieldCheck className="h-3.5 w-3.5" /> Activate</>}
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>

      <UserFormModal branches={branches} open={formOpen} onClose={() => setFormOpen(false)} user={editUser} onSaved={load} />
      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.active ? 'Deactivate User' : 'Activate User'}
        message={
          toggleTarget?.active
            ? `Deactivate "${toggleTarget?.name}"? They will lose access immediately. Their historical activity is preserved.`
            : `Activate "${toggleTarget?.name}"? They will be able to log in again with their existing permissions.`
        }
        confirmLabel={toggleTarget?.active ? 'Deactivate' : 'Activate'}
        variant={toggleTarget?.active ? 'danger' : 'primary'}
        loading={toggling}
        onConfirm={handleToggleActive}
        onClose={() => setToggleTarget(null)}
      />
    </div>
  );
}
