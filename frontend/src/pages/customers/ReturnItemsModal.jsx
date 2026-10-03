import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Field.jsx';
import client from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDate, formatTime } from '../../utils/format.js';
import { printA5 } from '../../utils/printA5.js';
import { BUSINESS } from '../../constants/business.js';
import logo from '../../images/logo.png';

// Partial (or full, multi-item) return for a CONFIRMED invoice: pick how
// many units of each line are coming back. Stock is restored into the exact
// lots they came from and the invoice's economics (and, if needed, a
// refund) are reconciled server side, as ONE atomic operation covering
// every selected line -- this only collects the quantities being returned.
export default function ReturnItemsModal({ open, onClose, sale, onReturned }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setQuantities({});
      setReason('');
    }
  }, [open, sale?.id]);

  if (!sale) return null;

  const lines = sale.items.map((item) => ({ ...item, returnable: item.quantity - (item.returnedQuantity || 0) }));
  const eligibleLines = lines.filter((l) => l.returnable > 0);
  const showBulkControls = eligibleLines.length > 1;

  const qtyOf = (item) => Number(quantities[item]) || 0;
  const isChecked = (item) => qtyOf(item) > 0;
  const previewAmount = lines.reduce((sum, l) => sum + qtyOf(l.item) * l.unitPrice, 0);
  const anySelected = eligibleLines.some((l) => qtyOf(l.item) > 0);
  const allChecked = eligibleLines.length > 0 && eligibleLines.every((l) => isChecked(l.item));
  const someChecked = eligibleLines.some((l) => isChecked(l.item)) && !allChecked;

  const clampQty = (line, value) => Math.max(0, Math.min(line.returnable, Math.round(Number(value) || 0)));

  const toggleRow = (line) => {
    setQuantities((q) => ({ ...q, [line.item]: isChecked(line.item) ? 0 : line.returnable }));
  };

  const toggleSelectAll = () => {
    setQuantities((q) => {
      const next = { ...q };
      if (allChecked) {
        // Unchecking Select All unchecks every row.
        for (const l of eligibleLines) next[l.item] = 0;
      } else {
        // Checking Select All only fills rows that aren't already selected --
        // a manually-set partial quantity on an already-checked row survives.
        for (const l of eligibleLines) {
          if (!(Number(next[l.item]) > 0)) next[l.item] = l.returnable;
        }
      }
      return next;
    });
  };

  const returnAllFullQuantities = () => {
    setQuantities((q) => {
      const next = { ...q };
      for (const l of eligibleLines) next[l.item] = l.returnable; // always overwrites -- unconditional full quantity
      return next;
    });
  };

  const buildItemsPayload = () =>
    lines
      .filter((l) => qtyOf(l.item) > 0)
      .map((l) => ({ itemId: l.item, quantity: qtyOf(l.item), name: l.name, unitPrice: l.unitPrice }));

  const validate = () => {
    const selected = buildItemsPayload();
    if (!selected.length) {
      toast.error('Enter at least one quantity to return.');
      return null;
    }
    for (const l of lines) {
      const qty = qtyOf(l.item);
      if (qty > l.returnable) {
        toast.error(`Cannot return ${qty} of "${l.name}": only ${l.returnable} returnable.`);
        return null;
      }
    }
    return selected;
  };

  const handlePrintPreview = () => {
    // Pre-confirm preview: purely a print of the CURRENT selected
    // rows/quantities. No API call is made here at all -- nothing is
    // persisted, no stock/debt/account is touched.
    const selected = validate();
    if (!selected) return;
    setTimeout(printA5, 50); // let the hidden preview render before printing
  };

  const handleSubmit = async () => {
    const items = validate();
    if (!items) return;
    setSubmitting(true);
    try {
      const res = await client.post(`/sales/${sale.id}/return`, { items: items.map(({ itemId, quantity }) => ({ itemId, quantity })), reason });
      toast.success('Items returned. Stock and balances have been reconciled.');
      onReturned();
      onClose();
      const newReturnIndex = res.data.data.returns.length - 1;
      navigate(`/receipt/${sale.id}/return/${newReturnIndex}`);
    } catch (err) {
      toast.error(err.friendlyMessage || 'Could not process this return.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedForPreview = buildItemsPayload();

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Return Items — ${sale.receiptNumber}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handlePrintPreview} disabled={submitting}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={!anySelected}>
              Confirm Return
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Enter how many units of each item the customer is returning. Stock will be restored to inventory and the
            invoice balance, customer debt and account will be reconciled automatically.
          </p>

          {showBulkControls && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                />
                Select All Items
              </label>
              <Button variant="secondary" onClick={returnAllFullQuantities}>
                Return All Full Quantities
              </Button>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-500">Item</th>
                  <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Sold</th>
                  <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Already Returned</th>
                  <th className="px-2 py-2 text-center text-xs font-medium uppercase text-slate-500">Return Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.item} className={l.returnable <= 0 ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={l.returnable <= 0}
                        checked={isChecked(l.item)}
                        onChange={() => toggleRow(l)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{l.name}</p>
                      <p className="text-xs text-slate-400">{formatCurrency(l.unitPrice)} each</p>
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums">{l.quantity}</td>
                    <td className="px-2 py-2 text-center tabular-nums">{l.returnedQuantity || 0}</td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        min="0"
                        max={l.returnable}
                        step="1"
                        disabled={l.returnable <= 0}
                        value={quantities[l.item] ?? ''}
                        onChange={(e) => setQuantities((q) => ({ ...q, [l.item]: e.target.value === '' ? '' : clampQty(l, e.target.value) }))}
                        className="w-20 text-center tabular-nums"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
          <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">
            <span>Return Value</span>
            <span className="tabular-nums">{formatCurrency(previewAmount)}</span>
          </div>
        </div>
      </Modal>

      {open &&
        createPortal(
          <div id="print-area" className="fixed left-[-9999px] top-0 w-full">
            <ReturnPreviewReceipt sale={sale} items={selectedForPreview} reason={reason} total={previewAmount} />
          </div>,
          document.body
        )}
    </>
  );
}

// Pre-confirm, read-only print preview -- built entirely from the modal's
// current unsaved local state (never fetched from or written to the
// server). Deliberately mirrors ReturnReceiptPage.jsx's exact receipt-size
// (A5, via printA5()) layout convention so a preview print and the
// eventual persisted receipt look the same to the user.
function ReturnPreviewReceipt({ sale, items, reason, total }) {
  const now = new Date();
  return (
    <div className="mx-auto max-w-[148mm] p-6 text-[13px]">
      <div className="flex flex-col items-center text-center">
        <img src={logo} alt={BUSINESS.name} className="h-16 w-auto object-contain" />
        <h1 className="mt-1 text-base font-bold tracking-wide text-slate-900">{BUSINESS.name}</h1>
        <p className="text-xs text-slate-500">{BUSINESS.addressLine}</p>
        <p className="text-xs text-slate-500">{BUSINESS.phone}</p>
      </div>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <p className="text-center text-sm font-bold uppercase tracking-wide text-slate-800">Return Preview</p>
      <p className="text-center text-[11px] text-slate-400">Not yet confirmed -- for reference only</p>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <div className="flex justify-between text-xs">
        <div>
          <p className="text-slate-400">Customer</p>
          <p className="font-semibold text-slate-800">{sale.customerName}</p>
        </div>
        <div className="text-right">
          <p className="text-slate-400">Original Invoice</p>
          <p className="font-semibold text-slate-800">{sale.receiptNumber}</p>
          <p className="text-slate-500">{formatDate(now)}, {formatTime(now)}</p>
        </div>
      </div>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left uppercase text-slate-400">
            <th className="w-6 py-1 font-medium">No</th>
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 text-center font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Price</th>
            <th className="py-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.itemId} className="border-b border-slate-50">
              <td className="py-1.5 text-slate-500">{i + 1}</td>
              <td className="py-1.5 text-slate-700">{item.name}</td>
              <td className="py-1.5 text-center text-slate-600">{item.quantity}</td>
              <td className="py-1.5 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
              <td className="py-1.5 text-right font-medium text-slate-800">{formatCurrency(item.quantity * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <div className="flex justify-between text-sm font-bold text-slate-900">
        <span>Return Value</span>
        <span>{formatCurrency(total)}</span>
      </div>
      {reason && (
        <div className="mt-1 flex justify-between text-xs text-slate-600">
          <span>Reason</span>
          <span>{reason}</span>
        </div>
      )}
      <div className="my-3 border-t border-dashed border-slate-300" />
      <p className="text-center text-[11px] text-slate-400">This is a preview only. Confirm the return to generate the final receipt.</p>
    </div>
  );
}
