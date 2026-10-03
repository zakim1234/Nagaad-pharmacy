import { useCallback, useEffect, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Modal from '../../components/ui/Modal.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { Select } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import ExpenseFormModal from './ExpenseFormModal.jsx';

const DEFAULT_CATEGORIES = ['Salaries', 'Transport', 'Rent', 'Other'];

export default function ExpensesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canVoid = user?.role === 'admin' || user?.role === 'manager';

  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(() => {
    const params = from || to ? { from: from || undefined, to: to || undefined } : { range };
    if (category) params.category = category;
    client
      .get('/expenses', { params })
      .then((res) => setData(res.data.data))
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load expenses.'));
  }, [range, from, to, category]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const confirmVoid = async () => {
    setVoiding(true);
    try {
      await client.post(`/expenses/${voidTarget.id}/void`, { reason: voidReason });
      toast.success('Expense voided and the amount returned to the account.');
      setVoidTarget(null);
      setVoidReason('');
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not void expense.');
    } finally {
      setVoiding(false);
    }
  };

  const categories = data?.categories || DEFAULT_CATEGORIES;

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Money paid out for running the business. Each expense is deducted from the account it was paid from."
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add Expense
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <StatCard label="Total This Month" value={data ? formatCurrency(data.summary.totalThisMonth) : '…'} icon={Receipt} tone="rose" />
        <StatCard label="Total (current filter)" value={data ? formatCurrency(data.summary.totalFiltered) : '…'} icon={Receipt} tone="indigo" />
      </div>

      <DateRangeFilter
        range={range}
        onRangeChange={(v) => {
          setRange(v);
          setFrom('');
          setTo('');
        }}
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />
      <div className="mb-4 w-56">
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Date</Th>
            <Th>No.</Th>
            <Th>Category</Th>
            <Th>Amount</Th>
            <Th>Note</Th>
            <Th>Paid From</Th>
            <Th>By</Th>
            {canVoid && <Th />}
          </tr>
        </THead>
        <TBody>
          {data === null ? (
            <TableLoading colSpan={canVoid ? 8 : 7} />
          ) : data.expenses.length === 0 ? (
            <TableEmpty colSpan={canVoid ? 8 : 7} message="No expenses found for this filter." />
          ) : (
            data.expenses.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(e.date)}</Td>
                <Td className="font-mono text-xs text-slate-500">{e.expenseNumber}</Td>
                <Td>{e.category}</Td>
                <Td className="font-medium text-slate-900">{formatCurrency(e.amount)}</Td>
                <Td>{e.note || '—'}</Td>
                <Td>{e.paymentAccountName}</Td>
                <Td>{e.createdByName || '—'}</Td>
                {canVoid && (
                  <Td>
                    {e.status === 'VOIDED' ? (
                      <Badge color="slate">Voided</Badge>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setVoidTarget(e)}>
                        Void
                      </Button>
                    )}
                  </Td>
                )}
              </tr>
            ))
          )}
        </TBody>
      </Table>

      <ExpenseFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} categories={categories} onCategoriesChanged={load} />

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="Void Expense" size="sm">
        <p className="text-sm text-slate-600">
          Void {voidTarget?.expenseNumber} ({voidTarget && formatCurrency(voidTarget.amount)})? The amount goes back into{' '}
          <strong>{voidTarget?.paymentAccountName}</strong> and the expense no longer counts in reports.
        </p>
        <input
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          placeholder="Reason (optional)"
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          maxLength={200}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setVoidTarget(null)} disabled={voiding}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmVoid} loading={voiding}>
            Void Expense
          </Button>
        </div>
      </Modal>
    </div>
  );
}
