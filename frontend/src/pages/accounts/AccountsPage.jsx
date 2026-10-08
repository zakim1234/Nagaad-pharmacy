import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Ban,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
  Smartphone,
  Landmark,
  Store,
  CircleDollarSign,
  Clock,
  ReceiptText,
  Wallet,
  BarChart3,
} from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import AccountFormModal from './AccountFormModal.jsx';

// A soft tint per account type -- just enough colour to tell them apart.
const TYPES = {
  MOBILE_MONEY: { label: 'Mobile Money', icon: Smartphone, tint: 'bg-emerald-50 text-emerald-600' },
  BANK: { label: 'Bank', icon: Landmark, tint: 'bg-blue-50 text-blue-600' },
  MERCHANT: { label: 'Merchant', icon: Store, tint: 'bg-amber-50 text-amber-600' },
  OTHER: { label: 'Other', icon: CircleDollarSign, tint: 'bg-slate-100 text-slate-500' },
};
const typeOf = (t) => TYPES[t] || TYPES.OTHER;

const TXN_LABELS = {
  SALE_PAYMENT: 'Sale Payment',
  CUSTOMER_DEBT_PAYMENT: 'Customer Debt Payment',
  PURCHASE_PAYMENT: 'Purchase Payment',
  REFUND: 'Refund',
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
  EXPENSE: 'Expense',
  PARTNER_CONTRIBUTION: 'Partner Contribution',
  PARTNER_WITHDRAWAL: 'Partner Withdrawal',
};

