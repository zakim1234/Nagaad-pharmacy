import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatCurrency, formatDate } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import { Input, Select, FormField } from '../../components/ui/Field.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import DateRangeFilter from '../../components/reports/DateRangeFilter.jsx';
import PrintReportHeader from '../../components/reports/PrintReportHeader.jsx';
import { printReport } from '../../utils/printReport.js';

const STATUSES = ['Pending', 'Accepted', 'Rejected', 'Expired', 'Converted'];

// Search-as-you-type customer picker used to scope the Quotation Report to
// one customer's quotations. Uses the same /customers/search endpoint as
// the rest of the app so results always reflect real customer records.
function CustomerFilterSelect({ customer, onSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(query, 250);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    client.get('/customers/search', { params: { q: debounced } }).then((res) => setResults(res.data.data)).catch(() => setResults([]));
  }, [debounced]);

  useEffect(() => {
    const onClickOutside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  if (customer) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
        <span className="font-medium text-slate-800">{customer.name}</span>
        <button type="button" onClick={onClear} className="text-slate-400 hover:text-rose-600" aria-label="Clear customer filter">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search customer..."
      />
      {open && query.trim() && (
        <div className="absolute z-30 mt-1 w-full min-w-60 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-400">No matching customers</div>
          ) : (
            <ul className="max-h-60 overflow-y-auto py-1">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onSelect(c); setQuery(''); setOpen(false); }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    {c.name}{c.phone ? <span className="ml-1.5 text-xs text-slate-400">{c.phone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
export default function QuotationsPage({ report = false }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const search = useDebounce(q, 250);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [customer, setCustomer] = useState(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { q: search, status, page, limit: 20, customer: customer?.id || undefined, ...(from || to ? { from, to } : range !== 'all' ? { range } : {}) };
    Promise.all([client.get('/quotations', { params }), report ? client.get('/reports/quotations', { params }) : Promise.resolve(null)])
      .then(([rows, stats]) => { if (active) { setResult(rows.data); setSummary(stats?.data.data); } })
      .catch(err => { if (active) { setResult(null); toast.error(err.friendlyMessage || 'Unable to load quotations.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, status, range, from, to, customer, page, refresh, report]);
  return <div className="space-y-4 min-w-0">
    <PageHeader title={report ? 'Quotation Report' : 'Quotation'} subtitle="Pre-sale documents; no stock or financial posting until an invoice is created and confirmed." actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh</Button>{report ? <Button onClick={() => printReport('landscape')} disabled={loading}>Print Report</Button> : <Link to="/quotations/new"><Button>+ Add Quotation</Button></Link>}</div>} />
    <div className="grid gap-3 sm:grid-cols-3 no-print">
      <FormField label="Quotation Number / Customer"><Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search quotations" /></FormField>
      <FormField label="Status"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select></FormField>
      <FormField label="Customer"><CustomerFilterSelect customer={customer} onSelect={c => { setCustomer(c); setPage(1); }} onClear={() => { setCustomer(null); setPage(1); }} /></FormField>
    </div>
    <DateRangeFilter allowAll range={range} onRangeChange={value => { setRange(value); setFrom(''); setTo(''); setPage(1); }} from={from} to={to} onFromChange={v => { setFrom(v); setPage(1); }} onToChange={v => { setTo(v); setPage(1); }} />
    <div id={report ? 'print-area' : undefined}>
      {report && <PrintReportHeader title="Quotation Report" rangeLabel={[customer ? `Customer: ${customer.name}` : null, status || 'All statuses', from || to ? `${from || 'Start'} – ${to || 'Today'}` : range].filter(Boolean).join(' · ')} />}
      {report && summary && <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[['Total Quotations', summary.totalQuotations], ...STATUSES.map(s => [`${s} Quotations`, summary.counts[s]]), ['Total Quotation Amount', formatCurrency(summary.totalQuotationAmount)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-semibold">{value}</p></div>)}</div>}
      <Card><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500">{['Quotation', 'Customer', 'Date', 'Expiry Date', 'Status', 'Discount', 'Grand Total', 'Converted Invoice'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>
        {loading ? <tr><td colSpan={8} className="p-8 text-center">Loading quotations…</td></tr> : !result ? <tr><td colSpan={8} className="p-8 text-center">Unable to load quotations. Please refresh.</td></tr> : result.data.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-slate-500">No quotations found.</td></tr> : result.data.map(row => <tr key={row.id} className="border-b border-slate-100"><td className="p-3"><Link className="text-indigo-700 hover:underline" to={`/quotations/${row.id}`}>{row.quotationNumber}</Link></td><td className="p-3">{row.customerName}</td><td className="p-3">{formatDate(row.date)}</td><td className="p-3">{formatDate(row.expiryDate)}</td><td className="p-3">{row.status}</td><td className="p-3 tabular-nums">{formatCurrency(row.totalDiscount)}</td><td className="p-3 tabular-nums">{formatCurrency(row.grandTotal)}</td><td className="p-3">{row.convertedInvoice ? <Link className="text-indigo-700 hover:underline" to={`/receipt/${row.convertedInvoice}`}>{row.convertedInvoiceNumber}</Link> : '—'}</td></tr>)}
      </tbody></table></div>{result && <div className="no-print"><Pagination {...result.pagination} onChange={setPage} /></div>}</Card>
      {report && <p className="mt-3 text-xs text-slate-500">Totals cover all matching quotations. Detail table: page {page} of {result?.pagination.pages || 1}. Open a quotation to view its products, prices and discounts. Quotation amounts are not sales revenue.</p>}
    </div>
  </div>;
}
