import { useEffect, useState } from 'react';
import client from '../../api/client.js';
import BatchHistory from '../../components/BatchHistory.jsx';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import Badge, { stockStatusBadge, expiryStatusBadge } from '../../components/ui/Badge.jsx';
import { formatCurrency, formatDate } from '../../utils/format.js';

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}

export default function InventoryDetailsModal({ open, onClose, item: summaryItem }) {
  const navigate = useNavigate();
  const [details, setDetails] = useState(null);
  useEffect(() => {
    let active = true;
    if (open && summaryItem) client.get(`/inventory/${summaryItem.id}`).then(r => { if (active) setDetails(r.data.data); }).catch(() => {});
    return () => { active = false; };
  }, [open, summaryItem]);
  const item = details?.id === summaryItem?.id ? details : summaryItem;
  if (!item) return null;
  const stock = stockStatusBadge(item.stockStatus);
  const expiry = expiryStatusBadge(item.expiryStatus);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.name}
      size="xl"
      footer={
        <Button onClick={() => navigate(`/inventory/${item.id}/print`)}>
          <Printer className="h-4 w-4" /> Print Item Record
        </Button>
      }
    >
      <div className="mb-4 flex gap-2">
        <Badge color={stock.color}>{stock.label}</Badge>
        {expiry && item.expiryDate && <Badge color={expiry.color}>{expiry.label}</Badge>}
      </div>
      <Row label="Item ID" value={item.itemCode || '—'} />
      <Row label="Serial Number" value={item.serialNumber || '—'} />
      <Row label="Category" value={item.category?.name || 'Uncategorized'} />
      <Row label="Quantity" value={`${item.quantity} ${item.unit}`} />
      <Row label="Average Cost" value={formatCurrency(item.costPrice)} />
      <Row label="Selling Price" value={formatCurrency(item.sellingPrice)} />
      <Row label="Margin" value={formatCurrency(item.sellingPrice - item.costPrice)} />
      <Row label="Stock Value (Qty × Avg Cost)" value={formatCurrency(item.quantity * item.costPrice)} />
      <Row label="Supplier" value={item.supplier?.name || '—'} />
      <Row label="Expiry Date" value={item.expiryDate ? formatDate(item.expiryDate) : '—'} />
      <Row label="Created" value={formatDate(item.createdAt)} />
      <Row label="Last Updated" value={formatDate(item.updatedAt)} />
      <BatchHistory item={item} />
    </Modal>
  );
}
