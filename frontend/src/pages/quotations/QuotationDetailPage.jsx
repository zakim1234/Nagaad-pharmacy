import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import SharePdfButton from '../../components/SharePdfButton.jsx';
import DocHeader, { DocInfo, DocSummary, DocFooter, DOC_TH, DOC_THEAD_ROW, docRow } from '../../components/docs/DocHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { FormField, Input, Textarea } from '../../components/ui/Field.jsx';
import CustomerSearchBox from '../pos/CustomerSearchBox.jsx';
import QuotationItemsGrid from './QuotationItemsGrid.jsx';

const today = () => new Date().toISOString().slice(0, 10);
export default function QuotationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [quotation, setQuotation] = useState(null);
  const [editing, setEditing] = useState(!id);
  const [customer, setCustomer] = useState(null);
  const [items, setItems] = useState([]);
  const [date, setDate] = useState(today);
  const [expiryDate, setExpiryDate] = useState(today);
  const [discount, setDiscount] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState('');
  const fill = q => { setQuotation(q); setCustomer({ id: q.customer, name: q.customerName, phone: q.customerPhone, balance: 0 }); setItems(q.items); setDate(q.date.slice(0, 10)); setExpiryDate(q.expiryDate.slice(0, 10)); setDiscount(String(q.discount)); setNotes(q.notes); };
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    client.get(`/quotations/${id}`).then(res => { if (active) { fill(res.data.data); setEditing(false); } }).catch(err => { if (active) setError(err.friendlyMessage || 'Quotation not found.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  const addLine = product => setItems(rows => rows.some(i => i.itemId === product.id) ? rows.map(i => i.itemId === product.id ? { ...i, quantity: Number(i.quantity) + 1 } : i) : [...rows, { itemId: product.id, name: product.name, itemCode: product.itemCode || '', serialNumber: product.serialNumber || '', quantity: 1, unitPrice: product.sellingPrice, discount: 0 }]);
  const save = async () => {
    if (busy) return;
    if (!customer) return toast.error('Please select a customer.');
    setBusy(true);
    try {
      const payload = { customerId: customer.id, items: items.map(i => ({ itemId: i.itemId, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })), date, expiryDate, discount, notes };
      const res = id ? await client.put(`/quotations/${id}`, payload) : await client.post('/quotations', payload);
      fill(res.data.data); setEditing(false);
      toast.success(id ? 'Quotation updated successfully.' : 'Quotation created successfully.');
      if (!id) navigate(`/quotations/${res.data.data.id}`, { replace: true });
    } catch (err) { toast.error(err.friendlyMessage || 'Unable to save quotation.'); } finally { setBusy(false); }
  };
  const changeStatus = async status => {
    setBusy(true);
    try { const res = await client.patch(`/quotations/${id}/status`, { status }); fill(res.data.data); toast.success(`Quotation ${status.toLowerCase()}.`); }
    catch (err) { toast.error(err.friendlyMessage || 'Unable to update status.'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this quotation? This cannot be undone.')) return;
    setBusy(true);
    try { await client.delete(`/quotations/${id}`); navigate('/quotations'); toast.success('Quotation deleted.'); }
    catch (err) { toast.error(err.friendlyMessage || 'Unable to delete quotation.'); } finally { setBusy(false); }
  };
  const changeLine = (itemId, key, value) => setItems(rows => rows.map(i => i.itemId === itemId ? { ...i, [key]: value } : i));
  const subtotal = items.reduce((sum, i) => sum + Math.round(Number(i.unitPrice || 0) * 100) * Number(i.quantity || 0), 0) / 100;
  const totalDiscount = items.reduce((sum, i) => sum + Math.round(Number(i.discount || 0) * 100), Math.round(Number(discount || 0) * 100)) / 100;
  if (loading) return <p>Loading quotation…</p>;
  if (error) return <p className="text-rose-700">{error}</p>;
  return <div className="space-y-4 min-w-0">
    <Link className="text-sm text-brand-700 no-print" to="/quotations">← Quotations</Link>
    <div className="no-print"><PageHeader title={id ? quotation?.quotationNumber : 'New Quotation'} actions={<div className="flex flex-wrap gap-2">
      {editing ? <><Button onClick={save} loading={busy}>Save Quotation</Button>{id && <Button variant="secondary" disabled={busy} onClick={() => { fill(quotation); setEditing(false); }}>Cancel Edit</Button>}</> : <>
        <SharePdfButton fileName={`Quotation-${quotation?.quotationNumber}`} phone={quotation?.customerPhone} message={`${BUSINESS.name} — Quotation ${quotation?.quotationNumber}: ${formatCurrency(quotation?.grandTotal || 0)}`} /><Button variant="secondary" onClick={() => printReport('portrait')}>Print</Button>
        {quotation?.status === 'Pending' && <><Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</Button><Button disabled={busy} onClick={() => changeStatus('Accepted')}>Accept</Button></>}
        {['Pending', 'Accepted'].includes(quotation?.status) && <Button variant="secondary" disabled={busy} onClick={() => changeStatus('Rejected')}>Reject</Button>}
        {quotation?.status === 'Accepted' && <Link to={`/pos/new?quotation=${id}`}><Button>Convert to Invoice</Button></Link>}
        {['admin', 'manager'].includes(user?.role) && ['Pending', 'Rejected', 'Expired'].includes(quotation?.status) && <Button variant="secondary" disabled={busy} onClick={remove}>Delete</Button>}
      </>}
    </div>} /></div>
    {editing ? <>
      <Card><CustomerSearchBox activeCustomer={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} /></Card>
      <Card><div className="grid gap-3 sm:grid-cols-2"><FormField label="Date" required><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></FormField><FormField label="Expiry Date" required><Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></FormField></div></Card>
      <Card title="Items"><div className="space-y-3">
        <QuotationItemsGrid items={items} onAddLine={addLine} onChangeLine={changeLine} onRemoveLine={itemId => setItems(rows => rows.filter(r => r.itemId !== itemId))} subtotal={subtotal} discount={discount} onDiscountChange={setDiscount} totalDiscount={totalDiscount} />
        <FormField label="Notes"><Textarea maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></FormField>
      </div></Card>
    </> : quotation && <div id="print-area" className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 text-neutral-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <DocHeader title="Quotation" meta={<span className="font-semibold">{quotation.quotationNumber}</span>} />
      <DocInfo
        left={['Prepared for', quotation.customerName, quotation.customerPhone]}
        right={['Date', formatDate(quotation.date), `Valid until ${formatDate(quotation.expiryDate)}`, `Status: ${quotation.status}`]}
      />
      <table className="mt-4 w-full border-collapse text-xs sm:text-sm">
        <thead>
          <tr className={`${DOC_THEAD_ROW} text-left`}>
            <th className={`${DOC_TH} w-10`}>#</th>
            <th className={DOC_TH}>Item</th>
            <th className={`${DOC_TH} text-center`}>Qty</th>
            <th className={`${DOC_TH} text-right`}>Unit price</th>
            <th className={`${DOC_TH} text-right`}>Discount</th>
            <th className={`${DOC_TH} text-right`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {quotation.items.map((i, index) => (
            <tr key={i.itemId} className={docRow(index)}>
              <td className="px-2 py-2 text-neutral-500">{index + 1}</td>
              <td className="px-2 py-2 font-medium">{i.name}</td>
              <td className="px-2 py-2 text-center">{i.quantity}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(i.unitPrice)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{i.discount > 0 ? formatCurrency(i.discount) : '—'}</td>
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <DocSummary
        lines={[['Subtotal', formatCurrency(quotation.subtotal)], quotation.totalDiscount > 0 && ['Total discount', `-${formatCurrency(quotation.totalDiscount)}`]]}
        grand={['Grand Total', formatCurrency(quotation.grandTotal)]}
      />
      {quotation.notes && <p className="mt-5 whitespace-pre-wrap break-words rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600"><span className="font-semibold">Notes:</span> {quotation.notes}</p>}
      {quotation.convertedInvoice && <p className="mt-4 text-sm no-print">Converted to: <Link className="text-brand-700 underline" to={`/receipt/${quotation.convertedInvoice}`}>{quotation.convertedInvoiceNumber}</Link></p>}
      <DocFooter>This quotation is valid until {formatDate(quotation.expiryDate)} and is not a payment receipt. Thank you for your business.</DocFooter>
    </div>}
  </div>;
}
