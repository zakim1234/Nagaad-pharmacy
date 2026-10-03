import Sale from '../models/Sale.js';
import Purchase from '../models/Purchase.js';
import InventoryItem from '../models/InventoryItem.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { ApiError } from '../utils/ApiError.js';

const NEAR_EXPIRY_DAYS = 30;

// GET /api/reports/sales -- CONFIRMED invoices only (Draft/Cancelled never
// count toward finalized revenue/profit/reporting).
export const salesReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const match = { status: 'CONFIRMED', createdAt: { $gte: start, $lte: end } };

  const [[agg], byDay, topByQty, topByRevenue, cashVsCredit, receivablesAgg, byAccount] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$totalCents' },
          numberOfSales: { $sum: 1 },
          itemsSold: { $sum: { $sum: '$items.quantity' } },
          cashCollected: { $sum: '$paidAmountCents' },
          creditSales: { $sum: '$balanceAddedCents' },
        },
      },
    ]),
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemName', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotalCents' } } },
      { $sort: { quantity: -1 } },
      { $limit: 8 },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemName', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotalCents' } } },
      { $sort: { revenue: -1 } },
      { $limit: 8 },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: null, cash: { $sum: '$paidAmountCents' }, credit: { $sum: '$balanceAddedCents' } } },
    ]),
    // Outstanding receivables is a current balance-sheet figure, not scoped to the date range.
    Sale.aggregate([
      { $match: { status: 'CONFIRMED', outstandingCents: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$outstandingCents' } } },
    ]),
    Sale.aggregate([
      { $match: { ...match, paymentAccount: { $ne: null }, paidAmountCents: { $gt: 0 } } },
      { $lookup: { from: 'accounts', localField: 'paymentAccount', foreignField: '_id', as: 'acc' } },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$acc.name', 0] }, 'Unknown'] }, amount: { $sum: '$paidAmountCents' } } },
      { $sort: { amount: -1 } },
    ]),
  ]);

  const totalSales = agg?.totalSales || 0;
  const numberOfSales = agg?.numberOfSales || 0;

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalSales: fromCents(totalSales),
      numberOfSales,
      itemsSold: agg?.itemsSold || 0,
      cashCollected: fromCents(agg?.cashCollected || 0),
      creditSales: fromCents(agg?.creditSales || 0),
      outstandingReceivables: fromCents(receivablesAgg[0]?.total || 0),
      averageSaleValue: numberOfSales > 0 ? fromCents(Math.round(totalSales / numberOfSales)) : 0,
      byDay: byDay.map((d) => ({ date: d._id, revenue: fromCents(d.revenue), count: d.count })),
      topByQuantity: topByQty.map((d) => ({ name: d._id, quantity: d.quantity, revenue: fromCents(d.revenue) })),
      topByRevenue: topByRevenue.map((d) => ({ name: d._id, quantity: d.quantity, revenue: fromCents(d.revenue) })),
      cashVsCredit: {
        cash: fromCents(cashVsCredit[0]?.cash || 0),
        credit: fromCents(cashVsCredit[0]?.credit || 0),
      },
      paymentByAccount: byAccount.map((a) => ({ account: a._id, amount: fromCents(a.amount) })),
    },
  });
});

