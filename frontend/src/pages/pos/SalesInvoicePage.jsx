import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, MoreHorizontal, Filter } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDateTime } from '../../utils/format.js';
import { BUSINESS } from '../../constants/business.js';
import { draftKey, readDraft, isDraftMeaningful } from '../../utils/posDraft.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useBusinessDay } from '../../hooks/useBusinessDay.js';
import DayClosedNotice from '../../components/DayClosedNotice.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { Input, Select, FormField } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import POSPage from './POSPage.jsx';

const STATUS = { DRAFT: 'Draft', CONFIRMED: 'Submitted', CANCELLED: 'Cancelled' };
export default function SalesInvoicePage() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const editParam = params.get('edit');
  // A brand-new, not-yet-saved invoice (never a specific ?edit=<id> draft,
  // which is resumed explicitly below) that the cashier left unfinished --
  // jump straight back into it instead of making them hit "+Add Sales
  // Invoice" again. Checked once per real visit to this page (a lazy
  // initializer, not on every re-render from filters/pagination changing).
  const [hasUnfinishedNewDraft] = useState(() => !editParam && isDraftMeaningful(readDraft(draftKey(user.id, 'new'))));
  const [filters, setFilters] = useState({ id: '', title: '', customerName: '', from: '', to: '', status: '', sortBy: 'updatedAt', sortDir: 'desc' });
  const debounced = useDebounce(filters, 250);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  // Locked for everyone after Close Day until the day is opened.
  const { closed } = useBusinessDay();
  const [settings, setSettings] = useState(false);
  const [compact, setCompact] = useState(false);
  const [showModified, setShowModified] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  useEffect(() => {
    if (editParam || hasUnfinishedNewDraft) return; // this render is about to show the invoice, not the list -- no need to load it
    let active = true;
    setLoading(true); setError('');
    client.get('/sales', { params: { ...debounced, page, limit: 20 } }).then(res => { if (active) setResult(res.data); }).catch(err => { if (active) setError(err.friendlyMessage || 'Unable to load sales invoices.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [debounced, page, refresh, editParam, hasUnfinishedNewDraft]);
  if (editParam) return <POSPage key={editParam} />;
  if (hasUnfinishedNewDraft) return <Navigate to="/pos/new" replace />;
  const setFilter = (key, value) => { setFilters(f => ({ ...f, [key]: value })); setPage(1); };
  const padding = compact ? 'px-3 py-2' : 'p-3';
  const addButton = closed ? <Button disabled title="The day is closed">+ Add Sales Invoice</Button> : <Link to="/pos/new"><Button>+ Add Sales Invoice</Button></Link>;
  return <div className="min-w-0 space-y-4">
    <PageHeader title="Sales Invoice" subtitle="Draft invoices are submitted by Close Day." actions={<div className="flex flex-wrap gap-2">{addButton}</div>} />
    {closed && <DayClosedNotice compact />}
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Select aria-label="List View" value={compact ? 'compact' : 'list'} onChange={e => setCompact(e.target.value === 'compact')}><option value="list">List View</option><option value="compact">Compact List View</option></Select><Button variant="secondary" aria-label="Refresh invoices" onClick={() => setRefresh(n => n + 1)} disabled={loading}><RefreshCw size={16} /></Button><Button variant="secondary" aria-label="Toggle filters" aria-expanded={showFilters} onClick={() => setShowFilters(v => !v)}><Filter size={16} /></Button></div><div className="flex items-center gap-2"><Select aria-label="Last Updated On sorting" value={filters.sortDir} onChange={e => setFilter('sortDir', e.target.value)}><option value="desc">Last Updated On: Newest</option><option value="asc">Last Updated On: Oldest</option></Select><Button variant="secondary" aria-label="Invoice list settings" aria-expanded={settings} onClick={() => setSettings(v => !v)}><MoreHorizontal size={16} /></Button></div></div>
    {settings && <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={showModified} onChange={e => setShowModified(e.target.checked)} /> Show Last Modified column</label></div>}
    {showFilters && <Card><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FormField label="ID"><Input value={filters.id} onChange={e => setFilter('id', e.target.value)} placeholder="INV-…" /></FormField>
      <FormField label="Title"><Input value={filters.title} onChange={e => setFilter('title', e.target.value)} placeholder="Invoice title (customer name)" /></FormField>
      <FormField label="Customer"><Input value={filters.customerName} onChange={e => setFilter('customerName', e.target.value)} placeholder="Customer name" /></FormField>
      <FormField label="Company"><Input value={BUSINESS.name} readOnly title="This system contains one company" /></FormField>
      <FormField label="Posting Date From"><Input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} /></FormField>
      <FormField label="Posting Date To"><Input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} /></FormField>
      <FormField label="Status"><Select value={filters.status} onChange={e => setFilter('status', e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></FormField>
      <div className="flex items-end"><Button variant="secondary" onClick={() => { setFilters({ id: '', title: '', customerName: '', from: '', to: '', status: '', sortBy: 'updatedAt', sortDir: 'desc' }); setPage(1); }}>Clear Filters</Button></div>
    </div></Card>}
    <Card><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500">{['Title', 'Status', 'Grand Total', 'Outstanding Amount', 'Paid Amount', 'ID', ...(showModified ? ['Last Modified'] : [])].map(label => <th key={label} className={padding}>{label}</th>)}</tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading invoices…</td></tr> : error ? <tr><td colSpan={7} className="p-8 text-center text-rose-700">{error}</td></tr> : !result?.data.length ? <tr><td colSpan={7} className="p-10 text-center"><p className="mb-3 text-slate-500">No sales invoices found.</p>{addButton}</td></tr> : result.data.map(sale => <tr key={sale.id} className="border-b border-slate-100 hover:bg-slate-50">
        <td className={padding}><Link className="font-medium text-indigo-700 hover:underline" to={`/receipt/${sale.id}`}>{sale.customerName}</Link>{sale.status === 'DRAFT' && !sale.quotation && <Link className="ml-2 text-xs text-slate-500 underline" to={`/pos?edit=${sale.id}`}>Edit</Link>}</td>
        <td className={padding}><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${sale.status === 'DRAFT' ? 'bg-amber-50 text-amber-700' : sale.status === 'CONFIRMED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS[sale.status] || sale.status}</span></td>
        <td className={`${padding} tabular-nums`}>{formatCurrency(sale.total)}</td><td className={`${padding} tabular-nums`}>{formatCurrency(sale.status === 'DRAFT' ? sale.balanceAdded : sale.status === 'CANCELLED' ? 0 : sale.outstanding)}</td><td className={`${padding} tabular-nums`}>{formatCurrency(sale.settledPaidAmount)}</td><td className={padding}><Link className="text-indigo-700 hover:underline" to={`/receipt/${sale.id}`}>{sale.receiptNumber}</Link></td>{showModified && <td className={`${padding} text-xs text-slate-500`}>{formatDateTime(sale.updatedAt || sale.createdAt)}</td>}
      </tr>)}
    </tbody></table></div>{result && !error && <Pagination {...result.pagination} onChange={setPage} />}</Card>
  </div>;
}
