import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import { ApiError } from '../utils/ApiError.js';
import { periodRange, periodKey, nameKey } from './itemsSoldService.js';

// What one customer bought, item by item, over all time or one day, month or
// year: units (net of returns), average price, amount spent and the profit
// made -- plus the item they buy most and least. Built from their confirmed
// invoices.
export async function getCustomerItems({ customerId, type = 'all', key }) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new ApiError(404, 'Customer not found.');

  const filter = { customer: customer._id, status: 'CONFIRMED' };
  let range = null;
  if (type !== 'all') {
    range = periodRange(type, key);
    filter.createdAt = { $gte: range.start, $lt: range.end };
  }
  const sales = await Sale.find(filter).select('items createdAt').lean();

  const byItem = new Map();
  for (const sale of sales) {
    for (const line of sale.items) {
      const net = line.quantity - (line.returnedQuantity || 0);
      if (net <= 0) continue;
      const share = net / line.quantity; // returned units come off proportionally
      const k = nameKey(line.itemName) || String(line.item); // same name = one line
      const row = byItem.get(k) || { item: line.item, itemName: line.itemName, quantity: 0, salesCents: 0, costCents: 0, invoices: 0, lastBought: null };
      row.quantity += net;
      row.salesCents += Math.round((line.subtotalCents - (line.discountCents || 0)) * share);
      row.costCents += net * (line.costPriceCents || 0);
      row.invoices += 1;
      if (!row.lastBought || sale.createdAt > row.lastBought) row.lastBought = sale.createdAt;
      byItem.set(k, row);
    }
  }

  const items = Array.from(byItem.values()).sort((a, b) => b.quantity - a.quantity || b.salesCents - a.salesCents);
  const totals = items.reduce(
    (t, r) => ({ quantity: t.quantity + r.quantity, salesCents: t.salesCents + r.salesCents, costCents: t.costCents + r.costCents }),
    { quantity: 0, salesCents: 0, costCents: 0 }
  );
  return {
    customer,
    type,
    key: range ? periodKey(type, range.start) : null,
    invoiceCount: sales.length,
    items,
    mostBought: items[0] || null,
    leastBought: items.length > 1 ? items[items.length - 1] : null,
    totals,
  };
}