// GET /api/reports/profit
export const profitReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const match = { status: 'CONFIRMED', createdAt: { $gte: start, $lte: end } };

  const [[agg], byDay, byItem, byCategory] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$totalCents' },
          costOfGoodsSold: { $sum: '$costOfGoodsCents' },
          grossProfit: { $sum: '$profitCents' },
          unitsSold: { $sum: { $sum: '$items.quantity' } },
        },
      },
    ]),
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$totalCents' },
          cost: { $sum: '$costOfGoodsCents' },
          profit: { $sum: '$profitCents' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: { itemId: '$items.item', itemName: '$items.itemName' },
          // Net of this line's own discount (the canonical per-line revenue
          // formula also used by saleController.toDTO's `lineTotal`).
          // Residual invoice-level discount not tied to any one line is not
          // allocated across lines here -- there is no existing allocation
          // formula for that anywhere in the app, so this breakdown may not
          // sum to exactly the invoice-level total when one is present.
          revenue: { $sum: { $subtract: ['$items.subtotalCents', { $ifNull: ['$items.discountCents', 0] }] } },
          // Authoritative historical COGS: the WAC snapshot frozen on the
          // line at Close Day confirm time (never today's item cost, never
          // recalculated from lot allocations -- see dayCloseService).
          cost: { $sum: { $multiply: ['$items.quantity', '$items.costPriceCents'] } },
        },
      },
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { profit: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      {
        $lookup: { from: 'inventoryitems', localField: 'items.item', foreignField: '_id', as: 'itemDoc' },
      },
      { $addFields: { categoryId: { $arrayElemAt: ['$itemDoc.category', 0] } } },
      {
        $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'categoryDoc' },
      },
      { $addFields: { category: { $ifNull: [{ $arrayElemAt: ['$categoryDoc.name', 0] }, 'Uncategorized'] } } },
      {
        $group: {
          _id: '$category',
          revenue: { $sum: { $subtract: ['$items.subtotalCents', { $ifNull: ['$items.discountCents', 0] }] } },
          cost: { $sum: { $multiply: ['$items.quantity', '$items.costPriceCents'] } },
        },
      },
      { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
      { $sort: { profit: -1 } },
    ]),
  ]);

  const revenue = agg?.revenue || 0;
  const grossProfit = agg?.grossProfit || 0;
  const profitByItem = byItem.map((d) => ({
    itemId: d._id.itemId,
    name: d._id.itemName,
    revenue: fromCents(d.revenue),
    cost: fromCents(d.cost),
    profit: fromCents(d.profit),
    marginPct: d.revenue > 0 ? Math.round((d.profit / d.revenue) * 1000) / 10 : 0,
  }));

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      revenue: fromCents(revenue),
      costOfGoodsSold: fromCents(agg?.costOfGoodsSold || 0),
      grossProfit: fromCents(grossProfit),
      grossMarginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
      unitsSold: agg?.unitsSold || 0,
      byDay: byDay.map((d) => ({ date: d._id, revenue: fromCents(d.revenue), cost: fromCents(d.cost), profit: fromCents(d.profit) })),
      profitByItem,
      topProfitItems: profitByItem.slice(0, 10),
      lowestProfitItems: [...profitByItem].reverse().slice(0, 10),
      lossItems: profitByItem.filter((i) => i.profit < 0),
      profitByCategory: byCategory.map((d) => ({
        category: d._id,
        revenue: fromCents(d.revenue),
        cost: fromCents(d.cost),
        profit: fromCents(d.profit),
      })),
    },
  });
});

// GET /api/reports/profit/items/:itemId -- drill-down: which invoices produced this item's profit
export const profitByItemDrilldown = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const itemId = req.params.itemId;

  const sales = await Sale.find({
    status: 'CONFIRMED',
    createdAt: { $gte: start, $lte: end },
    'items.item': itemId,
  })
    .sort({ createdAt: -1 })
    .select('receiptNumber createdAt items customerName');

  const rows = [];
  for (const sale of sales) {
    for (const line of sale.items) {
      if (String(line.item) !== String(itemId)) continue;
      const lineRevenueCents = line.subtotalCents - (line.discountCents || 0);
      const lineCostCents = line.quantity * line.costPriceCents; // WAC snapshot frozen at Close Day -- never lot-blended, never today's cost
      rows.push({
        saleId: sale._id,
        receiptNumber: sale.receiptNumber,
        customerName: sale.customerName,
        createdAt: sale.createdAt,
        quantity: line.quantity,
        revenue: fromCents(lineRevenueCents),
        cost: fromCents(lineCostCents),
        profit: fromCents(lineRevenueCents - lineCostCents),
      });
    }
  }

  res.json({ success: true, data: { itemId, range: { from: start, to: end }, invoices: rows } });
});

