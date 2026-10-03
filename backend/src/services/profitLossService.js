import ExcelJS from 'exceljs';
import Sale from '../models/Sale.js';
import Expense from '../models/Expense.js';
import AccountTransaction from '../models/AccountTransaction.js';
import { listExpenseCategories } from './expenseCategoryService.js';
import { ApiError } from '../utils/ApiError.js';
import { fromCents } from '../utils/money.js';
import { netAdjustmentValueCents } from './stockAdjustmentService.js';
import { BUSINESS_NAME } from '../config/business.js';

export const BASES = ['accrual', 'cash'];
export const COLUMN_MODES = ['total', 'month'];
export const SORT_MODES = ['default', 'amount', 'name'];
const MAX_MONTH_COLUMNS = 36;

const pad = (n) => String(n).padStart(2, '0');
export const toDayString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 'YYYY-MM-DD' -> a local-time boundary. Deliberately not `new Date('YYYY-MM-DD')`,
// which is UTC midnight and would put the boundary on the wrong local day in any
// timezone west of UTC.
function parseLocalDay(value, endOfDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new ApiError(400, 'Dates must be in YYYY-MM-DD format.');
  const [, y, m, d] = match.map(Number);
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) throw new ApiError(400, 'Enter a valid date.');
  return date;
}

// Month-to-date by default, like the report's default "Dates" choice.
export function resolveProfitLossRange({ from, to }) {
  const now = new Date();
  const start = from ? parseLocalDay(from, false) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? parseLocalDay(to, true) : parseLocalDay(toDayString(now), true);
  if (start > end) throw new ApiError(400, 'The From date must be on or before the To date.');
  return { start, end };
}

