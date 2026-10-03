import Sale from '../models/Sale.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';

const NEAR_EXPIRY_DAYS = 30;

export const getDashboard = asyncHandler(async (req, res) => {
  const today = resolveDateRange({ range: 'today' });
  const last14 = new Date();
  last14.setDate(last14.getDate() - 13);
  last14.setHours(0, 0, 0, 0);
  const last12MonthsStart = new Date();
  last12MonthsStart.setMonth(last12MonthsStart.getMonth() - 11);
  last12MonthsStart.setDate(1);
  last12MonthsStart.setHours(0, 0, 0, 0);

  const [
    todayAgg,
    inventoryStats,
    lowStockCount,
    nearExpiryCount,
    debtAgg,
    dailySalesAgg,
    monthlySalesAgg,
    topSellingAgg,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', createdAt: { $gte: today.start, $lte: today.end } } },
      { $group: { _id: null, revenue: { $sum: '$totalCents' }, profit: { $sum: '$profitCents' }, count: { $sum: 1 } } },
    ]),
    InventoryItem.aggregate([
      {
        $group: {
          _id: null,
          totalItems: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' },
          stockValueCents: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } },
        },
      },
    ]),
    InventoryItem.countDocuments({
      $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] },
    }),
    InventoryItem.countDocuments({
      expiryDate: { $ne: null, $gte: new Date(), $lte: new Date(Date.now() + NEAR_EXPIRY_DAYS * 86400000) },
    }),
    Customer.aggregate([
      { $match: { balanceCents: { $gt: 0 } } },
      { $group: { _id: null, totalDebt: { $sum: '$balanceCents' } } },
    ]),
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', createdAt: { $gte: last14 } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalCents' },
          profit: { $sum: '$profitCents' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', createdAt: { $gte: last12MonthsStart } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$totalCents' },
          profit: { $sum: '$profitCents' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', createdAt: { $gte: last14 } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.itemName',
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.subtotalCents' },
        },
      },
      { $sort: { quantity: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const inv = inventoryStats[0] || { totalItems: 0, totalQuantity: 0, stockValueCents: 0 };
  const todayStats = todayAgg[0] || { revenue: 0, profit: 0, count: 0 };
  const totalDebtCents = debtAgg[0]?.totalDebt || 0;
  const outOfStock = await InventoryItem.countDocuments({ quantity: { $lte: 0 } });
  const expiredCount = await InventoryItem.countDocuments({ expiryDate: { $ne: null, $lt: new Date() } });

  res.json({
    success: true,
    data: {
      cards: {
        todaySales: fromCents(todayStats.revenue),
        todayProfit: fromCents(todayStats.profit),
        todaySalesCount: todayStats.count,
        totalInventoryItems: inv.totalItems,
        totalStockQuantity: inv.totalQuantity,
        stockValue: fromCents(inv.stockValueCents),
        customerDebt: fromCents(totalDebtCents),
        lowStockCount,
        outOfStockCount: outOfStock,
        expiredCount,
        nearExpiryCount,
      },
      charts: {
        dailySales: dailySalesAgg.map((d) => ({ date: d._id, revenue: fromCents(d.revenue), profit: fromCents(d.profit) })),
        monthlySales: monthlySalesAgg.map((d) => ({ month: d._id, revenue: fromCents(d.revenue), profit: fromCents(d.profit) })),
        topSelling: topSellingAgg.map((d) => ({ name: d._id, quantity: d.quantity, revenue: fromCents(d.revenue) })),
      },
    },
  });
});
