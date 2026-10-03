import { Link } from 'react-router-dom';

import { formatCurrency, formatDate } from '../utils/format.js';

export default function BatchHistory({ item }) {

  return <section className="mt-5 overflow-x-auto"><h3 className="font-semibold">Stock / Batch History</h3><p className="my-2 text-sm">Physical: {item.quantity} · Sellable: {item.availableQuantity} · Expired: {item.expiredQuantity || 0} · Times Stocked: {item.timesStocked || 0} · Total Received: {item.totalReceived || 0}</p><table className="w-full text-xs"><thead><tr>{['Stock Serial', 'Received', 'Original', 'Remaining', 'Reserved', 'Cost', 'Selling', 'Expiry', 'Supplier', 'Realized Profit'].map(h => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{(item.batches || []).map(b => <tr key={b._id} className="border-t"><td className="p-2"><Link to={`/stock?q=${encodeURIComponent(b.stockSerial || "")}`}>{b.stockSerial || b.purchase?.purchaseNumber || 'Legacy stock'}</Link></td><td>{formatDate(b.receivedAt || b.createdAt)}</td><td>{b.originalQuantity}</td><td>{b.remainingQuantity}</td><td>{b.reservedQuantity || 0}</td><td>{formatCurrency(b.unitCostCents / 100)}</td><td>{b.sellingPriceCents == null ? '—' : formatCurrency(b.sellingPriceCents / 100)}</td><td>{b.expiryDate?.slice(0, 10) || '—'}</td><td>{b.supplier?.name || '—'}</td></tr>)}</tbody></table><h4 className="mt-4 font-semibold">Stock movements</h4>{(item.stockEvents || []).map((event, i) => <p key={i} className="text-xs">{formatDate(event.at)} ? {event.type} ? {event.reference} ? {event.quantityBefore} ? {event.quantityAfter}</p>)}</section>;

}

