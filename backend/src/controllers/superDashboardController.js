import Branch from '../models/Branch.js';
import Purchase from '../models/Purchase.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import User from '../models/User.js';
import BusinessDay from '../models/BusinessDay.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { runWithBranch } from '../services/branchContext.js';
import { computePeriod } from '../services/profitLossService.js';

const NEAR_EXPIRY_DAYS = 30;

// One branch's figures for the period. Runs inside that branch's context,
// so every query below only sees that branch -- the same numbers its own
// Profit & Loss, Balance Sheet and stock reports show.
async function branchFigures(start, end) {
  const now = new Date();
  const soon = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 86400000);
  const [pnl, [purchases], [stock], [custDebt], [suppDebt], lowStock, outOfStock, expired, nearExpiry] = await Promise.all([
    computePeriod({ start, end, basis: 'accrual' }),
    Purchase.aggregate([{ $match: { status: 'completed', purchaseDate: { $gte: start, $lte: end } } }, { $group: { _id: null, c: { $sum: '$totalCostCents' } } }]),
    InventoryItem.aggregate([{ $match: { quantity: { $gt: 0 } } }, { $group: { _id: null, c: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } } } }]),
    Customer.aggregate([{ $match: { balanceCents: { $gt: 0 } } }, { $group: { _id: null, c: { $sum: '$balanceCents' } } }]),
    Purchase.aggregate([{ $match: { status: 'completed', balanceCents: { $gt: 0 } } }, { $group: { _id: null, c: { $sum: '$balanceCents' } } }]),
    InventoryItem.countDocuments({ $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] } }),
    InventoryItem.countDocuments({ quantity: { $lte: 0 } }),
    InventoryItem.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $ne: null, $lt: now } }),
    InventoryItem.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $ne: null, $gte: now, $lte: soon } }),
  ]);
  return {
    salesCents: pnl.totalIncomeCents,
    grossProfitCents: pnl.grossProfitCents,
    profitCents: pnl.netIncomeCents,
    purchasesCents: purchases?.c || 0,
    stockValueCents: stock?.c || 0,
    customerDebtCents: custDebt?.c || 0,
    supplierDebtCents: suppDebt?.c || 0,
    alerts: { lowStock, outOfStock, expired, nearExpiry },
  };
}

const money = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/Cents$/, ''), typeof v === 'number' ? fromCents(v) : v]));

// GET /api/branches/dashboard?range=this_month|...&from=&to= -- Super Admin:
// every branch's sales, purchases, profit, stock value and debts for the
// period, the totals across all branches, and each branch's stock alerts.
export const getSuperDashboard = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange({ range: req.query.range || 'month', from: req.query.from, to: req.query.to });
  const branches = await Branch.find().sort({ createdAt: 1 });

  const rows = [];
  for (const b of branches) {
    const f = await runWithBranch(b._id, () => branchFigures(start, end));
    rows.push({ branchId: b._id, name: b.name, active: b.active, ...f });
  }
  const keys = ['salesCents', 'grossProfitCents', 'profitCents', 'purchasesCents', 'stockValueCents', 'customerDebtCents', 'supplierDebtCents'];
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)]));

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totals: money(totals),
      branches: rows.map(({ alerts, ...r }) => ({ ...money(r), alerts })),
    },
  });
});

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// One branch's live picture for the Super Admin's home dashboard.
async function branchLive() {
  const today = startOfToday();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const last14 = new Date(today.getTime() - 13 * 86400000);
  const soon = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 86400000);
  const sum = (match) =>
    Sale.aggregate([{ $match: match }, { $group: { _id: null, revenue: { $sum: '$totalCents' }, profit: { $sum: '$profitCents' }, count: { $sum: 1 } } }]).then((r) => r[0] || { revenue: 0, profit: 0, count: 0 });
  const [todayC, todayPending, month, daily, [stock], [debt], lowStock, expired, nearExpiry, recent] = await Promise.all([
    sum({ status: 'CONFIRMED', createdAt: { $gte: today } }),
    sum({ status: 'DRAFT', createdAt: { $gte: today } }),
    sum({ status: 'CONFIRMED', createdAt: { $gte: monthStart } }),
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', createdAt: { $gte: last14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$totalCents' } } },
    ]),
    InventoryItem.aggregate([{ $match: { quantity: { $gt: 0 } } }, { $group: { _id: null, c: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } } } }]),
    Customer.aggregate([{ $match: { balanceCents: { $gt: 0 } } }, { $group: { _id: null, c: { $sum: '$balanceCents' } } }]),
    InventoryItem.countDocuments({ $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] } }),
    InventoryItem.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $ne: null, $lt: now } }),
    InventoryItem.countDocuments({ quantity: { $gt: 0 }, expiryDate: { $ne: null, $gte: now, $lte: soon } }),
    Sale.find({ status: { $in: ['DRAFT', 'CONFIRMED'] } }).sort({ createdAt: -1 }).limit(5).select('receiptNumber customerName totalCents status createdAt'),
  ]);
  return { todayC, todayPending, month, daily, stockCents: stock?.c || 0, debtCents: debt?.c || 0, alerts: { lowStock, expired, nearExpiry }, recent };
}

// GET /api/branches/overview -- Super Admin home: today and this month for
// the whole company and each branch, the last 14 days per branch, each
// branch's open/closed day and staff, alerts, and the latest sales.
export const getSuperOverview = asyncHandler(async (req, res) => {
  const branches = await Branch.find().sort({ createdAt: 1 });
  const staff = new Map(
    (await User.aggregate([{ $match: { branch: { $ne: null }, active: { $ne: false } } }, { $group: { _id: '$branch', n: { $sum: 1 } } }])).map((r) => [String(r._id), r.n])
  );
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(startOfToday().getTime() - (13 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });

  const rows = [];
  const recent = [];
  for (const b of branches) {
    const live = await runWithBranch(b._id, () => branchLive());
    const day = await BusinessDay.findById(`current:${b._id}`).setOptions({ skipBranch: true });
    const byDay = new Map(live.daily.map((d) => [d._id, d.revenue]));
    rows.push({
      branchId: b._id,
      name: b.name,
      active: b.active,
      dayStatus: day?.status || 'OPEN',
      staff: staff.get(String(b._id)) || 0,
      todaySales: fromCents(live.todayC.revenue),
      todayProfit: fromCents(live.todayC.profit),
      todayCount: live.todayC.count,
      pendingSales: fromCents(live.todayPending.revenue),
      pendingCount: live.todayPending.count,
      monthSales: fromCents(live.month.revenue),
      monthProfit: fromCents(live.month.profit),
      stockValue: fromCents(live.stockCents),
      customerDebt: fromCents(live.debtCents),
      alerts: live.alerts,
      daily: days.map((d) => fromCents(byDay.get(d) || 0)),
    });
    for (const s of live.recent) recent.push({ branch: b.name, receiptNumber: s.receiptNumber, customerName: s.customerName, total: fromCents(s.totalCents), status: s.status, createdAt: s.createdAt });
  }
  const total = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
  res.json({
    success: true,
    data: {
      totals: {
        todaySales: total('todaySales'),
        todayProfit: total('todayProfit'),
        pendingSales: total('pendingSales'),
        monthSales: total('monthSales'),
        monthProfit: total('monthProfit'),
        stockValue: total('stockValue'),
        customerDebt: total('customerDebt'),
        staff: rows.reduce((s, r) => s + r.staff, 0),
      },
      branches: rows,
      days,
      recent: recent.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8),
    },
  });
});
