import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';
import { printReport } from '../../utils/printReport.js';
import { BUSINESS } from '../../constants/business.js';
import logo from '../../images/logo.png';
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
  const addLine = product => setItems(rows => rows.some(i => i.itemId === product.id) ? rows.map(i => i.itemId === product.id ? { ...i, quantity: Number(i.quantity) + 1 } : i) : [...rows, { itemId: product.id, name: product.name, quantity: 1, unitPrice: product.sellingPrice, discount: 0 }]);
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
    <Link className="text-sm text-indigo-700 no-print" to="/quotations">← Quotations</Link>
    <div className="no-print"><PageHeader title={id ? quotation?.quotationNumber : 'New Quotation'} actions={<div className="flex flex-wrap gap-2">
      {editing ? <><Button onClick={save} loading={busy}>Save Quotation</Button>{id && <Button variant="secondary" disabled={busy} onClick={() => { fill(quotation); setEditing(false); }}>Cancel Edit</Button>}</> : <>
        <Button variant="secondary" onClick={() => printReport('portrait')}>Print</Button>
        {quotation?.status === 'Pending' && <><Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</Button><Button disabled={busy} onClick={() => changeStatus('Accepted')}>Accept</Button></>}
        {['Pending', 'Accepted'].includes(quotation?.status) && <Button variant="secondary" disabled={busy} onClick={() => changeStatus('Rejected')}>Reject</Button>}
        {quotation?.status === 'Accepted' && <Link to={`/pos/new?quotation=${id}`}><Button>Convert to Invoice</Button></Link>}
        {['admin', 'manager'].includes(user?.role) && ['Pending', 'Rejected', 'Expired'].includes(quotation?.status) && <Button variant="secondary" disabled={busy} onClick={remove}>Delete</Button>}
      </>}
    </div>} /></div>
    {editing ? <>
      <Card><CustomerSearchBox activeCustomer={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} /></Card>
      <Card><div className="grid gap-3 sm:grid-cols-2"><FormField label="Date" required><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></FormField><FormField label="Expiry Date" required><Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} /></FormField></div></Card>
      <Card title="Quotation Items"><div className="space-y-3">
        <QuotationItemsGrid items={items} onAddLine={addLine} onChangeLine={changeLine} onRemoveLine={itemId => setItems(rows => rows.filter(r => r.itemId !== itemId))} />
        <FormField label="Additional Discount"><Input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} className="max-w-40" /></FormField>
        <p className="text-right text-sm">Subtotal: {formatCurrency(subtotal)} · Discount: {formatCurrency(totalDiscount)}</p><p className="text-right font-semibold">Grand Total: {formatCurrency(subtotal - totalDiscount)}</p>
        <FormField label="Notes"><Textarea maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></FormField>
      </div></Card>
    </> : quotation && <div id="print-area" className="mx-auto max-w-4xl rounded-lg border border-slate-200 bg-white p-4 sm:p-8 print:border-0 print:p-0">
      <div className="text-center"><img src={logo} alt={BUSINESS.name} className="mx-auto h-16 w-auto" /><h1 className="font-bold">{BUSINESS.name}</h1><p className="text-xs">{BUSINESS.addressLine} · {BUSINESS.phone}</p><h2 className="my-4 text-xl font-bold">QUOTATION</h2></div>
      <div className="mb-4 flex flex-wrap justify-between gap-4 text-sm"><div><strong>{quotation.customerName}</strong><p>{quotation.customerPhone}</p></div><div><strong>{quotation.quotationNumber}</strong><p>Date: {formatDate(quotation.date)}</p><p>Expiry Date: {formatDate(quotation.expiryDate)}</p><p>Status: {quotation.status}</p></div></div>
      <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-left text-xs sm:text-sm"><thead><tr className="border-y border-slate-300">{['NO', 'ITEM', 'QTY', 'UNIT PRICE', 'DISCOUNT', 'AMOUNT'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{quotation.items.map((i, index) => <tr key={i.itemId} className="border-b border-slate-100"><td className="p-2">{index + 1}</td><td className="p-2">{i.name}</td><td className="p-2">{i.quantity}</td><td className="p-2">{formatCurrency(i.unitPrice)}</td><td className="p-2">{formatCurrency(i.discount)}</td><td className="p-2">{formatCurrency(i.lineTotal)}</td></tr>)}</tbody></table></div>
      <div className="ml-auto mt-4 max-w-xs space-y-2 text-sm"><p className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(quotation.subtotal)}</span></p><p className="flex justify-between"><span>Total Discount</span><span>{formatCurrency(quotation.totalDiscount)}</span></p><p className="flex justify-between border-t pt-2 font-bold"><span>Grand Total</span><span>{formatCurrency(quotation.grandTotal)}</span></p></div>
      {quotation.notes && <p className="mt-6 whitespace-pre-wrap break-words text-sm">Notes: {quotation.notes}</p>}
      {quotation.convertedInvoice && <p className="mt-4 text-sm">Converted to: <Link className="text-indigo-700 underline" to={`/receipt/${quotation.convertedInvoice}`}>{quotation.convertedInvoiceNumber}</Link></p>}
      <p className="mt-8 border-t pt-3 text-center text-xs text-slate-500">Thank you for your business. This quotation is valid through its expiry date and is not a payment receipt.</p>
    </div>}
  </div>;
}
