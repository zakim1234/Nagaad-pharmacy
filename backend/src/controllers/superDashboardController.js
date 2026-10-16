import Branch from '../models/Branch.js';
import Purchase from '../models/Purchase.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
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
