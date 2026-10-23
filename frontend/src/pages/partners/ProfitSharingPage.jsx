import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, PieChart, FileText, XCircle } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormField, Input, Select, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';

const round2 = (n) => Math.round(n * 100) / 100;
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => thisYear - i);

function ModeCard({ active, onClick, title, text }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${active ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:bg-slate-50'}`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-brand-600' : 'border-slate-300'}`}>
        {active && <span className="h-2 w-2 rounded-full bg-brand-600" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

// Year-end profit sharing: the year's net profit split between the partners
// by percentage (by default their share of the capital), either paid out of
// an account or added to their capital. Each distribution is kept and can
// be printed or cancelled.
export default function ProfitSharingPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';
  const [year, setYear] = useState(thisYear);
  const [preview, setPreview] = useState(null);
  const [percents, setPercents] = useState({});
  const [mode, setMode] = useState('PAYOUT');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadHistory = () =>
    client
      .get('/partners/profit-sharing')
      .then((r) => setHistory(r.data.data))
      .catch(() => setHistory([]));

  const loadPreview = () => {
    setPreview(null);
    client
      .get('/partners/profit-sharing/preview', { params: { year } })
      .then((r) => {
        setPreview(r.data.data);
        setPercents(Object.fromEntries(r.data.data.partners.map((p) => [p.id, p.percent])));
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Could not load the year profit.'));
  };

  useEffect(() => {
    loadPreview();
  }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadHistory();
  }, []);

  const profit = preview?.netProfit || 0;
  const rows = (preview?.partners || []).map((p) => ({ ...p, percent: Number(percents[p.id]) || 0 }));
  const totalPercent = round2(rows.reduce((s, r) => s + r.percent, 0));
  // Same rounding as the server: the last partner takes the remainder.
  let given = 0;
  const amounts = rows.map((r, i) => {
    const a = i === rows.length - 1 ? round2(profit - given) : round2((profit * r.percent) / 100);
    given = round2(given + a);
    return a;
  });

  const submit = async () => {
    if (Math.abs(totalPercent - 100) > 0.01) return toast.error(`The percentages must add up to 100% (now ${totalPercent}%).`);
    if (mode === 'PAYOUT' && !accountId) return toast.error('Choose the account the profit is paid from.');
    setSaving(true);
    try {
      await client.post('/partners/profit-sharing', {
        year,
        mode,
        paymentAccountId: mode === 'PAYOUT' ? accountId : undefined,
        note,
        shares: rows.map((r) => ({ partnerId: r.id, percent: r.percent })),
      });
      toast.success(`${year} profit shared between ${rows.length} partners.`);
      setNote('');
      loadPreview();
      loadHistory();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not share the profit.');
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    setCancelling(true);
    try {
      await client.post(`/partners/profit-sharing/${cancelTarget.id}/cancel`, { reason: cancelReason });
      toast.success(`${cancelTarget.year} profit sharing cancelled.`);
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
      <Link to="/partners" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to Partners
      </Link>
      <PageHeader title="Share Year Profit" subtitle="At year end, each partner gets their percentage of the year's net profit." />

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <FormField label="Year">
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
            {YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </FormField>
        {preview && (
          <div className={`rounded-xl px-5 py-3 ${profit > 0 ? 'bg-neutral-950 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
            <p className={`text-[11px] uppercase tracking-wider ${profit > 0 ? 'text-white/70' : 'text-slate-500'}`}>{year} net profit</p>
            <p className="text-2xl font-bold tabular-nums">{formatCurrency(profit)}</p>
          </div>
        )}
      </div>

      {!preview ? (
        <PageSpinner />
      ) : preview.existing ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          The {year} profit was already shared ({preview.existing.distributionNumber}, {formatDate(preview.existing.date)}).{' '}
          <Link className="font-semibold text-brand-700 hover:underline" to={`/partners/profit-sharing/${preview.existing.id}`}>
            View it
          </Link>
          {isAdmin ? ' — cancel it below to share again.' : '.'}
        </div>
      ) : profit <= 0 ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{year} has no profit to share.</div>
      ) : rows.length === 0 ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Add partners first.</div>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Partner</th>
                  <th className="px-4 py-2.5 text-right">Capital</th>
                  <th className="px-4 py-2.5 text-right">Share %</th>
                  <th className="px-4 py-2.5 text-right">Gets</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{formatCurrency(r.equity)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        disabled={!isAdmin}
                        className="ml-auto w-24 text-right"
                        value={percents[r.id] ?? ''}
                        onChange={(e) => setPercents((p) => ({ ...p, [r.id]: e.target.value }))}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{formatCurrency(amounts[i])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-900 font-bold">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Total
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${Math.abs(totalPercent - 100) > 0.01 ? 'text-brand-700' : ''}`}>{totalPercent}%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(round2(amounts.reduce((s, a) => s + a, 0)))}</td>
                </tr>
              </tfoot>
            </table>
            <p className="px-4 pb-3 text-xs text-slate-500">Percentages start from each partner's share of the capital; change them if your agreement says otherwise.</p>
          </div>

          <div className="space-y-3 lg:col-span-2">
            <p className="text-sm font-semibold text-slate-700">What happens to the profit?</p>
            <ModeCard active={mode === 'PAYOUT'} onClick={() => setMode('PAYOUT')} title="Pay it to the partners" text="Each share is paid out of the account you choose." />
            <ModeCard active={mode === 'CAPITAL'} onClick={() => setMode('CAPITAL')} title="Add it to their capital" text="The money stays in the business; each partner's capital grows by their share." />
            {mode === 'PAYOUT' && (
              <FormField label="Paid from account" required>
                <AccountSelect value={accountId} onChange={setAccountId} />
              </FormField>
            )}
            <FormField label="Note">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </FormField>
            {isAdmin ? (
              <Button className="w-full" loading={saving} onClick={submit}>
                <PieChart className="h-4 w-4" /> Share {formatCurrency(profit)}
              </Button>
            ) : (
              <p className="text-xs text-slate-500">Only an admin can share the profit.</p>
            )}
          </div>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">Past profit sharing</h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5">Number</th>
              <th className="px-4 py-2.5">Year</th>
              <th className="px-4 py-2.5 text-right">Profit</th>
              <th className="px-4 py-2.5">How</th>
              <th className="px-4 py-2.5">Date</th>
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
                  No profit shared yet.
                </td>
              </tr>
            ) : (
              history.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{d.distributionNumber}</td>
                  <td className="px-4 py-2.5">{d.year}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(d.netProfit)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{d.mode === 'PAYOUT' ? `Paid from ${d.accountName}` : 'Added to capital'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatDate(d.date)}</td>
                  <td className="px-4 py-2.5">{d.status === 'ACTIVE' ? <Badge color="green">Shared</Badge> : <Badge color="slate">Cancelled</Badge>}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Link
                        to={`/partners/profit-sharing/${d.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <FileText className="h-3.5 w-3.5" /> View
                      </Link>
                      {isAdmin && d.status === 'ACTIVE' && (
                        <Button size="sm" variant="secondary" onClick={() => setCancelTarget(d)}>
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

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancel ${cancelTarget?.year} profit sharing`} size="sm">
        {cancelTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {cancelTarget.mode === 'PAYOUT'
                ? `The ${formatCurrency(cancelTarget.netProfit)} paid out comes back into ${cancelTarget.accountName}.`
                : `The ${formatCurrency(cancelTarget.netProfit)} added to the partners' capital is taken back off.`}
            </p>
            <FormField label="Reason">
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Optional" />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelTarget(null)}>
                Keep it
              </Button>
              <Button loading={cancelling} onClick={confirmCancel}>
                <XCircle className="h-4 w-4" /> Cancel sharing
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