// GET /api/reports/inventory
export const inventoryReport = asyncHandler(async (req, res) => {
  const [valueAgg, byCategory, mostStocked, mostValuable] = await Promise.all([
    InventoryItem.aggregate([
      {
        $group: {
          _id: null,
          stockValueAtCost: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } },
          stockValueAtSelling: { $sum: { $multiply: ['$quantity', '$sellingPriceCents'] } },
          totalItems: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' },
        },
      },
    ]),
    InventoryItem.aggregate([
      {
        $lookup: { from: 'categories', localField: 'category', foreignField: '_id', as: 'categoryDoc' },
      },
      { $addFields: { categoryName: { $ifNull: [{ $arrayElemAt: ['$categoryDoc.name', 0] }, 'Uncategorized'] } } },
      {
        $group: {
          _id: '$categoryName',
          costValue: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } },
          sellingValue: { $sum: { $multiply: ['$quantity', '$sellingPriceCents'] } },
        },
      },
      { $sort: { costValue: -1 } },
    ]),
    InventoryItem.find().sort({ quantity: -1 }).limit(8).select('name quantity'),
    InventoryItem.aggregate([
      { $addFields: { stockValue: { $multiply: ['$quantity', '$costPriceCents'] } } },
      { $sort: { stockValue: -1 } },
      { $limit: 8 },
      { $project: { name: 1, stockValue: 1 } },
    ]),
  ]);

  const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 86400000);
  const [lowStock, outOfStock, expired, nearExpiry] = await Promise.all([
    InventoryItem.find({
      $expr: { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$lowStockThreshold'] }] },
    }).select('name itemCode quantity lowStockThreshold'),
    InventoryItem.find({ quantity: { $lte: 0 } }).select('name itemCode quantity'),
    InventoryItem.find({ expiryDate: { $ne: null, $lt: new Date() } }).select('name itemCode quantity expiryDate'),
    InventoryItem.find({ expiryDate: { $ne: null, $gte: new Date(), $lte: cutoff } }).select(
      'name itemCode quantity expiryDate'
    ),
  ]);

  const stockValueAtCost = valueAgg[0]?.stockValueAtCost || 0;
  const stockValueAtSelling = valueAgg[0]?.stockValueAtSelling || 0;

  res.json({
    success: true,
    data: {
      stockValueAtCost: fromCents(stockValueAtCost),
      stockValueAtSelling: fromCents(stockValueAtSelling),
      potentialGrossProfit: fromCents(stockValueAtSelling - stockValueAtCost),
      totalItems: valueAgg[0]?.totalItems || 0,
      totalQuantity: valueAgg[0]?.totalQuantity || 0,
      lowStock,
      outOfStock,
      expired,
      nearExpiry,
      valueByCategory: byCategory.map((c) => ({
        category: c._id || 'Uncategorized',
        costValue: fromCents(c.costValue),
        sellingValue: fromCents(c.sellingValue),
      })),
      mostStockedItems: mostStocked.map((i) => ({ name: i.name, quantity: i.quantity })),
      mostValuableItems: mostValuable.map((i) => ({ name: i.name, stockValue: fromCents(i.stockValue) })),
      stockDistribution: {
        healthy: valueAgg[0]?.totalItems ? valueAgg[0].totalItems - lowStock.length - outOfStock.length : 0,
        lowStock: lowStock.length,
        outOfStock: outOfStock.length,
      },
    },
  });
});