const RANGE_LABELS = { today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', year: 'This year' };

function timeOf(date) {
  return new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayHeading(date) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AccountsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('accounts');
  const [selectedId, setSelectedId] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [deactivateAccount, setDeactivateAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reportRange, setReportRange] = useState('month');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [report, setReport] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/accounts')
      .then((res) => {
        setData(res.data.data);
        if (!selectedId && res.data.data.accounts.length > 0) setSelectedId(res.data.data.accounts[0].id);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load accounts.'))
      .finally(() => setLoading(false));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedId) return;
    setTransactions(null);
    client
      .get(`/accounts/${selectedId}/transactions`, { params: { limit: 30 } })
      .then((res) => setTransactions(res.data.data))
      .catch(() => setTransactions(null));
  }, [selectedId]);

  useEffect(() => {
    client
      .get('/accounts/report', { params: { range: reportFrom || reportTo ? undefined : reportRange, from: reportFrom || undefined, to: reportTo || undefined } })
      .then((res) => setReport(res.data.data))
      .catch(() => setReport(null));
  }, [reportRange, reportFrom, reportTo]);

  const handleToggleActive = async () => {
    setBusy(true);
    try {
      await client.put(`/accounts/${deactivateAccount.id}`, { isActive: !deactivateAccount.isActive });
      toast.success(deactivateAccount.isActive ? 'Account deactivated.' : 'Account reactivated.');
      setDeactivateAccount(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not update this account.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <PageSpinner />;
  if (!data) return null;

  const selectedAccount = data.accounts.find((a) => a.id === selectedId);
  const activeCount = data.accounts.filter((a) => a.isActive).length;
  const totals = report
    ? report.accounts.reduce((t, a) => ({ in: t.in + a.moneyIn, out: t.out + a.moneyOut, opening: t.opening + a.openingBalance, current: t.current + a.currentBalance }), { in: 0, out: 0, opening: 0, current: 0 })
    : null;
  const periodLabel = reportFrom || reportTo ? 'Selected period' : RANGE_LABELS[reportRange] || 'Period';

  // The selected account's transactions, grouped by calendar day.
  const groups = [];
  for (const t of transactions?.transactions || []) {
    const key = new Date(t.createdAt).toDateString();
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(t);
    else groups.push({ key, label: dayHeading(t.createdAt), items: [t] });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Accounts</h1>
          <p className="mt-0.5 text-sm text-slate-500">Where money is received and paid across the business</p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEditAccount(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Account
          </Button>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 divide-slate-100 rounded-2xl border border-slate-200/70 bg-white shadow-sm lg:grid-cols-4 lg:divide-x">
        <Summary label="Total balance" value={formatCurrency(data.totalBalance)} valueClass={data.totalBalance < 0 ? 'text-rose-600' : 'text-slate-900'} icon={Wallet} tint="bg-indigo-50 text-indigo-600" />
        <Summary label="Accounts" value={`${activeCount} active`} hint={data.accounts.length > activeCount ? `${data.accounts.length - activeCount} inactive` : null} icon={Landmark} tint="bg-sky-50 text-sky-600" />
        <Summary label="Money in" value={totals ? formatCurrency(totals.in) : '—'} hint={periodLabel} icon={ArrowDownLeft} tint="bg-emerald-50 text-emerald-600" />
        <Summary label="Money out" value={totals ? formatCurrency(totals.out) : '—'} hint={periodLabel} icon={ArrowUpRight} tint="bg-rose-50 text-rose-600" />
      </div>

      {/* Tabs */}
      <div className="inline-flex gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1">
        {[
          { key: 'accounts', label: 'Accounts', icon: ReceiptText },
          { key: 'report', label: 'Report', icon: BarChart3 },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
          {/* Account list */}
          <section className="h-fit overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {data.accounts.map((a) => {
                const t = typeOf(a.type);
                const Icon = t.icon;
                const active = a.id === selectedId;
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => setSelectedId(a.id)}
                      className={`relative flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${active ? 'bg-indigo-50/50' : 'hover:bg-slate-50/70'} ${
                        !a.isActive ? 'opacity-60' : ''
                      }`}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-indigo-600" />}
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.tint}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800">{a.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {t.label}
                          {!a.isActive ? ' · Inactive' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold tabular-nums ${a.currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(a.currentBalance)}</p>
                        {a.pendingToday !== 0 && (
                          <p className="flex items-center justify-end gap-1 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3" />
                            {a.pendingToday > 0 ? '+' : ''}
                            {formatCurrency(a.pendingToday)} pending
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Selected account */}
          {selectedAccount && (
            <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <SelectedIcon type={selectedAccount.type} />
                  <div className="min-w-0">
                  <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    {selectedAccount.name}
                    {!selectedAccount.isActive && <Badge color="slate">Inactive</Badge>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {typeOf(selectedAccount.type).label}
                    {selectedAccount.accountNumber ? ` · No. ${selectedAccount.accountNumber}` : ''}
                  </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Balance</p>
                    <p className={`text-xl font-bold tabular-nums ${selectedAccount.currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                      {formatCurrency(selectedAccount.currentBalance)}
                    </p>
                    {selectedAccount.pendingToday !== 0 && (
                      <p className="text-[11px] text-slate-400">After close: {formatCurrency(selectedAccount.expectedAfterClose)}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditAccount(selectedAccount);
                          setFormOpen(true);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => setDeactivateAccount(selectedAccount)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {selectedAccount.isActive ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {selectedAccount.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="max-h-140 flex-1 overflow-y-auto px-5 py-4">
                {!transactions ? (
                  <p className="py-8 text-center text-sm text-slate-400">Loading transactions...</p>
                ) : groups.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-400">No transactions yet for this account.</p>
                ) : (
                  <div className="space-y-4">
                    {groups.map((g) => (
                      <div key={g.key}>
                        <p className="sticky top-0 z-10 -mx-5 bg-white/95 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur">
                          {g.label}
                        </p>
                        <ul className="divide-y divide-slate-100">
                          {g.items.map((t) => {
                            const isIn = t.direction === 'IN';
                            return (
                              <li key={t.id} className="flex items-center gap-3 py-2.5">
                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                  {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                                    {TXN_LABELS[t.type] || t.type}
                                    {t.status === 'PENDING' && <Badge color="amber">Pending</Badge>}
                                    {t.status === 'REVERSED' && <Badge color="slate">Reversed</Badge>}
                                  </p>
                                  <p className="truncate text-xs text-slate-400">{t.description}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className={`text-sm font-semibold tabular-nums ${isIn ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {isIn ? '+' : '−'}
                                    {formatCurrency(t.amount)}
                                  </p>
                                  <p className="text-xs text-slate-400">{timeOf(t.createdAt)}</p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                    {transactions.transactions.length >= 30 && <p className="text-center text-xs text-slate-400">Showing the latest 30 transactions.</p>}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      ) : (
        <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <DateRangeFilter
            range={reportRange}
            onRangeChange={(v) => {
              setReportRange(v);
              setReportFrom('');
              setReportTo('');
            }}
            from={reportFrom}
            to={reportTo}
            onFromChange={setReportFrom}
            onToChange={setReportTo}
          />
          {!report ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading report...</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50/80">
                    <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3">Account</th>
                      <th className="px-4 py-3 text-right">Opening</th>
                      <th className="px-4 py-3 text-right">Money In</th>
                      <th className="px-4 py-3 text-right">Money Out</th>
                      <th className="px-4 py-3 text-right">Current Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.accounts.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(a.openingBalance)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatCurrency(a.moneyIn)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-rose-600">{formatCurrency(a.moneyOut)}</td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${a.currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(a.currentBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot className="border-t border-slate-200 bg-slate-50/80 font-semibold">
                      <tr>
                        <td className="px-4 py-3 text-slate-800">Total</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency(totals.opening)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-800">{formatCurrency(totals.in)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-800">{formatCurrency(totals.out)}</td>
                        <td className={`px-4 py-3 text-right tabular-nums ${totals.current < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(totals.current)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {report.range && (
                <p className="mt-2 text-xs text-slate-400">
                  {formatDate(report.range.from)} – {formatDate(report.range.to)}
                </p>
              )}
            </>
          )}
        </section>
      )}

      <AccountFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} account={editAccount} />
      <ConfirmDialog
        open={!!deactivateAccount}
        title={deactivateAccount?.isActive ? 'Deactivate Account' : 'Reactivate Account'}
        message={
          deactivateAccount?.isActive
            ? `Deactivate "${deactivateAccount?.name}"? It will no longer be selectable for new payments, but its history is kept.`
            : `Reactivate "${deactivateAccount?.name}"? It will become selectable for new payments again.`
        }
        confirmLabel={deactivateAccount?.isActive ? 'Deactivate' : 'Reactivate'}
        variant={deactivateAccount?.isActive ? 'danger' : 'success'}
        loading={busy}
        onConfirm={handleToggleActive}
        onClose={() => setDeactivateAccount(null)}
      />
    </div>
  );
}

function SelectedIcon({ type }) {
  const t = typeOf(type);
  const Icon = t.icon;
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${t.tint}`}>
      <Icon className="h-5 w-5" />
    </div>
  );
}

function Summary({ label, value, hint, icon: Icon, tint = 'bg-slate-100 text-slate-500', valueClass = 'text-slate-900' }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-500">{label}</p>
        <p className={`text-lg font-bold leading-tight tabular-nums ${valueClass}`}>{value}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
