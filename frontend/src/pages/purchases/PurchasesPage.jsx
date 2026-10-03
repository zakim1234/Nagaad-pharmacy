import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Ban, Printer, Search } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { Table, THead, Th, TBody, Td, TableEmpty, TableLoading } from '../../components/ui/Table.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Badge from '../../components/ui/Badge.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import PurchaseFormModal from './PurchaseFormModal.jsx';

const PAYMENT_STATUS_COLOR = { Unpaid: 'slate', Partial: 'amber', Paid: 'green' };

export default function PurchasesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [voidItem, setVoidItem] = useState(null);
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    client
      .get('/purchases', { params: { page, limit: 20, q: debouncedQ || undefined, paymentStatus: paymentStatus || undefined } })
      .then((res) => {
        setItems(res.data.data);
        setPagination(res.data.pagination);
      })
      .catch((err) => toast.error(err.friendlyMessage || 'Failed to load purchases.'))
      .finally(() => setLoading(false));
  }, [page, debouncedQ, paymentStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setPage(1), [debouncedQ, paymentStatus]);

  useEffect(() => load(), [load]);

  const canVoid = user?.role === 'admin' || user?.role === 'manager';

  const handleVoid = async () => {
    setVoiding(true);
    try {
      await client.post(`/purchases/${voidItem.id}/void`, { reason: 'Voided by staff' });
      toast.success('Purchase voided and stock reversed.');
      setVoidItem(null);
      load();
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not void this purchase.');
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Purchase Invoices"
        subtitle="Record invoices for goods purchased from suppliers"
        actions={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> New Purchase Invoice
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search by invoice number or supplier..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
          <option value="">All Payment Statuses</option>
          <option value="Unpaid">Unpaid</option>
          <option value="Partial">Partial</option>
          <option value="Paid">Paid</option>
        </Select>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Internal Invoice</Th>
            <Th>Supplier Invoice</Th>
            <Th>Supplier</Th>
            <Th>Total / Balance</Th>
            <Th>Payment Status</Th>
            <Th>Date</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </THead>
        <TBody>
          {loading ? (
            <TableLoading colSpan={8} />
          ) : items.length === 0 ? (
            <TableEmpty colSpan={8} message="No purchase invoices recorded yet." />
          ) : (
            items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td>
                  <Link to={`/purchases/${p.id}`} className="font-medium text-indigo-600 hover:underline">{p.purchaseNumber}</Link>
                </Td>
                <Td>{p.supplierInvoiceNumber || '—'}</Td>
                <Td>{p.supplierName}</Td>
                <Td>
                  {formatCurrency(p.totalCost)}
                  {p.balance > 0 && <div className="text-xs font-semibold text-rose-600">Owed: {formatCurrency(p.balance)}</div>}
                </Td>
                <Td>
                  <Badge color={PAYMENT_STATUS_COLOR[p.paymentStatus]}>{p.paymentStatus}</Badge>
                </Td>
                <Td>{formatDateTime(p.createdAt)}</Td>
                <Td>
                  <Badge color={p.status === 'voided' ? 'red' : 'green'}>{p.status === 'voided' ? 'Voided' : 'Completed'}</Badge>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Link to={`/purchases/${p.id}/receipt`} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Print">
                      <Printer className="h-4 w-4" />
                    </Link>
                    {canVoid && p.status !== 'voided' && (
                      <button onClick={() => setVoidItem(p)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Void purchase">
                        <Ban className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TBody>
      </Table>
      <div className="rounded-b-xl border border-t-0 border-slate-200 bg-white">
        <Pagination {...pagination} onChange={setPage} />
      </div>

      <PurchaseFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={load} />
      <ConfirmDialog
        open={!!voidItem}
        title="Void Purchase"
        message={`Void purchase "${voidItem?.purchaseNumber}"? This will reverse the stock increase it caused.`}
        confirmLabel="Void Purchase"
        loading={voiding}
        onConfirm={handleVoid}
        onClose={() => setVoidItem(null)}
      />
    </div>
  );
}