// GET /api/reports/customers -- debt overview across all customers (used by
// Seller/POS debt tools, intentionally not part of the main Reports nav)
export const customersReport = asyncHandler(async (req, res) => {
  const customers = await Customer.find({ balanceCents: { $ne: 0 } })
    .sort({ balanceCents: -1 })
    .select('name phone balanceCents totalPurchasedCents totalPaidCents');

  const [debtAgg] = await Customer.aggregate([
    { $match: { balanceCents: { $gt: 0 } } },
    { $group: { _id: null, totalDebt: { $sum: '$balanceCents' } } },
  ]);

  res.json({
    success: true,
    data: {
      totalOutstandingDebt: fromCents(debtAgg?.totalDebt || 0),
      customers: customers.map((c) => ({
        id: c._id,
        name: c.name,
        phone: c.phone,
        balance: fromCents(c.balanceCents),
        totalPurchased: fromCents(c.totalPurchasedCents),
        totalPaid: fromCents(c.totalPaidCents),
      })),
    },
  });
});

// GET /api/reports/purchases
export const purchasesReport = asyncHandler(async (req, res) => {
  const { start, end } = resolveDateRange(req.query);
  const match = { status: 'completed', createdAt: { $gte: start, $lte: end } };

  const [[agg], bySupplier, byProduct, mostPurchased, supplierCount] = await Promise.all([
    Purchase.aggregate([
      { $match: match },
      { $group: { _id: null, totalPurchases: { $sum: '$totalCostCents' }, count: { $sum: 1 }, units: { $sum: { $sum: '$items.quantity' } } } },
    ]),
    Purchase.aggregate([
      { $match: match },
      { $group: { _id: '$supplierName', spent: { $sum: '$totalCostCents' }, purchases: { $sum: 1 } } },
      { $sort: { spent: -1 } },
    ]),
    Purchase.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemName', spent: { $sum: '$items.subtotalCents' }, quantity: { $sum: '$items.quantity' } } },
      { $sort: { spent: -1 } },
      { $limit: 8 },
    ]),
    Purchase.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemName', quantity: { $sum: '$items.quantity' } } },
      { $sort: { quantity: -1 } },
      { $limit: 8 },
    ]),
    Purchase.distinct('supplier', match),
  ]);

  const totalPurchases = agg?.totalPurchases || 0;
  const count = agg?.count || 0;

  res.json({
    success: true,
    data: {
      range: { from: start, to: end },
      totalPurchases: fromCents(totalPurchases),
      numberOfPurchases: count,
      unitsPurchased: agg?.units || 0,
      numberOfSuppliers: supplierCount.length,
      averagePurchaseValue: count > 0 ? fromCents(Math.round(totalPurchases / count)) : 0,
      bySupplier: bySupplier.map((s) => ({ supplier: s._id, spent: fromCents(s.spent), purchases: s.purchases })),
      byProduct: byProduct.map((p) => ({ name: p._id, spent: fromCents(p.spent), quantity: p.quantity })),
      mostPurchasedItems: mostPurchased.map((p) => ({ name: p._id, quantity: p.quantity })),
    },
  });
});

// GET /api/reports/users -- minimal active-user list for the User
// Performance report's "Select User" filter. Lives under /reports (gated by
// the 'reports' module permission) rather than the admin-only /users
// endpoint, since any reports-permitted role should be able to run this
// report without needing full Users administration access.
export const listReportableUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ active: true }).sort({ name: 1 }).select('name username role');
  res.json({ success: true, data: users.map((u) => ({ id: u._id, name: u.name, username: u.username, role: u.role })) });
});

