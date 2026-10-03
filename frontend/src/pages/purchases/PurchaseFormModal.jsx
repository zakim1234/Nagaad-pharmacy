import { useEffect, useState } from 'react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormField, Input, Select } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import SupplierPicker from './SupplierPicker.jsx';

export default function PurchaseFormModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [amountPaid, setAmountPaid] = useState('0');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const refresh = () => client.get('/accounts').then(r => setAccounts(r.data.data.accounts.filter(a => a.isActive))).catch(() => toast.error('Could not load account balances.'));
  useEffect(() => { if (open) { refresh(); setSupplier(null); setAmount(''); setAmountPaid('0'); setAccountId(''); setSupplierInvoiceNumber(''); } }, [open]);
  const account = accounts.find(a => a.id === accountId);
  const paidNum = Number(amountPaid) || 0;
  const totalNum = Number(amount) || 0;
  const balanceDue = Math.max(0, totalNum - paidNum);
  const balanceAfter = account ? account.currentBalance - paidNum : null;
  const paymentStatus = paidNum <= 0 ? 'Unpaid' : paidNum >= totalNum ? 'Paid' : 'Partial';
  async function save() {
    if (!supplier || !Number.isFinite(totalNum) || totalNum <= 0) return toast.error('Select a supplier and enter a positive Total Amount.');
    if (paidNum > totalNum) return toast.error('Amount Paid cannot exceed the Total Amount.');
    if (paidNum > 0 && !account) return toast.error('Select the payment account this is being paid from.');
    setSaving(true);
    try {
      await client.post('/purchases', { supplierId: supplier.id, supplierInvoiceNumber, amount: totalNum, amountPaid: paidNum, purchaseAccountId: accountId || null });
      toast.success('Purchase invoice recorded.'); onSaved(); onClose();
    } catch (err) { toast.error(err.friendlyMessage || 'Could not save invoice.'); refresh(); }
    finally { setSaving(false); }
  }
  return <Modal open={open} onClose={onClose} title="New Purchase Invoice" size="md">
    <div className="space-y-4">
      <SupplierPicker active={supplier} onSelect={setSupplier} onClear={() => setSupplier(null)} />
      <FormField label="Our / Internal Invoice Number"><Input value="Automatically generated on save (PUR)" readOnly /></FormField>
      <FormField label="Supplier Invoice / Serial Number"><Input value={supplierInvoiceNumber} onChange={e => setSupplierInvoiceNumber(e.target.value)} /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Total Amount" required><Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></FormField>
        <FormField label="Amount Paid"><Input type="number" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} /></FormField>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span>Balance Due: <strong>{formatCurrency(balanceDue)}</strong></span>
        <span className={`font-semibold ${paymentStatus === 'Paid' ? 'text-emerald-600' : paymentStatus === 'Partial' ? 'text-amber-600' : 'text-slate-500'}`}>{paymentStatus}</span>
      </div>
      <FormField label="Payment Account" required={paidNum > 0}><Select value={accountId} onChange={e => { setAccountId(e.target.value); refresh(); }}><option value="">Select account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
      {account && paidNum > 0 && <div className={`rounded-lg p-3 text-sm ${balanceAfter < 0 ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'}`}>Available Balance: {formatCurrency(account.currentBalance)}<br />Balance After: <span className={balanceAfter < 0 ? 'font-bold text-rose-600' : ''}>{formatCurrency(balanceAfter)}</span></div>}
      {account && paidNum > 0 && balanceAfter < 0 && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>This account will go negative.</strong><p>Available: {formatCurrency(account.currentBalance)} · Required: {formatCurrency(paidNum)} · Shortfall: {formatCurrency(paidNum - account.currentBalance)}</p><p>The purchase can still be saved — the account balance will carry the shortfall until future receipts cover it.</p></div>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save Purchase Invoice</Button></div>
    </div>
  </Modal>;
}