function monthBuckets(start, end) {
  const buckets = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({
      key: `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`,
      label: cursor.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      start: cursor < start ? start : cursor,
      end: monthEnd > end ? end : monthEnd,
    });
    if (buckets.length > MAX_MONTH_COLUMNS) throw new ApiError(400, `Month columns are limited to ${MAX_MONTH_COLUMNS} months. Choose a shorter range.`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return buckets;
}

// Money in one period, all in integer cents.
//
// COGS is the same on both bases: the Weighted Average Cost frozen on each
// sale line at Close Day (never the latest purchase price).
//
// Sales income:
//   accrual -- CONFIRMED (Close Day) invoices created in the period, net of
//              returns, whether or not the customer has paid yet.
//   cash    -- money actually received from customers in the period: sale and
//              debt payments posted to an account, plus wallet credit applied
//              to invoices, minus refunds paid out. Unpaid credit sales add
//              nothing until the customer pays.
//
// Discount Received (supplier discounts) is always 0 for now: purchase
// invoices have no discount field, so there is nothing to report.
// Exported (not just used internally by buildProfitLoss) so the Balance
// Sheet can reuse the exact same accrual net-income formula for both its
// "Net Income" (current fiscal year to date) and "Retained Earnings"
// (everything before that) lines -- see balanceSheetService.js.
export async function computePeriod({ start, end, basis }) {
  const salesMatch = { status: 'CONFIRMED', createdAt: { $gte: start, $lte: end } };
  const [[sales], expenseRows, inventoryAdjustmentCents] = await Promise.all([
    Sale.aggregate([
      { $match: salesMatch },
      { $group: { _id: null, total: { $sum: '$totalCents' }, cogs: { $sum: '$costOfGoodsCents' }, wallet: { $sum: '$walletAmountCents' } } },
    ]),
    Expense.aggregate([
      { $match: { status: 'POSTED', date: { $gte: start, $lte: end } } },
      { $group: { _id: '$category', cents: { $sum: '$amountCents' } } },
    ]),
    netAdjustmentValueCents({ start, end }),
  ]);

  let salesIncomeCents = sales?.total || 0;
  if (basis === 'cash') {
    const flows = await AccountTransaction.aggregate([
      {
        $match: {
          status: 'POSTED',
          postedAt: { $gte: start, $lte: end },
          $or: [
            { direction: 'IN', type: { $in: ['SALE_PAYMENT', 'CUSTOMER_DEBT_PAYMENT'] } },
            { direction: 'OUT', type: 'REFUND', referenceType: 'Sale' },
          ],
        },
      },
      { $group: { _id: '$direction', cents: { $sum: '$amountCents' } } },
    ]);
    const received = flows.find((f) => f._id === 'IN')?.cents || 0;
    const refunded = flows.find((f) => f._id === 'OUT')?.cents || 0;
    salesIncomeCents = received + (sales?.wallet || 0) - refunded;
  }

  const expenses = new Map(expenseRows.map((r) => [r._id, r.cents]));
  const totalExpenseCents = [...expenses.values()].reduce((sum, c) => sum + c, 0);
  const discountReceivedCents = 0;
  const totalIncomeCents = salesIncomeCents + discountReceivedCents;
  const salesCogsCents = sales?.cogs || 0;
  // Stock written off (damaged/expired/lost) minus stock found, valued at
  // average cost -- part of the cost of goods for the period.
  const cogsCents = salesCogsCents + inventoryAdjustmentCents;
  const grossProfitCents = totalIncomeCents - cogsCents;
  return {
    salesIncomeCents,
    discountReceivedCents,
    totalIncomeCents,
    salesCogsCents,
    inventoryAdjustmentCents,
    cogsCents,
    grossProfitCents,
    expenses,
    totalExpenseCents,
    netIncomeCents: grossProfitCents - totalExpenseCents,
  };
}

export async function buildProfitLoss({ from, to, basis = 'accrual', columns = 'total', sort = 'default' }) {
  if (!BASES.includes(basis)) throw new ApiError(400, 'Report basis must be "accrual" or "cash".');
  if (!COLUMN_MODES.includes(columns)) throw new ApiError(400, 'Columns must be "total" or "month".');
  if (!SORT_MODES.includes(sort)) throw new ApiError(400, 'Sort must be "default", "amount" or "name".');
  const { start, end } = resolveProfitLossRange({ from, to });

  const buckets = columns === 'month' ? monthBuckets(start, end) : [];
  const [total, ...perMonth] = await Promise.all([
    computePeriod({ start, end, basis }),
    ...buckets.map((b) => computePeriod({ start: b.start, end: b.end, basis })),
  ]);
  const cols = [
    ...buckets.map((b, i) => ({ key: b.key, label: b.label, period: perMonth[i] })),
    { key: 'total', label: 'Total', period: total },
  ];

  // Expense rows: every category with activity anywhere in the report.
  const known = await listExpenseCategories();
  const used = new Set(cols.flatMap((c) => [...c.period.expenses.keys()]));
  let categories = [...known.filter((c) => used.has(c)), ...[...used].filter((c) => !known.includes(c)).sort()];
  if (sort === 'name') categories.sort((a, b) => a.localeCompare(b));
  if (sort === 'amount') categories.sort((a, b) => (total.expenses.get(b) || 0) - (total.expenses.get(a) || 0) || a.localeCompare(b));

  const values = (pick) => Object.fromEntries(cols.map((c) => [c.key, fromCents(pick(c.period))]));
  const rows = [
    { type: 'section', label: 'Income' },
    { type: 'line', label: 'Discount Received', depth: 1, values: values((p) => p.discountReceivedCents) },
    { type: 'line', label: 'Sales Income', depth: 1, values: values((p) => p.salesIncomeCents) },
    { type: 'total', label: 'Total Income', values: values((p) => p.totalIncomeCents) },
    { type: 'section', label: 'Cost of Goods Sold' },
    { type: 'line', label: 'Cost of Goods Sold', depth: 1, values: values((p) => p.salesCogsCents) },
    { type: 'line', label: 'Inventory Adjustments', depth: 1, values: values((p) => p.inventoryAdjustmentCents) },
    { type: 'total', label: 'Total COGS', values: values((p) => p.cogsCents) },
    { type: 'grand', label: 'Gross Profit', values: values((p) => p.grossProfitCents) },
    { type: 'section', label: 'Expense' },
    ...categories.map((name) => ({ type: 'line', label: name, depth: 1, values: values((p) => p.expenses.get(name) || 0) })),
    { type: 'total', label: 'Total Expense', values: values((p) => p.totalExpenseCents) },
    { type: 'grand', label: 'Net Income', values: values((p) => p.netIncomeCents) },
  ];

  return {
    title: 'Profit & Loss',
    business: BUSINESS_NAME,
    basis,
    columnsMode: columns,
    sort,
    range: { from: toDayString(start), to: toDayString(end) },
    columns: cols.map(({ key, label }) => ({ key, label })),
    rows,
    generatedAt: new Date(),
  };
}

const monthDay = (s) => new Date(`${s}T12:00:00`).toLocaleString('en-US', { month: 'long', day: 'numeric' });
const fullDay = (s) => new Date(`${s}T12:00:00`).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// "September 1 - 19, 2026" style label (falls back to two full dates across months/years).
export function formatProfitLossRange({ from, to }) {
  if (from === to) return fullDay(from);
  const [fy, fm] = from.split('-');
  const [ty, tm] = to.split('-');
  if (fy === ty && fm === tm) return `${monthDay(from)} - ${Number(to.split('-')[2])}, ${fy}`;
  if (fy === ty) return `${monthDay(from)} - ${monthDay(to)}, ${fy}`;
  return `${fullDay(from)} - ${fullDay(to)}`;
}

export const basisLabel = (basis) => (basis === 'cash' ? 'Cash Basis' : 'Accrual Basis');

export async function profitLossToWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = report.business;
  const ws = wb.addWorksheet('Profit & Loss', { views: [{ showGridLines: false }] });
  const lastCol = report.columns.length + 1;

  ws.getColumn(1).width = 46;
  report.columns.forEach((_, i) => { ws.getColumn(i + 2).width = 16; });

  const heading = (text, size, bold) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, lastCol);
    row.getCell(1).font = { size, bold };
    row.getCell(1).alignment = { horizontal: 'center' };
  };
  heading(report.business, 14, true);
  heading(report.title, 12, true);
  heading(formatProfitLossRange(report.range), 10, false);
  heading(basisLabel(report.basis), 10, false);
  ws.addRow([]);

  const header = ws.addRow(['', ...report.columns.map((c) => c.label)]);
  header.font = { bold: true };
  header.eachCell((cell, n) => { if (n > 1) cell.alignment = { horizontal: 'right' }; });
  header.border = { bottom: { style: 'thin' } };

  for (const r of report.rows) {
    const label = `${'    '.repeat(r.depth || 0)}${r.label}`;
    const row = ws.addRow([label, ...(r.values ? report.columns.map((c) => r.values[c.key]) : [])]);
    row.eachCell((cell, n) => { if (n > 1) cell.numFmt = '#,##0.00;[Red]-#,##0.00'; });
    if (r.type === 'section') row.font = { bold: true };
    if (r.type === 'total') { row.font = { bold: true }; row.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; }); }
    if (r.type === 'grand') {
      row.font = { bold: true };
      row.eachCell((cell) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; });
    }
  }
  return wb;
}