// GET /api/reports/user-performance -- per-cashier/user performance for a
// selected date range. Always derived from CONFIRMED sales' own historical
// fields (never today's live Account balances), so a report for last month
// stays correct even after Close Day has since reset every Account to $0.
export const userPerformanceReport = asyncHandler(async (req, res) => {
  const { userId } = req.query;
  if (!userId) throw new ApiError(400, 'Select a user.');

  const user = await User.findById(userId).select('name username role');
  if (!user) throw new ApiError(404, 'User not found.');

  const { start, end } = resolveDateRange(req.query);
  // CONFIRMED-only excludes DRAFT (not yet finalized) and CANCELLED sales.
  // Returns are handled "for free" -- returnSale() reduces totalCents /
  // paidAmountCents / outstandingCents on the sale document in place, so
  // these aggregates already reflect the post-return figures.
  const match = { status: 'CONFIRMED', createdBy: user._id, createdAt: { $gte: start, $lte: end } };

  const [[agg], byAccount, byDay] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$totalCents' },
          invoiceCount: { $sum: 1 },
          itemsSold: { $sum: { $sum: '$items.quantity' } },
          cashCollected: { $sum: '$paidAmountCents' },
          // Wallet-funded amounts never post a new Account receipt (the cash
          // already entered an Account at deposit time) -- reported
          // separately so it is never added into paymentByAccount below.
          walletCollected: { $sum: '$walletAmountCents' },
          creditExtended: { $sum: '$balanceAddedCents' },
        },
      },
    ]),
    Sale.aggregate([
      { $match: { ...match, paymentAccount: { $ne: null }, paidAmountCents: { $gt: 0 } } },
      { $lookup: { from: 'accounts', localField: 'paymentAccount', foreignField: '_id', as: 'acc' } },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$acc.name', 0] }, 'Unknown'] }, amount: { $sum: '$paidAmountCents' } } },
      { $sort: { amount: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalSales: { $sum: '$totalCents' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      user: { id: user._id, name: user.name, username: user.username, role: user.role },
      range: { from: start, to: end },
      totalSales: fromCents(agg?.totalSales || 0),
      invoiceCount: agg?.invoiceCount || 0,
      itemsSold: agg?.itemsSold || 0,
      cashCollected: fromCents(agg?.cashCollected || 0),
      walletCollected: fromCents(agg?.walletCollected || 0),
      creditExtended: fromCents(agg?.creditExtended || 0),
      averageSaleValue:
        (agg?.invoiceCount || 0) > 0 ? fromCents(Math.round((agg.totalSales || 0) / agg.invoiceCount)) : 0,
      paymentByAccount: byAccount.map((a) => ({ account: a._id, amount: fromCents(a.amount) })),
      byDay: byDay.map((d) => ({ date: d._id, totalSales: fromCents(d.totalSales), count: d.count })),
    },
  });
});

// GET /api/reports/item-profit/:itemId
// Answers: "did purchasing this product generate profit, accounting for what
// has actually sold vs. what is still sitting in stock?"
export const itemProfitReport = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.itemId);
  if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });

  const [purchaseAgg] = await Purchase.aggregate([
    { $match: { status: 'completed' } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    { $group: { _id: null, quantityPurchased: { $sum: '$items.quantity' }, totalCost: { $sum: '$items.subtotalCents' } } },
  ]);

  const [saleAgg] = await Sale.aggregate([
    { $match: { status: 'CONFIRMED' } },
    { $unwind: '$items' },
    { $match: { 'items.item': item._id } },
    {
      $group: {
        _id: null,
        quantitySold: { $sum: '$items.quantity' },
        revenue: { $sum: { $subtract: ['$items.subtotalCents', { $ifNull: ['$items.discountCents', 0] }] } },
        // Historical WAC snapshot frozen at Close Day confirm time -- never lot-blended, never today's item cost.
        costOfGoodsSold: { $sum: { $multiply: ['$items.quantity', '$items.costPriceCents'] } },
      },
    },
  ]);

  const quantityPurchased = purchaseAgg?.quantityPurchased || 0;
  const purchaseCost = fromCents(purchaseAgg?.totalCost || 0);
  const quantitySold = saleAgg?.quantitySold || 0;
  const revenue = fromCents(saleAgg?.revenue || 0);
  const costOfGoodsSold = fromCents(saleAgg?.costOfGoodsSold || 0);
  const grossProfit = revenue - costOfGoodsSold;
  const remainingStock = item.quantity;
  const remainingStockValue = fromCents(item.quantity * item.costPriceCents);

  res.json({
    success: true,
    data: {
      item: { id: item._id, name: item.name, itemCode: item.itemCode },
      quantityPurchased,
      purchaseCost,
      quantitySold,
      revenue,
      costOfGoodsSold,
      grossProfit,
      remainingStock,
      remainingStockValue,
    },
  });
});
