import { useCallback, useEffect, useState } from 'react';
import { Plus, Wallet, Pencil, Ban, CheckCircle2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { PageSpinner } from '../../components/ui/Spinner.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import AccountFormModal from './AccountFormModal.jsx';

const TYPE_LABELS = {
  MOBILE_MONEY: 'Mobile Money',
  BANK: 'Bank',
  MERCHANT: 'Merchant',
  OTHER: 'Other',
};

const TXN_LABELS = {
  SALE_PAYMENT: 'Sale Payment',
  PURCHASE_PAYMENT: 'Purchase Payment',
  REFUND: 'Refund',
  DEPOSIT: 'Deposit',
  WITHDRAWAL: 'Withdrawal',
  ADJUSTMENT: 'Adjustment',
};

function AccountCard({ account, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left shadow-sm transition-colors ${
        active ? 'border-indigo-400 bg-indigo-50/60 ring-1 ring-indigo-200' : 'border-slate-200 bg-white hover:border-indigo-200'
      } ${!account.isActive ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{TYPE_LABELS[account.type] || account.type}</p>
          <p className="mt-0.5 text-base font-bold text-slate-900">{account.name}</p>
        </div>
        {!account.isActive && <Badge color="slate">Inactive</Badge>}
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums ${account.currentBalance < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(account.currentBalance)}</p>
      {account.currentBalance < 0 && <p className="mt-0.5 text-xs font-semibold text-rose-600">Negative balance</p>}
      {account.pendingToday !== 0 && (
        <p className={`mt-1 text-xs font-medium ${account.pendingToday > 0 ? 'text-amber-600' : 'text-rose-600'}`}>
          Pending Today: {account.pendingToday > 0 ? '+' : ''}
          {formatCurrency(account.pendingToday)} · Expected After Close: {formatCurrency(account.expectedAfterClose)}
        </p>
      )}
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

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle="Where money is received and paid across the business"
        actions={
          canManage && (
            <Button
              onClick={() => {
                setEditAccount(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New Account
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-100 p-2.5 text-indigo-600">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Balance Across Accounts</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{formatCurrency(data.totalBalance)}</p>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.accounts.map((a) => (
          <AccountCard key={a.id} account={a} active={a.id === selectedId} onClick={() => setSelectedId(a.id)} />
        ))}
      </div>

      {selectedAccount && (
        <Card
          title={`${selectedAccount.name} · Transactions`}
          subtitle="Every change to this account's balance, with its reason"
          actions={
            canManage && (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditAccount(selectedAccount);
                    setFormOpen(true);
                  }}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Edit account"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDeactivateAccount(selectedAccount)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title={selectedAccount.isActive ? 'Deactivate account' : 'Reactivate account'}
                >
                  {selectedAccount.isActive ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                </button>
              </div>
            )
          }
        >
          {!transactions ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading transactions...</p>
          ) : transactions.transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No transactions yet for this account.</p>
          ) : (
            <div className="space-y-2">
              {transactions.transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2.5">
                    {t.direction === 'IN' ? (
                      <ArrowDownCircle className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-rose-500" />
                    )}
                    <div>
                      <p className="font-medium text-slate-800">{TXN_LABELS[t.type] || t.type}</p>
                      <p className="text-xs text-slate-400">{t.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    {t.status === 'PENDING' && <Badge color="amber">Pending</Badge>}
                    {t.status === 'REVERSED' && <Badge color="slate">Reversed</Badge>}
                    <div>
                      <p className={`font-semibold tabular-nums ${t.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {t.direction === 'IN' ? '+' : '-'}
                        {formatCurrency(t.amount)}
                      </p>
                      <p className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title="Accounts Report" subtitle="Money in / out by account for the selected period" className="mt-6">
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase text-slate-500">
                  <th className="py-2">Account</th>
                  <th className="py-2 text-right">Opening Balance</th>
                  <th className="py-2 text-right">Money In</th>
                  <th className="py-2 text-right">Money Out</th>
                  <th className="py-2 text-right">Current Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 font-medium text-slate-800">{a.name}</td>
                    <td className="py-2 text-right text-slate-500">{formatCurrency(a.openingBalance)}</td>
                    <td className="py-2 text-right text-emerald-600">+{formatCurrency(a.moneyIn)}</td>
                    <td className="py-2 text-right text-rose-600">-{formatCurrency(a.moneyOut)}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">{formatCurrency(a.currentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
