import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import Expense from '../models/Expense.js';
import InventoryItem from '../models/InventoryItem.js';
import InventoryLot from '../models/InventoryLot.js';
import AccountTransaction from '../models/AccountTransaction.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { ApiError } from '../utils/ApiError.js';
import { buildProfitLoss, profitLossToWorkbook } from '../services/profitLossService.js';
import { buildBalanceSheet } from '../services/balanceSheetService.js';
import ExcelJS from 'exceljs';
import { BUSINESS_NAME } from '../config/business.js';

const DEFAULT_NEAR_EXPIRY_DAYS = 30;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// Posted expenses in a date range, grouped by category (largest first). Shared
// by the Expense report and the Profit & Loss report so both always agree.
async function expensesByCategory(start, end) {
  const rows = await Expense.aggregate([
    { $match: { status: 'POSTED', date: { $gte: start, $lte: end } } },
    { $group: { _id: '$category', amount: { $sum: '$amountCents' }, count: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);
  const totalCents = rows.reduce((sum, r) => sum + r.amount, 0);
  return { rows, totalCents };
}

// GET /api/reports/profit-loss?from=&to=&basis=accrual|cash&columns=total|month&sort=default|amount|name
export const profitLossReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await buildProfitLoss(req.query) });
});

// GET /api/reports/profit-loss/export -- the same report as an .xlsx download.
export const profitLossExport = asyncHandler(async (req, res) => {
  const report = await buildProfitLoss(req.query);
  const workbook = await profitLossToWorkbook(report);
  const filename = `profit-and-loss_${report.range.from}_to_${report.range.to}_${report.basis}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
});

// GET /api/reports/balance-sheet?date=
export const balanceSheetReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await buildBalanceSheet({ date: req.query.date }) });
});

// GET /api/reports/balance-sheet/export -- the same report as an .xlsx download.
export const balanceSheetExport = asyncHandler(async (req, res) => {
  const report = await buildBalanceSheet({ date: req.query.date });
  const wb = new ExcelJS.Workbook();
  wb.creator = BUSINESS_NAME;
  const ws = wb.addWorksheet('Balance Sheet', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 18;

  const heading = (text, size, bold) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, 2);
    row.getCell(1).font = { size, bold };
    row.getCell(1).alignment = { horizontal: 'center' };
  };
  heading(report.business, 14, true);
  heading(report.title, 12, true);
  heading(`As of ${report.asOf}`, 10, false);
  ws.addRow([]);

  const line = (label, value, { bold = false, indent = 0, topBorder = false } = {}) => {
    const row = ws.addRow([`${'    '.repeat(indent)}${label}`, value]);
    row.getCell(2).numFmt = '#,##0.00;[Red]-#,##0.00';
    if (bold) row.font = { bold: true };
    if (topBorder) row.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; });
  };

  line('ASSETS', '', { bold: true });
  line('Checking/Savings (Accounts)', report.assets.cash, { indent: 1 });
  line('Accounts Receivable', report.assets.receivable, { indent: 1 });
  line('Inventory Asset', report.assets.inventory, { indent: 1 });
  line('Total Current Assets', report.assets.totalCurrentAssets, { bold: true, topBorder: true });
  line('Fixed Assets', report.assets.fixedAssets, { indent: 1 });
  line('TOTAL ASSETS', report.assets.totalAssets, { bold: true, topBorder: true });
  ws.addRow([]);
  line('LIABILITIES', '', { bold: true });
  line('Accounts Payable', report.liabilities.payable, { indent: 1 });
  line('Total Liabilities', report.liabilities.totalLiabilities, { bold: true, topBorder: true });
  ws.addRow([]);
  line('EQUITY', '', { bold: true });
  line("Partners' Capital", report.equity.partnersCapital, { indent: 1 });
  line('Retained Earnings', report.equity.retainedEarnings, { indent: 1 });
  line('Net Income', report.equity.netIncome, { indent: 1 });
  line('Total Equity', report.equity.totalEquity, { bold: true, topBorder: true });
  ws.addRow([]);
  line('TOTAL LIABILITIES & EQUITY', report.totalLiabilitiesAndEquity, { bold: true, topBorder: true });

  const filename = `balance-sheet_${report.asOf}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/reports/expenses
export const expenseReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const [{ rows, totalCents }, byDay, list] = await Promise.all([
    expensesByCategory(start, end),
    Expense.aggregate([
      { $match: { status: 'POSTED', date: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, amount: { $sum: '$amountCents' } } },
      { $sort: { _id: 1 } },
    ]),
    Expense.find({ status: 'POSTED', date: { $gte: start, $lte: end } }).sort({ date: -1, createdAt: -1 }).limit(500),
  ]);

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalExpenses: fromCents(totalCents),
      byCategory: rows.map((r) => ({ category: r._id, amount: fromCents(r.amount), count: r.count, percent: pct(r.amount, totalCents) })),
      byDay: byDay.map((d) => ({ date: d._id, amount: fromCents(d.amount) })),
      expenses: list.map((e) => ({
        id: e._id,
        expenseNumber: e.expenseNumber,
        date: e.date,
        category: e.category,
        amount: fromCents(e.amountCents),
        note: e.note,
        paymentAccountName: e.paymentAccountName,
      })),
    },
  });
});

