import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Wallet,
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
  BarChart3,
} from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import AccountFormModal from './AccountFormModal.jsx';

const TYPES = {
  MOBILE_MONEY: { label: 'Mobile Money', icon: Smartphone, card: 'from-emerald-500 to-teal-600' },
  BANK: { label: 'Bank', icon: Landmark, card: 'from-indigo-500 to-blue-600' },
  MERCHANT: { label: 'Merchant', icon: Store, card: 'from-amber-500 to-orange-600' },
  OTHER: { label: 'Other', icon: CircleDollarSign, card: 'from-slate-500 to-slate-700' },
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

// One account as a wallet card, coloured by account type.
function AccountCard({ account, active, onClick }) {
  const t = typeOf(account.type);
  const Icon = t.icon;
  const negative = account.currentBalance < 0;
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${t.card} p-5 text-left text-white shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        active ? 'ring-4 ring-indigo-300 ring-offset-2' : ''
      } ${!account.isActive ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-white/5" />
      <div className="relative flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex gap-1.5">
          {!account.isActive && <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-semibold">Inactive</span>}
          {active && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800">Selected</span>}
        </div>
      </div>
      <p className="relative mt-4 text-xs font-medium uppercase tracking-wider text-white/75">{t.label}</p>
      <p className="relative text-lg font-bold leading-tight">{account.name}</p>
      <p className={`relative mt-3 text-[28px] font-bold leading-none tracking-tight tabular-nums ${negative ? 'text-rose-100' : ''}`}>
        {formatCurrency(account.currentBalance)}
      </p>
      <div className="relative mt-2 min-h-[20px] space-y-1">
        {negative && <span className="inline-block rounded-full bg-rose-600/90 px-2 py-0.5 text-[11px] font-semibold">Negative balance</span>}
        {account.pendingToday !== 0 && (
          <p className="flex items-center gap-1 text-[11px] text-white/85">
            <Clock className="h-3 w-3" />
            Pending today {account.pendingToday > 0 ? '+' : ''}
            {formatCurrency(account.pendingToday)} · after close {formatCurrency(account.expectedAfterClose)}
          </p>
        )}
      </div>
    </button>
  );
}

export default function AccountsPage() {
  const toast = useToast();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const maxFlow = report ? Math.max(1, ...report.accounts.map((a) => Math.max(a.moneyIn, a.moneyOut))) : 1;

  // Group the selected account's transactions by calendar day.
  const groups = [];
  for (const t of transactions?.transactions || []) {
    const key = new Date(t.createdAt).toDateString();
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(t);
    else groups.push({ key, label: dayHeading(t.createdAt), items: [t] });
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg shadow-indigo-500/20 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-fuchsia-400/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
              <Wallet className="h-7 w-7" />
            </div>
            <div>
              <p className="text-sm text-indigo-100">Accounts · where money is received and paid</p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wider text-indigo-100">Total balance</p>
              <p className={`text-4xl font-bold leading-tight tabular-nums ${data.totalBalance < 0 ? 'text-rose-100' : ''}`}>{formatCurrency(data.totalBalance)}</p>
              <p className="mt-1 text-sm text-indigo-100">
                {activeCount} active account{activeCount === 1 ? '' : 's'}
                {data.accounts.length > activeCount ? ` · ${data.accounts.length - activeCount} inactive` : ''}
              </p>
              {canManage && (
                <button
                  onClick={() => {
                    setEditAccount(null);
                    setFormOpen(true);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50"
                >
                  <Plus className="h-4 w-4" /> New Account
                </button>
              )}
            </div>
          </div>
          {totals && (
            <div className="grid shrink-0 grid-cols-2 gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur sm:min-w-[340px]">
              <div>
                <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-indigo-100">
                  <ArrowDownLeft className="h-3.5 w-3.5" /> Money in
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(totals.in)}</p>
              </div>
              <div className="border-l border-white/20 pl-3">
                <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-indigo-100">
                  <ArrowUpRight className="h-3.5 w-3.5" /> Money out
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(totals.out)}</p>
              </div>
              <p className="col-span-2 text-xs text-indigo-100">For the period chosen in the Accounts Report below</p>
            </div>
          )}
        </div>
      </section>

      {/* Wallet cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.accounts.map((a) => (
          <AccountCard key={a.id} account={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
        ))}
      </div>

      {/* Transactions of the selected account */}
      {selectedAccount && (
        <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${typeOf(selectedAccount.type).card} text-white shadow-sm`}>
                <ReceiptText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                  {selectedAccount.name} · Transactions
                  {!selectedAccount.isActive && <Badge color="slate">Inactive</Badge>}
                </h3>
                <p className="text-xs text-slate-400">
                  Every change to this account's balance, with its reason
                  {selectedAccount.accountNumber ? ` · No. ${selectedAccount.accountNumber}` : ''}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditAccount(selectedAccount);
                    setFormOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={() => setDeactivateAccount(selectedAccount)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    selectedAccount.isActive ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {selectedAccount.isActive ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {selectedAccount.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            )}
          </div>

          <div className="p-5">
            {!transactions ? (
              <p className="py-8 text-center text-sm text-slate-400">Loading transactions...</p>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-slate-300 ring-1 ring-slate-100">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-400">No transactions yet for this account.</p>
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <div key={g.key}>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                      {g.items.map((t) => {
                        const isIn = t.direction === 'IN';
                        return (
                          <li key={t.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70">
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isIn ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
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
                {transactions.transactions.length >= 30 && (
                  <p className="text-center text-xs text-slate-400">Showing the latest 30 transactions.</p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Report */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Accounts Report</h3>
            <p className="text-xs text-slate-400">Money in and out of each account for the selected period</p>
          </div>
        </div>
        <div className="p-5">
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
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3 text-right">Opening</th>
                    <th className="px-4 py-3 text-right">Money In</th>
                    <th className="px-4 py-3 text-right">Money Out</th>
                    <th className="hidden px-4 py-3 md:table-cell">In / Out</th>
                    <th className="px-4 py-3 text-right">Current Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.accounts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-800">{a.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(a.openingBalance)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600">+{formatCurrency(a.moneyIn)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-rose-600">−{formatCurrency(a.moneyOut)}</td>
                      <td className="hidden w-44 px-4 py-3 md:table-cell">
                        <div className="space-y-1">
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(a.moneyIn / maxFlow) * 100}%` }} />
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-rose-500" style={{ width: `${(a.moneyOut / maxFlow) * 100}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${a.currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(a.currentBalance)}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-slate-50/80 font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-slate-800">Total</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatCurrency(totals.opening)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">+{formatCurrency(totals.in)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-rose-700">−{formatCurrency(totals.out)}</td>
                      <td className="hidden px-4 py-3 md:table-cell" />
                      <td className={`px-4 py-3 text-right tabular-nums ${totals.current < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{formatCurrency(totals.current)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          {report?.range && (
            <p className="mt-2 text-xs text-slate-400">
              {formatDate(report.range.from)} – {formatDate(report.range.to)}
            </p>
          )}
        </div>
      </section>

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
