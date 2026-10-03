import { draftKey, readDraft, writeDraft, clearDraft, isDraftMeaningful } from '../../utils/posDraft.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ShoppingCart, ClipboardList, Lock, Pencil, ChevronDown, ArrowLeft } from 'lucide-react';
import client from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../utils/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { Input, Label, Textarea } from '../../components/ui/Field.jsx';
import AccountSelect from '../../components/AccountSelect.jsx';
import CustomerSearchBox from './CustomerSearchBox.jsx';
import SellerItemsGrid, { stockShortMessage } from './SellerItemsGrid.jsx';
import DraftsPanel from './DraftsPanel.jsx';

export default function POSPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCloseDay = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const quotationId = searchParams.get('quotation');
  const storageKey = draftKey(user.id, editId ? `edit:${editId}` : quotationId ? `quotation:${quotationId}` : 'new');
  const [restored] = useState(() => readDraft(storageKey));
  const submitLock = useRef(false);
  const [customerQuery, setCustomerQuery] = useState(restored?.customerQuery || '');
  const [enteredCustomer, setEnteredCustomer] = useState(restored?.enteredCustomer || { name: '', phone: '' });
  const [quotation, setQuotation] = useState(restored?.quotation || null);
  const [storageWarning, setStorageWarning] = useState(false);

  const [customer, setCustomer] = useState(restored?.customer || null);
  // Normalizes lines restored from an older cached draft that predates
  // per-line Cost Price/Discount so those cells never render as blank/NaN.
  const [lines, setLines] = useState(() => (restored?.lines || []).map((l) => ({ costPrice: 0, discount: 0, ...l })));
  const [discount, setDiscount] = useState(restored?.discount ?? '0');
  const [paidAmount, setPaidAmount] = useState(restored?.paidAmount ?? '');
  const [walletAmount, setWalletAmount] = useState(restored?.walletAmount ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState(restored?.paymentAccountId || null);
  const [notes, setNotes] = useState(restored?.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [editReceiptNumber, setEditReceiptNumber] = useState(restored?.editReceiptNumber || '');

  const [drafts, setDrafts] = useState([]);
  const [draftsLoading, setDraftsLoading] = useState(true);

  // Below the lg breakpoint the Customer+Payment side panel collapses into a
  // tap-to-expand section above Items, so Items (the main work area) is what
  // a cashier sees first without scrolling. It has no effect at lg+, where
  // the panel is always shown docked to the right. Collapses on its own once
  // a customer is picked, since that's the natural point to turn attention
  // to items; the cashier can still tap it open again for payment.
  const [mobilePanelOpen, setMobilePanelOpen] = useState(true);
  useEffect(() => {
    if (customer) setMobilePanelOpen(false);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backend independently rejects sale creation while CLOSED regardless of
  // this check (see saleService.createSaleDraft) -- this is only so a
  // non-admin sees a clear message instead of a confusing error after
  // filling out the whole form.
  const [businessDayStatus, setBusinessDayStatus] = useState(null);
  useEffect(() => {
    client.get('/day-close/status').then((res) => setBusinessDayStatus(res.data.data)).catch(() => setBusinessDayStatus(null));
  }, []);
  const posLocked = businessDayStatus?.status === 'CLOSED' && user?.role !== 'admin';

  const loadDrafts = useCallback(() => {
    setDraftsLoading(true);
    client
      .get('/sales/drafts/today')
      .then((res) => setDrafts(res.data.data))
      .catch(() => setDrafts([]))
      .finally(() => setDraftsLoading(false));
  }, []);

  useEffect(() => loadDrafts(), [loadDrafts]);

  // Edit mode: load an existing Draft's items/customer/payment into the cart.
  useEffect(() => {
    if (!editId || restored) return;
    setLoadingDraft(true);
    (async () => {
      try {
        const saleRes = await client.get(`/sales/${editId}`);
        const sale = saleRes.data.data;
        if (sale.status !== 'DRAFT') {
          toast.error('This invoice is no longer a pending Draft.');
          navigate('/pos', { replace: true });
          return;
        }
        const customerRes = await client.get(`/customers/${sale.customer}`);
        setCustomer(customerRes.data.data);
        setEditReceiptNumber(sale.receiptNumber);
        setDiscount(String(sale.discount || 0));
        setPaidAmount(sale.paidAmount ? String(sale.paidAmount) : '');
        setWalletAmount(sale.walletAmount ? String(sale.walletAmount) : '');
        setPaymentAccountId(sale.paymentAccount || null);
        setNotes(sale.notes || '');

        // Since editing releases this draft's reservation before re-reserving,
        // the ceiling for each line is its current available stock PLUS the
        // quantity this draft already holds.
        const withAvailability = await Promise.all(
          sale.items.map(async (i) => {
            const itemRes = await client.get(`/inventory/${i.item}`);
            const item = itemRes.data.data;
            return {
              itemId: i.item,
              name: i.name,
              itemCode: i.itemCode,
              serialNumber: i.serialNumber,
              unitPrice: i.unitPrice,
              costPrice: i.costPrice ?? item.costPrice,
              discount: i.discount || 0,
              quantity: i.quantity,
              available: item.availableQuantity + i.quantity,
            };
          })
        );
        setLines(withAvailability);
      } catch (err) {
        toast.error(err.friendlyMessage || 'Could not load this draft invoice.');
        navigate('/pos', { replace: true });
      } finally {
        setLoadingDraft(false);
      }
    })();
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quotationId || restored?.quotation) return;
    let active = true;
    setLoadingDraft(true);
    (async () => {
      try {
        const { data: response } = await client.get(`/quotations/${quotationId}`);
        const q = response.data;
        if (q.convertedInvoice) { navigate(`/receipt/${q.convertedInvoice}`, { replace: true }); return; }
        if (q.status !== 'Accepted') throw new Error('Only accepted, unexpired quotations can be converted.');
        const [customerResult, ...products] = await Promise.all([client.get(`/customers/${q.customer}`), ...q.items.map(i => client.get(`/inventory/${i.itemId}`))]);
        if (!active) return;
        setCustomer(customerResult.data.data);
        setLines(q.items.map((i, index) => ({ ...i, costPrice: products[index].data.data.costPrice, available: products[index].data.data.availableQuantity })));
        setDiscount(String(q.totalDiscount));
        setQuotation(q);
      } catch (err) { if (active) toast.error(err.friendlyMessage || err.message || 'Unable to load quotation.'); }
      finally { if (active) setLoadingDraft(false); }
    })();
    return () => { active = false; };
  }, [quotationId]);

  useEffect(() => {
    if (loadingDraft || (quotationId && !quotation)) return;
    const draftPayload = { customer, lines, discount, paidAmount, walletAmount, paymentAccountId, customerQuery, enteredCustomer, quotation, editReceiptNumber, notes };
    if (isDraftMeaningful(draftPayload)) {
      const saved = writeDraft(storageKey, draftPayload);
      setStorageWarning(!saved);
    } else clearDraft(storageKey);
  }, [storageKey, customer, lines, discount, paidAmount, walletAmount, paymentAccountId, customerQuery, enteredCustomer, quotation, editReceiptNumber, notes, loadingDraft]);

  // Sum of the rows' own totals (Qty x Price less any line discount carried over from a quotation/older draft).
  const rowsTotal = useMemo(() => lines.reduce((sum, l) => sum + Math.max(0, l.quantity * l.unitPrice - (Number(l.discount) || 0)), 0), [lines]);
  const subtotal = useMemo(() => lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0), [lines]);
  const lineDiscountTotal = useMemo(() => lines.reduce((sum, l) => sum + (Number(l.discount) || 0), 0), [lines]);
  const discountNum = Math.min((Number(discount) || 0) + lineDiscountTotal, subtotal);
  const total = Math.max(0, subtotal - discountNum);
  const walletAvailable = customer?.walletBalance || 0;
  const manualWalletNum = Math.min(Number(walletAmount) || 0, total, walletAvailable);
  const manualPaidNum = Math.min(Number(paidAmount) || 0, Math.max(0, total - manualWalletNum));
  // If the cashier leaves both Pay from Wallet and Paid Amount untouched
  // (blank/0), the wallet is drawn on automatically before anything becomes
  // debt -- up to what's available, capped at the total. Typing a non-zero
  // value into either field is a deliberate manual choice (e.g. "cash only,
  // don't touch the wallet") and always wins over this.
  const autoWalletApplies = manualWalletNum <= 0 && manualPaidNum <= 0 && walletAvailable > 0 && total > 0;
  const walletNum = autoWalletApplies ? Math.min(total, walletAvailable) : manualWalletNum;
  const paidNum = manualPaidNum;
  const remaining = Math.max(0, total - paidNum - walletNum);
  const hasOverStock = lines.some((l) => l.quantity > l.available || l.quantity <= 0);
  const hasInvalidDiscount = lines.some((l) => (Number(l.discount) || 0) > l.quantity * l.unitPrice);
  const needsAccount = paidNum > 0 && !paymentAccountId;
  const canComplete = !submitting && !loadingDraft && (!quotationId || !!quotation) && !!customer && lines.length > 0 && !hasOverStock && !hasInvalidDiscount && !needsAccount;
  const panelSummary = `${customer ? customer.name : 'Select customer'} · ${formatCurrency(total)}${
    customer ? ` · ${remaining > 0 ? `Balance ${formatCurrency(remaining)}` : 'Fully Paid'}` : ''
  }`;

  const handleAddLine = (product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === product.id);
      if (existing) {
        if (existing.quantity >= product.availableQuantity) {
          toast.error(stockShortMessage(product.availableQuantity));
          return prev;
        }
        return prev.map((l) => (l.itemId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          itemId: product.id,
          name: product.name,
          itemCode: product.itemCode,
          serialNumber: product.serialNumber,
          unitPrice: product.sellingPrice,
          costPrice: product.costPrice,
          discount: 0,
          // A quick-created item arrives with the quantity that was just stocked
          // for this sale; picking an ordinary item from the search starts the
          // Qty field empty (0) so the cashier types the quantity themselves,
          // instead of it defaulting to "1".
          quantity: product.saleQuantity ? Math.max(1, Math.min(product.saleQuantity, product.availableQuantity || 1)) : 0,
          available: product.availableQuantity,
        },
      ];
    });
  };

  // Handles Qty/Cost Price/Rate/Discount edits from the Excel-style grid.
  // Cost Price and Rate are independent -- editing one never touches the
  // other. Cost Price is only an estimate shown for margin visibility; the
  // real FIFO-weighted cost is still computed at Close Day regardless of
  // what is typed here, so historical COGS is never corrupted by it.
  const handleLineChange = (itemId, field, value) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.itemId !== itemId) return l;
        // Allowed to sit at 0 while being edited (an empty field reads as 0);
        // a 0-quantity line is caught by hasOverStock/handleSubmit and blocks
        // completing the sale, so it can never actually be saved that way.
        if (field === 'quantity') return { ...l, quantity: Math.max(0, Math.round(value) || 0) };
        return { ...l, [field]: Math.max(0, Number(value) || 0) };
      })
    );
  };

  const handleRemove = (itemId) => setLines((prev) => prev.filter((l) => l.itemId !== itemId));

  const resetSale = () => {
    setCustomer(null);
    setLines([]);
    setDiscount('0');
    setPaidAmount('');
    setWalletAmount('');
    setPaymentAccountId(null);
    setNotes('');
    setEditReceiptNumber('');
    setCustomerQuery('');
    setEnteredCustomer({ name: '', phone: '' });
    clearDraft(storageKey);
  };

  const handleCancel = () => {
    if ((customer || lines.length || customerQuery || enteredCustomer.name || paidAmount || Number(discount) || notes) && !window.confirm('Discard this unfinished invoice?')) return;
    resetSale();
    navigate('/pos');
  };

  const handleSubmit = async () => {
    if (submitLock.current || loadingDraft) return;
    if (!customer) {
      toast.error('Please select or create a customer first.');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one product to the sale.');
      return;
    }
    const missingQty = lines.find((l) => !(l.quantity > 0));
    if (missingQty) {
      toast.error(`Enter a quantity for "${missingQty.name}".`);
      return;
    }
    const overStock = lines.find((l) => l.quantity > l.available);
    if (overStock) {
      toast.error(`"${overStock.name}" exceeds available stock.`);
      return;
    }
    const overDiscounted = lines.find((l) => (Number(l.discount) || 0) > l.quantity * l.unitPrice);
    if (overDiscounted) {
      toast.error(`Discount on "${overDiscounted.name}" cannot exceed its line total.`);
      return;
    }
    if (needsAccount) {
      toast.error('Please select a payment account for the amount being paid.');
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      const payload = {
        customerId: customer.id,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, costPrice: l.costPrice, discount: l.discount || 0 })),
        discount: Number(discount) || 0,
        paidAmount: paidNum,
        walletAmount: walletNum,
        paymentAccountId,
        notes,
      };
      let saleId;
      if (quotationId) {
        const res = await client.post(`/quotations/${quotationId}/convert`, { paidAmount: paidNum, paymentAccountId });
        saleId = res.data.data.id;
        toast.success(res.data.existing ? 'This quotation has already been converted.' : 'Quotation converted to a pending invoice. Close Day will confirm it.');
      } else if (editId) {
        const res = await client.put(`/sales/${editId}`, payload);
        saleId = res.data.data.id;
        toast.success(`Draft invoice ${res.data.data.receiptNumber} updated.`);
      } else {
        const res = await client.post('/sales', payload);
        saleId = res.data.data.id;
        toast.success(`Pending invoice ${res.data.data.receiptNumber} created. It will become final at Close Day.`);
      }
      resetSale();
      loadDrafts();
      navigate(`/receipt/${saleId}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not save this invoice.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (posLocked) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <Lock className="mb-3 h-8 w-8 text-slate-300" />
        <p className="text-lg font-semibold text-rose-600">Maalintu waa xiran tahay, fadlan sug Admin inuu furo.</p>
        <p className="mt-1 text-sm text-slate-400">The business day is closed. Please wait for an admin to open it.</p>
      </div>
    );
  }

  return (
    // No max-width/centering here: <main> in AppLayout already gives every
    // page a consistent 16-24px edge padding (p-4 sm:p-6); this page fills
    // the rest of the window on its own, like every other page in the app.
    <div className="space-y-4">
      {/* Plain navigation, on purpose: the draft auto-saves as the cashier
          types (see posDraft.js), so leaving via Back never needs a
          confirmation and never touches the draft -- returning to Seller/POS
          picks this exact invoice back up automatically. Styled to match the
          "Back to X" link used on every other detail page in the app. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/pos" className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-4 w-4" /> Back to Sales Invoices
        </Link>
        <Button variant="secondary" disabled={submitting} onClick={handleCancel}>
          Discard Draft
        </Button>
      </div>

      <PageHeader
        title={quotationId ? 'Convert Quotation to Invoice' : editId ? 'Edit Sales Invoice' : 'Add Sales Invoice'}
        subtitle="Find the customer, add products, and create the pending invoice"
        actions={
          canCloseDay && (
            <Link to="/pos/close-day">
              <Button variant="secondary">
                <Lock className="h-4 w-4" /> Close Day
              </Button>
            </Link>
          )
        }
      />
      {storageWarning && <p className="text-sm text-amber-700">Browser storage is unavailable. This draft is retained during navigation, but cannot survive a reload.</p>}
      {quotation && <p className="rounded-lg bg-indigo-50 p-3 text-sm">From {quotation.quotationNumber}. Accepted items, prices and discount are preserved. {quotation.notes}</p>}
      {editId && (
        <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700">
          <Pencil className="h-4 w-4" /> Editing Draft Invoice {editReceiptNumber || editId}
          {loadingDraft && <span className="text-indigo-400">(loading...)</span>}
        </div>
      )}

      {/* Below lg: a single stacked column, Customer+Payment collapsed above
          Items. At lg+: Items is the wide main column (left), Customer+
          Payment is a narrower panel docked to the right, pinned in view
          with its own Complete Sale button so it's never scrolled away. */}
      {/* Items gets ~70-75% of the width, the Customer+Payment panel ~25-30%
          -- a true percentage split (fr units), not a fixed pixel column, so
          the ratio holds at any lg+ viewport width. minmax() keeps the panel
          from ever getting too narrow to use on a smaller lg screen. */}
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)] lg:items-start lg:gap-4">
        <div className="order-2 min-w-0 lg:order-none">
          <Card dense title="Items">
            <fieldset disabled={submitting || !!quotationId}>
              <SellerItemsGrid
                lines={lines}
                grandTotal={rowsTotal}
                onAddLine={handleAddLine}
                onLineChange={handleLineChange}
                onRemoveLine={handleRemove}
                disabled={submitting}
                focusTrigger={customer?.id}
              />
            </fieldset>
          </Card>
        </div>

        <div className="order-1 mb-4 lg:order-none lg:sticky lg:top-4 lg:mb-0">
          <button
            type="button"
            onClick={() => setMobilePanelOpen((o) => !o)}
            className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-slate-700 shadow-sm lg:hidden"
          >
            <span className="truncate">{panelSummary}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${mobilePanelOpen ? 'rotate-180' : ''}`} />
          </button>

          <div className={`${mobilePanelOpen ? 'block' : 'hidden'} space-y-4 lg:block`}>
            <Card dense>
              <fieldset disabled={submitting || !!quotationId}><CustomerSearchBox searchValue={customerQuery} onSearchChange={setCustomerQuery} enteredCustomer={enteredCustomer} onEnteredCustomerChange={setEnteredCustomer} activeCustomer={customer} onSelect={setCustomer} onClear={() => { setCustomer(null); setWalletAmount(''); }} cartTotal={total} paidAmount={paidNum} walletAmount={walletNum} /></fieldset>
            </Card>

            <Card dense title="Payment">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-medium tabular-nums text-slate-800">{formatCurrency(subtotal)}</span>
                </div>
                {lineDiscountTotal > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Line Discounts</span>
                    <span className="tabular-nums">{formatCurrency(lineDiscountTotal)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>Discount (optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-28 text-right tabular-nums"
                    disabled={submitting || !!quotationId}
                  />
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
                  <span>Total After Discount</span>
                  <span className="tabular-nums">{formatCurrency(total)}</span>
                </div>

                {customer && walletAvailable > 0 && (
                  <div className="pt-1">
                    <div className="flex items-center justify-between">
                      <Label>Pay from Wallet (available {formatCurrency(walletAvailable)})</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={walletAmount}
                        onChange={(e) => setWalletAmount(e.target.value)}
                        className="w-28 text-right tabular-nums"
                        disabled={submitting || !!quotationId}
                      />
                    </div>
                    {autoWalletApplies && (
                      <p className="mt-1 text-right text-xs text-indigo-600">
                        Left blank — {formatCurrency(walletNum)} will be used from the wallet automatically.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Label>Payment Method</Label>
                  <AccountSelect value={paymentAccountId} onChange={setPaymentAccountId} disabled={submitting} placeholder="Select account..." />
                </div>
                <div>
                  <Label>Paid Amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="w-full text-right tabular-nums"
                    disabled={submitting}
                  />
                </div>
                {needsAccount && <p className="text-right text-xs font-medium text-rose-600">Select an account to record this payment.</p>}

                <div className={`flex justify-between rounded-lg px-3 py-2 font-semibold tabular-nums ${remaining > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  <span className="font-semibold">{remaining > 0 ? 'Outstanding Balance (added to debt)' : 'Fully Paid'}</span>
                  <span>{formatCurrency(remaining)}</span>
                </div>

                {!quotationId && (
                  <div className="pt-1">
                    <Label>Notes</Label>
                    <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" disabled={submitting} />
                  </div>
                )}

                <div className="mt-2 grid grid-cols-2 gap-3">
                  <Button variant="secondary" size="lg" disabled={submitting} onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button size="lg" loading={submitting} disabled={!canComplete} onClick={handleSubmit}>
                    <ShoppingCart className="h-4 w-4" /> {editId ? 'Save Changes' : 'Save / Create Sale'}
                  </Button>
                </div>
                <p className="text-center text-xs text-slate-400">
                  {editId ? 'This draft stays PENDING until Close Day confirms it.' : 'This invoice is PENDING until Close Day confirms it.'}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <Card
        dense
        title={
          <span className="flex items-center gap-1.5">
            <ClipboardList className="h-4 w-4" /> Today's Pending Invoices
          </span>
        }
        subtitle="Editable until Close Day"
        actions={<Badge color="amber">{drafts.length}</Badge>}
      >
        <DraftsPanel drafts={drafts} loading={draftsLoading} onChanged={loadDrafts} />
      </Card>
    </div>
  );
}