// GET /api/reports/payment-methods -- money actually collected, per payment
// account: customer sale payments and debt payments plus wallet deposits,
// counted when they POST to the ledger (a same-day Draft's payment only lands
// at Close Day). Refunds are not netted here -- this is gross collections.
export const paymentMethodReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const rows = await AccountTransaction.aggregate([
    {
      $match: {
        status: 'POSTED',
        direction: 'IN',
        type: { $in: ['SALE_PAYMENT', 'CUSTOMER_DEBT_PAYMENT', 'DEPOSIT'] },
        postedAt: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: { account: '$account', type: '$type' }, amount: { $sum: '$amountCents' } } },
    { $lookup: { from: 'accounts', localField: '_id.account', foreignField: '_id', as: 'accountDoc' } },
    { $addFields: { accountName: { $ifNull: [{ $arrayElemAt: ['$accountDoc.name', 0] }, 'Deleted account'] } } },
  ]);

  const byAccount = new Map();
  for (const row of rows) {
    const key = String(row._id.account);
    const entry = byAccount.get(key) || { account: row.accountName, sales: 0, debtPayments: 0, deposits: 0 };
    if (row._id.type === 'SALE_PAYMENT') entry.sales += row.amount;
    else if (row._id.type === 'CUSTOMER_DEBT_PAYMENT') entry.debtPayments += row.amount;
    else entry.deposits += row.amount;
    byAccount.set(key, entry);
  }

  const methods = [...byAccount.values()]
    .map((m) => ({ ...m, total: m.sales + m.debtPayments + m.deposits }))
    .sort((a, b) => b.total - a.total);
  const totalCents = methods.reduce((sum, m) => sum + m.total, 0);

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalCollected: fromCents(totalCents),
      methods: methods.map((m) => ({
        account: m.account,
        salePayments: fromCents(m.sales),
        debtPayments: fromCents(m.debtPayments),
        deposits: fromCents(m.deposits),
        total: fromCents(m.total),
        percent: pct(m.total, totalCents),
      })),
    },
  });
});

// GET /api/reports/expired-products?mode=expired|near&days=30
// One row per batch (InventoryLot) still holding stock. An item whose own
// expiryDate matches but that has no expiring lot on hand is reported once as
// a whole-item row so legacy stock entered without batches is never missed.
export const expiredProductsReport = asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'near' ? 'near' : 'expired';
  const days = req.query.days === undefined ? DEFAULT_NEAR_EXPIRY_DAYS : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ApiError(400, 'Days must be a whole number between 1 and 3650.');

  const now = new Date();
  const expiryFilter =
    mode === 'expired'
      ? { $ne: null, $lt: now }
      : { $ne: null, $gte: now, $lte: new Date(now.getTime() + days * 86400000) };

  const [lots, items] = await Promise.all([
    InventoryLot.find({ remainingQuantity: { $gt: 0 }, expiryDate: expiryFilter }).populate('item', 'name itemCode batchNumber'),
    InventoryItem.find({ quantity: { $gt: 0 }, expiryDate: expiryFilter }).select('name itemCode batchNumber quantity costPriceCents expiryDate'),
  ]);

  const rows = [];
  const itemsWithLotRow = new Set();
  for (const lot of lots) {
    if (!lot.item) continue;
    itemsWithLotRow.add(String(lot.item._id));
    rows.push({
      itemId: lot.item._id,
      itemName: lot.item.name,
      itemCode: lot.item.itemCode,
      batch: lot.stockSerial || lot.item.batchNumber || '',
      expiryDate: lot.expiryDate,
      quantity: lot.remainingQuantity,
      valueCents: lot.remainingQuantity * lot.unitCostCents,
    });
  }
  for (const item of items) {
    if (itemsWithLotRow.has(String(item._id))) continue;
    rows.push({
      itemId: item._id,
      itemName: item.name,
      itemCode: item.itemCode,
      batch: item.batchNumber || '',
      expiryDate: item.expiryDate,
      quantity: item.quantity,
      valueCents: item.quantity * item.costPriceCents,
    });
  }
  rows.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  const totalValueCents = rows.reduce((sum, r) => sum + r.valueCents, 0);
  res.json({
    success: true,
    data: {
      mode,
      days,
      asOf: now,
      totalQuantity: rows.reduce((sum, r) => sum + r.quantity, 0),
      totalValue: fromCents(totalValueCents),
      items: rows.map((r) => ({
        itemId: r.itemId,
        itemName: r.itemName,
        itemCode: r.itemCode,
        batch: r.batch,
        expiryDate: r.expiryDate,
        quantity: r.quantity,
        value: fromCents(r.valueCents),
      })),
    },
  });
});

