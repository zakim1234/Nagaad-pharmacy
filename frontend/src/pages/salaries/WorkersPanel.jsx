import { useEffect, useState } from 'react';
import { HardHat, Pencil, Plus, UserX, UserCheck } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input } from '../../components/ui/Field.jsx';

// People who work here and get a salary but have no login (porters,
// cleaners, guards...). Active ones appear on the salary sheet.
export default function WorkersPanel({ onChanged }) {
  const toast = useToast();
  const [workers, setWorkers] = useState([]);
  const [editing, setEditing] = useState(null); // {} for a new one, or the worker
  const [form, setForm] = useState({ name: '', job: '', phone: '' });
  const [saving, setSaving] = useState(false);

  const load = () =>
    client
      .get('/salaries/workers')
      .then((r) => setWorkers(r.data.data))
      .catch(() => setWorkers([]));
  useEffect(() => {
    load();
  }, []);

  const open = (w) => {
    setEditing(w || {});
    setForm({ name: w?.name || '', job: w?.job || '', phone: w?.phone || '' });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing.id) await client.put(`/salaries/workers/${editing.id}`, form);
      else await client.post('/salaries/workers', form);
      toast.success(editing.id ? `${form.name} updated.` : `${form.name} added — they are on the salary sheet now.`);
      setEditing(null);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save the worker.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (w) => {
    try {
      await client.put(`/salaries/workers/${w.id}`, { active: !w.active });
      toast.success(w.active ? `${w.name} is off the salary sheet.` : `${w.name} is back on the salary sheet.`);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not change this worker.');
    }
  };

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <HardHat className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-neutral-900">Workers without a login</h3>
          <span className="text-xs text-neutral-400">porters, cleaners, guards… paid on the sheet above</span>
        </div>
        <Button size="sm" onClick={() => open(null)}>
          <Plus className="h-4 w-4" /> Add worker
        </Button>
      </div>
      {workers.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-400">No workers yet. Add the people who work here without using the system.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Job</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className={`border-t border-neutral-100 ${w.active ? '' : 'opacity-60'}`}>
                <td className="px-4 py-2 font-medium text-neutral-900">{w.name}</td>
                <td className="px-4 py-2 text-neutral-600">{w.job || '—'}</td>
                <td className="px-4 py-2 text-neutral-600">{w.phone || '—'}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${w.active ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-500'}`}>
                    {w.active ? 'On the sheet' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => open(w)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button onClick={() => toggle(w)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100">
                      {w.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      {w.active ? 'Make inactive' : 'Make active'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={!!editing} onClose={saving ? undefined : () => setEditing(null)} title={editing?.id ? `Edit ${editing.name}` : 'Add worker'} size="sm">
        <div className="space-y-3">
          <FormField label="Name">
            <Input autoFocus value={form.name} maxLength={100} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Faarax Cali" />
          </FormField>
          <FormField label="Job">
            <Input value={form.job} maxLength={60} onChange={(e) => setForm((f) => ({ ...f, job: e.target.value }))} placeholder="e.g. Porter / Xamaal" />
          </FormField>
          <FormField label="Phone (optional)">
            <Input value={form.phone} maxLength={30} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="e.g. 615123456" />
          </FormField>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Close
            </Button>
            <Button loading={saving} disabled={!form.name.trim()} onClick={save}>
              {editing?.id ? 'Save' : 'Add worker'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
