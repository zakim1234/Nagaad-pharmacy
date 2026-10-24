import DayClose from '../models/DayClose.js';
import Sale from '../models/Sale.js';
import Expense from '../models/Expense.js';
import { ApiError } from '../utils/ApiError.js';

// Items sold, built from the saved Close Day records: one report per day,
// month or year, each with every item's units, cost, sales and profit.

export const PERIOD_TYPES = ['day', 'month', 'year'];

const pad = (n) => String(n).padStart(2, '0');

// The period key a business date falls in: "2026-10-19", "2026-10" or "2026".
export function periodKey(type, date) {
  const d = new Date(date);
  if (type === 'year') return String(d.getFullYear());
  if (type === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// [start, end) of a period, in the server's local calendar like businessDate.
export function periodRange(type, key) {
  if (!PERIOD_TYPES.includes(type)) throw new ApiError(400, 'Choose day, month or year.');
  const k = String(key || '');
  let start;
  let end;
  if (type === 'year' && /^\d{4}$/.test(k)) {
    start = new Date(Number(k), 0, 1);
    end = new Date(Number(k) + 1, 0, 1);
  } else if (type === 'month' && /^\d{4}-\d{2}$/.test(k)) {
    const [y, m] = k.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  } else if (type === 'day') {
    // "YYYY-MM-DD", or a businessDate as sent by the Daily Closing page.
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    start = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(k);
    if (!ymd && !Number.isNaN(start.getTime())) start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  }
  if (!start || Number.isNaN(start.getTime())) throw new ApiError(400, 'Choose a valid period.');
  return { start, end };
}

// Adds a confirmed sale's lines to a per-item tally; returns the part of its
// discount given on the whole invoice rather than on a line.
// 'Zinc ', 'zinc' and 'ZINC' are the same item on a report.
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function tallySaleItems(sale, byItem, keyOf = (line) => String(line.item)) {
  let lineDiscountCents = 0;
  for (const line of sale.items) {
    addRow(byItem, keyOf(line), {
      item: line.item,
      itemName: line.itemName,
      quantity: line.quantity,
      costCents: line.quantity * (line.costPriceCents || 0),
      salesCents: line.subtotalCents - (line.discountCents || 0),
    });
    lineDiscountCents += line.discountCents || 0;
  }
  return Math.max(0, (sale.discountCents || 0) - lineDiscountCents);
}

function addRow(byItem, key, r) {
  const row = byItem.get(key) || { item: r.item, itemName: r.itemName, quantity: 0, costCents: 0, salesCents: 0 };
  row.quantity += r.quantity;
  row.costCents += r.costCents;
  row.salesCents += r.salesCents;
  byItem.set(key, row);
}

// One period's report: every item sold, with totals and net profit.
export async function getItemsSold({ type, key }) {
  const { start, end } = periodRange(type, key);
  const closes = await DayClose.find({ businessDate: { $gte: start, $lt: end } }).sort({ closedAt: 1 });
  if (!closes.length) throw new ApiError(404, 'No closing found for that period.');

  // Rows are merged by item name: two inventory items called 'zinc' (or the
  // same item in two branches) are one line, with average cost and price.
  const keyOf = (r) => nameKey(r.itemName) || String(r.item);
  const byItem = new Map();
  let invoiceDiscountCents = 0;
  for (const c of closes) {
    if (c.itemsSold) {
      for (const r of c.itemsSold) addRow(byItem, keyOf(r), r);
      invoiceDiscountCents += c.invoiceDiscountCents || 0;
    } else {
      // Closed before this report existed: rebuild from its invoices.
      const sales = await Sale.find({ receiptNumber: { $in: c.invoiceReferences }, ...(c.branch ? { branch: c.branch } : {}) });
      for (const sale of sales) invoiceDiscountCents += tallySaleItems(sale, byItem, keyOf);
    }
  }

  const items = Array.from(byItem.values()).sort((a, b) => b.salesCents - a.salesCents);
  const totals = items.reduce(
    (t, r) => ({ quantity: t.quantity + r.quantity, costCents: t.costCents + r.costCents, salesCents: t.salesCents + r.salesCents }),
    { quantity: 0, costCents: 0, salesCents: 0 }
  );
  const [exp] = await Expense.aggregate([
    { $match: { status: 'POSTED', date: { $gte: start, $lt: end } } },
    { $group: { _id: null, cents: { $sum: '$amountCents' } } },
  ]);
  const expensesCents = exp?.cents || 0;
  const grossProfitCents = totals.salesCents - invoiceDiscountCents - totals.costCents;
  return {
    type,
    key: periodKey(type, start),
    start,
    end,
    closeCount: closes.length,
    dayCount: new Set(closes.map((c) => periodKey('day', c.businessDate))).size,
    invoiceCount: closes.reduce((s, c) => s + (c.invoiceCount || 0), 0),
    items,
    totals: { ...totals, invoiceDiscountCents, grossProfitCents, expensesCents, netProfitCents: grossProfitCents - expensesCents },
  };
}

// Every day, month or year that has a closing, newest first, with its totals.
export async function listItemsSoldPeriods({ type }) {
  if (!PERIOD_TYPES.includes(type)) throw new ApiError(400, 'Choose day, month or year.');
  const [closes, expenses] = await Promise.all([
    DayClose.find({}, { businessDate: 1, invoiceCount: 1, revenueCents: 1, cogsCents: 1, grossProfitCents: 1 }).lean(),
    Expense.find({ status: 'POSTED' }, { date: 1, amountCents: 1 }).lean(),
  ]);
  const periods = new Map();
  for (const c of closes) {
    const k = periodKey(type, c.businessDate);
    const p = periods.get(k) || { key: k, days: new Set(), invoiceCount: 0, revenueCents: 0, cogsCents: 0, grossProfitCents: 0, expensesCents: 0 };
    p.days.add(periodKey('day', c.businessDate));
    p.invoiceCount += c.invoiceCount || 0;
    p.revenueCents += c.revenueCents || 0;
    p.cogsCents += c.cogsCents || 0;
    p.grossProfitCents += c.grossProfitCents || 0;
    periods.set(k, p);
  }
  for (const e of expenses) {
    const p = periods.get(periodKey(type, e.date));
    if (p) p.expensesCents += e.amountCents || 0;
  }
  return Array.from(periods.values())
    .map(({ days, ...p }) => ({ ...p, dayCount: days.size, netProfitCents: p.grossProfitCents - p.expensesCents }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}