// GET /api/reports/low-stock -- active items at or below their Minimum Stock
// (out-of-stock items included, flagged separately), emptiest first.
export const lowStockReport = asyncHandler(async (req, res) => {
  const items = await InventoryItem.find({
    status: 'active',
    $expr: { $lte: ['$quantity', '$lowStockThreshold'] },
  })
    .populate('category', 'name')
    .sort({ quantity: 1, name: 1 });

  const rows = items.map((i) => ({
    itemId: i._id,
    itemName: i.name,
    itemCode: i.itemCode,
    category: i.category?.name || 'Uncategorized',
    quantity: i.quantity,
    unit: i.unit,
    minimumStock: i.lowStockThreshold,
    shortfall: Math.max(0, i.lowStockThreshold - i.quantity),
    status: i.quantity <= 0 ? 'OUT' : 'LOW',
  }));

  res.json({
    success: true,
    data: {
      asOf: new Date(),
      lowCount: rows.filter((r) => r.status === 'LOW').length,
      outCount: rows.filter((r) => r.status === 'OUT').length,
      items: rows,
    },
  });
});

// GET /api/reports/sales-returns -- one row per return event (not per line),
// so the total reconciles exactly with the returned value applied to each
// invoice (which already accounts for any invoice-level discount).
export const salesReturnReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const rows = await Sale.aggregate([
    { $match: { 'returns.createdAt': { $gte: start, $lte: end } } },
    { $unwind: '$returns' },
    { $match: { 'returns.createdAt': { $gte: start, $lte: end } } },
    { $sort: { 'returns.createdAt': -1 } },
    {
      $project: {
        saleId: '$_id',
        receiptNumber: 1,
        customerName: 1,
        returnIndex: '$returns._id',
        date: '$returns.createdAt',
        items: '$returns.items',
        amountCents: '$returns.amountCents',
        refundCents: '$returns.refundCents',
        debtReducedCents: '$returns.debtReducedCents',
        reason: '$returns.reason',
      },
    },
  ]);

  const totalCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalReturns: rows.length,
      totalReturnValue: fromCents(totalCents),
      totalRefunded: fromCents(rows.reduce((sum, r) => sum + (r.refundCents || 0), 0)),
      returns: rows.map((r) => ({
        saleId: r.saleId,
        receiptNumber: r.receiptNumber,
        customerName: r.customerName,
        date: r.date,
        items: (r.items || []).map((i) => ({ name: i.itemName, quantity: i.quantity })),
        quantity: (r.items || []).reduce((sum, i) => sum + (i.quantity || 0), 0),
        value: fromCents(r.amountCents),
        refunded: fromCents(r.refundCents || 0),
        reason: r.reason || '',
      })),
    },
  });
});

// GET /api/reports/purchase-returns -- the system has no partial purchase
// return; sending goods back to a supplier is recording the invoice as voided
// (stock removed, payments refunded). So this lists voided purchases by the
// date they were voided.
export const purchaseReturnReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const purchases = await Purchase.find({ status: 'voided', voidedAt: { $gte: start, $lte: end } }).sort({ voidedAt: -1 });

  const totalCents = purchases.reduce((sum, p) => sum + p.totalCostCents, 0);
  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalReturns: purchases.length,
      totalReturnValue: fromCents(totalCents),
      returns: purchases.map((p) => ({
        purchaseId: p._id,
        purchaseNumber: p.purchaseNumber,
        supplierName: p.supplierName,
        date: p.voidedAt,
        items: p.items.map((i) => ({ name: i.itemName, quantity: i.quantity })),
        quantity: p.items.reduce((sum, i) => sum + i.quantity, 0),
        value: fromCents(p.totalCostCents),
        reason: p.voidedReason || '',
      })),
    },
  });
});
