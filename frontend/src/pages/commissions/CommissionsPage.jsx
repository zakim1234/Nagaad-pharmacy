import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgePercent, FileText, XCircle, Plus, Trash2 } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const DEFAULT_KEY = { month: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, year: String(now.getFullYear()) };
const round2 = (n) => Math.round(n * 100) / 100;

export function periodLabel(type, key) {
  if (type === 'year') return String(key);
  const [y, m] = String(key).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Commission: for one month or one year, each person gets the percentage
// typed in for them, of that period's profit before commission. Paid as a
// "Commission" expense, so the partners later share what is left.
export default function CommissionsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const type = params.get('type') === 'year' ? 'year' : 'month';
  const key = params.get('key') || DEFAULT_KEY[type];
  const [preview, setPreview] = useState(null);
  const [percents, setPercents] = useState({});
  const [others, setOthers] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadPreview = () => {
    setPreview(null);
    client
      .get('/commissions/preview', { params: { type, key } })
      .then((r) => {
        setPreview(r.data.data);
        setPercents({});
        setOthers([]);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the period profit.'));
  };
  const loadHistory = () =>
    client
      .get('/commissions')
      .then((r) => setHistory(r.data.data))
      .catch(() => setHistory([]));

  useEffect(() => {
    loadPreview();
  }, [type, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadHistory();
  }, []);

  const base = preview?.baseProfit || 0;
  const paidIds = new Set((preview?.earlier || []).flatMap((c) => c.lines.map((l) => String(l.user || ''))).filter(Boolean));
  const staffLines = (preview?.staff || []).filter((s) => !paidIds.has(String(s.id))).map((s) => ({ ...s, percent: Number(percents[s.id]) || 0 }));
  const otherLines = others.map((o) => ({ ...o, percent: Number(o.percent) || 0 }));
  const chosen = [...staffLines.filter((s) => s.percent > 0).map((s) => ({ userId: s.id, percent: s.percent })), ...otherLines.filter((o) => o.name.trim() && o.percent > 0).map((o) => ({ name: o.name.trim(), percent: o.percent }))];
  const totalPercent = round2(chosen.reduce((s, l) => s + l.percent, 0));
  const earlierTotal = round2((preview?.earlier || []).reduce((s, c) => s + c.total, 0));
  const amountOf = (p) => round2((base * p) / 100);

  const pay = async () => {
    if (!chosen.length) return toast.error('Type a percentage for at least one person.');
    if (!accountId) return toast.error('Choose the account the commission is paid from.');
    setSaving(true);
    try {
      const r = await client.post('/commissions', { type, key, paymentAccountId: accountId, note, lines: chosen });
      toast.success(`${formatCurrency(r.data.data.total)} commission paid to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}.`);
      setNote('');
      loadPreview();
      loadHistory();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not pay the commission.');
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    setCancelling(true);
    try {
      await client.post(`/commissions/${cancelTarget.id}/cancel`, { reason: cancelReason });
      toast.success(`${cancelTarget.commissionNumber} cancelled; the money is back in ${cancelTarget.accountName}.`);
      setCancelTarget(null);
      setCancelReason('');
      loadPreview();
      loadHistory();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not cancel.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div>
      <PageHeader title="Commissions" subtitle="Give staff and branch admins a percentage of the month's or year's profit. Paid before the partners share the profit." />

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {[
            ['month', 'Monthly'],
            ['year', 'Yearly'],
          ].map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setParams({ type: t, key: DEFAULT_KEY[t] })}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${type === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {type === 'month' ? (
          <div className="w-44">
          <Input type="month" value={key} onChange={(e) => e.target.value && setParams({ type, key: e.target.value })} />
        </div>
        ) : (
          <div className="w-28">
          <Input type="number" min="2000" max="2100" value={key} onChange={(e) => e.target.value.length === 4 && setParams({ type, key: e.target.value })} />
        </div>
        )}
        {preview && (
          <div className={`rounded-xl px-5 py-3 ${base > 0 ? 'bg-neutral-950 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
            <p className={`text-[11px] uppercase tracking-wider ${base > 0 ? 'text-white/70' : 'text-slate-500'}`}>Profit before commission · {periodLabel(type, key)}</p>
            <p className="text-2xl font-bold tabular-nums">{formatCurrency(base)}</p>
          </div>
        )}
      </div>

      {!preview ? (
        <PageSpinner />
      ) : base <= 0 ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{periodLabel(type, key)} has no profit to pay commission on.</div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Person</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5 text-right">Commission %</th>
                  <th className="px-4 py-2.5 text-right">Gets</th>
                </tr>
              </thead>
              <tbody>
                {staffLines.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="px-4 py-2 font-semibold text-slate-800">{s.name}</td>
                    <td className="px-4 py-2 capitalize text-slate-500">{s.role}</td>
                    <td className="px-4 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="—"
                        disabled={!isAdmin}
                        className="ml-auto w-24 text-right"
                        value={percents[s.id] ?? ''}
                        onChange={(e) => setPercents((p) => ({ ...p, [s.id]: e.target.value }))}
                      />
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">{s.percent > 0 ? formatCurrency(amountOf(s.percent)) : '—'}</td>
                  </tr>
                ))}
                {others.map((o, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-4 py-2" colSpan={2}>
                      <div className="flex items-center gap-2">
                        <Input placeholder="Name" value={o.name} onChange={(e) => setOthers((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <Button size="sm" variant="secondary" onClick={() => setOthers((list) => list.filter((_, j) => j !== i))}>
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className="ml-auto w-24 text-right"
                        value={o.percent}
                        onChange={(e) => setOthers((list) => list.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                      />
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">{Number(o.percent) > 0 ? formatCurrency(amountOf(Number(o.percent))) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 font-bold">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Total
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${totalPercent > 100 ? 'text-brand-700' : ''}`}>{totalPercent}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(amountOf(totalPercent))}</td>
                </tr>
              </tfoot>
            </table>
            {isAdmin && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Button size="sm" variant="secondary" onClick={() => setOthers((list) => [...list, { name: '', percent: '' }])}>
                  <Plus className="h-3.5 w-3.5" /> Add someone else
                </Button>
                <p className="text-xs text-slate-500">Leave a box empty for anyone who gets nothing.</p>
              </div>
            )}
          </div>

          <div className="space-y-3 lg:col-span-2">
            {preview.earlier.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <p className="font-semibold text-slate-800">Already paid for {periodLabel(type, key)}: {formatCurrency(earlierTotal)}</p>
                <p className="text-xs text-slate-500">{preview.earlier.flatMap((c) => c.lines.map((l) => `${l.name} ${l.percent}%`)).join(' · ')}</p>
              </div>
            )}
            <FormField label="Paid from account" required>
              <AccountSelect value={accountId} onChange={setAccountId} />
            </FormField>
            <FormField label="Note">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </FormField>
            {isAdmin ? (
              <Button className="w-full" loading={saving} onClick={pay}>
                <BadgePercent className="h-4 w-4" /> Pay {formatCurrency(amountOf(totalPercent))} commission
              </Button>
            ) : (
              <p className="text-xs text-slate-500">Only an admin can pay commission.</p>
            )}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">Commission paid</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Number</th>
              <th className="px-4 py-2.5">Period</th>
              <th className="px-4 py-2.5">People</th>
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5">Paid</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {history === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : history.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No commission paid yet.
                </td>
              </tr>
            ) : (
              history.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{c.commissionNumber}</td>
                  <td className="px-4 py-2.5">
                    {periodLabel(c.periodType, c.periodKey)} <span className="text-xs text-slate-400">{c.periodType === 'year' ? 'yearly' : 'monthly'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{c.lines.map((l) => `${l.name} ${l.percent}%`).join(', ')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(c.total)}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {formatDate(c.createdAt)} · {c.accountName}
                  </td>
                  <td className="px-4 py-2.5">{c.status === 'ACTIVE' ? <Badge color="green">Paid</Badge> : <Badge color="slate">Cancelled</Badge>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Link to={`/commissions/${c.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <FileText className="h-3.5 w-3.5" /> View
                      </Link>
                      {isAdmin && c.status === 'ACTIVE' && (
                        <Button size="sm" variant="secondary" onClick={() => setCancelTarget(c)}>
                          <XCircle className="h-3.5 w-3.5 text-brand-600" /> Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancel ${cancelTarget?.commissionNumber}`} size="sm">
        {cancelTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              The {formatCurrency(cancelTarget.total)} commission comes back into {cancelTarget.accountName}.
            </p>
            <FormField label="Reason">
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Optional" />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelTarget(null)}>
                Keep it
              </Button>
              <Button loading={cancelling} onClick={confirmCancel}>
                <XCircle className="h-4 w-4" /> Cancel commission
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
