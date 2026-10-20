import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { buildDayClosePreview, closeDay, getDayCloseHistory, getDailyClosings, getBusinessDayStatus, openDay, reopenDayClose } from '../services/dayCloseService.js';
import { saleToDTO } from './saleController.js';
import { getItemsSold, listItemsSoldPeriods } from '../services/itemsSoldService.js';

function businessDayDTO(bd) {
  return {
    status: bd.status,
    businessDate: bd.businessDate,
    openedAt: bd.openedAt,
    openedByName: bd.openedByName,
    closedAt: bd.closedAt,
    closedByName: bd.closedByName,
  };
}

function dayCloseDTO(d, { canReopen = false } = {}) {
  return {
    id: d._id,
    businessDate: d.businessDate,
    invoiceCount: d.invoiceCount,
    revenue: fromCents(d.revenueCents),
    cogs: fromCents(d.cogsCents),
    grossProfit: fromCents(d.grossProfitCents),
    cashCollected: fromCents(d.cashCollectedCents),
    customerCredit: fromCents(d.customerCreditCents),
    paymentBreakdown: d.paymentBreakdown.map((p) => ({ account: p.account, accountName: p.accountName, amount: fromCents(p.amountCents) })),
    cashierBreakdown: (d.cashierBreakdown || []).map((c) => ({
      user: c.user,
      userName: c.userName,
      byAccount: c.byAccount.map((a) => ({ account: a.account, accountName: a.accountName, amount: fromCents(a.amountCents) })),
      total: fromCents(c.totalCents),
    })),
    accountBalancesBeforeReset: (d.accountBalancesBeforeReset || []).map((a) => ({
      account: a.account,
      accountName: a.accountName,
      balanceBeforeReset: fromCents(a.balanceBeforeResetCents),
    })),
    invoiceReferences: d.invoiceReferences || [],
    openedAt: d.openedAt,
    closedByName: d.closedByName,
    closedAt: d.closedAt,
    reopened: !!d.reopened,
    reopenedAt: d.reopenedAt || null,
    reopenedByName: d.reopenedByName || '',
    reopenReason: d.reopenReason || '',
    restoredAccounts: (d.restoredAccounts || []).map((a) => ({
      account: a.account,
      accountName: a.accountName,
      balanceBeforeReopen: fromCents(a.balanceBeforeReopenCents),
      balanceAfterReopen: fromCents(a.balanceAfterReopenCents),
    })),
    // Only the single most recent CLOSED close (BusinessDay.lastDayClose)
    // can ever be reopened -- see reopenDayClose's date-safety invariant.
    // Computed server-side so the frontend never has to (and can't
    // mistakenly) infer this on its own.
    canReopen,
  };
}

// GET /api/day-close/status -- the live OPEN/CLOSED switch Seller/POS checks.
export const getStatus = asyncHandler(async (req, res) => {
  const bd = await getBusinessDayStatus();
  res.json({ success: true, data: businessDayDTO(bd) });
});

// GET /api/day-close/preview -- the review screen shown before actually closing
export const getPreview = asyncHandler(async (req, res) => {
  const { drafts, problems, totals, readyToConfirm, businessDay, paymentBreakdown, cashierBreakdown } = await buildDayClosePreview();

  res.json({
    success: true,
    data: {
      date: new Date(),
      businessDay: businessDayDTO(businessDay),
      invoices: drafts.map(saleToDTO),
      totalDraftInvoices: drafts.length,
      totalDraftValue: fromCents(totals.totalValueCents),
      totalPaymentsReceived: fromCents(totals.totalPaidCents),
      totalReservedUnits: totals.totalReservedUnits,
      problems,
      readyToConfirm,
      paymentBreakdown: paymentBreakdown.map((p) => ({ account: p.account, accountName: p.accountName, amount: fromCents(p.amountCents) })),
      cashierBreakdown: cashierBreakdown.map((c) => ({
        user: c.user,
        userName: c.userName,
        byAccount: c.byAccount.map((a) => ({ account: a.account, accountName: a.accountName, amount: fromCents(a.amountCents) })),
        total: fromCents(c.totalCents),
      })),
    },
  });
});

// POST /api/day-close/confirm -- the actual Close Day action, requires
// explicit confirmation from the client (there is no auto-close on a timer).
export const confirmClose = asyncHandler(async (req, res) => {
  const { dayClose, confirmedSales } = await closeDay({ user: req.user });

  await logAudit({
    user: req.user,
    action: 'dayclose.confirm',
    entityType: 'DayClose',
    entityId: dayClose._id,
    details: { invoiceCount: confirmedSales.length, revenue: fromCents(dayClose.revenueCents) },
  });

  res.status(201).json({
    success: true,
    data: { ...dayCloseDTO(dayClose), confirmedInvoices: confirmedSales.map(saleToDTO) },
  });
});

// POST /api/day-close/open -- admin-only reopen. Route already restricts to
// admin, but the service layer double-checks too.
export const openDayHandler = asyncHandler(async (req, res) => {
  const bd = await openDay({ user: req.user });

  await logAudit({ user: req.user, action: 'dayclose.open', entityType: 'BusinessDay', entityId: 'current', details: {} });

  res.json({ success: true, data: businessDayDTO(bd) });
});

// GET /api/day-close/history
export const listHistory = asyncHandler(async (req, res) => {
  const { items, pagination } = await getDayCloseHistory(req.query);
  const businessDay = await getBusinessDayStatus();
  const reopenableId = businessDay.status === 'CLOSED' ? String(businessDay.lastDayClose || '') : null;
  res.json({
    success: true,
    data: items.map((d) => dayCloseDTO(d, { canReopen: !d.reopened && reopenableId === String(d._id) })),
    pagination,
  });
});

// GET /api/day-close/daily -- one row per business day (all of that day's
// closes rolled together) plus that day's expenses and net profit.
export const listDaily = asyncHandler(async (req, res) => {
  const { items, pagination } = await getDailyClosings(req.query);
  const businessDay = await getBusinessDayStatus();
  const reopenableId = businessDay.status === 'CLOSED' ? String(businessDay.lastDayClose || '') : null;
  res.json({
    success: true,
    data: items.map((d) => ({
      businessDate: d.businessDate,
      invoiceCount: d.invoiceCount,
      revenue: fromCents(d.revenueCents),
      cogs: fromCents(d.cogsCents),
      grossProfit: fromCents(d.grossProfitCents),
      cashCollected: fromCents(d.cashCollectedCents),
      customerCredit: fromCents(d.customerCreditCents),
      expenses: fromCents(d.expensesCents),
      expenseCount: d.expenseCount,
      netProfit: fromCents(d.netProfitCents),
      lastClosedAt: d.lastClosedAt,
      paymentBreakdown: d.paymentBreakdown.map((p) => ({ account: p.account, accountName: p.accountName, amount: fromCents(p.amountCents) })),
      closes: d.closes.map((c) => dayCloseDTO(c, { canReopen: !c.reopened && reopenableId === String(c._id) })),
    })),
    pagination,
  });
});

function itemsSoldDTO(r) {
  const money = (c) => fromCents(c);
  return {
    type: r.type,
    key: r.key,
    start: r.start,
    end: r.end,
    closeCount: r.closeCount,
    dayCount: r.dayCount,
    invoiceCount: r.invoiceCount,
    items: r.items.map((i) => ({
      itemId: i.item,
      name: i.itemName,
      quantity: i.quantity,
      unitCost: i.quantity ? money(Math.round(i.costCents / i.quantity)) : 0,
      unitPrice: i.quantity ? money(Math.round(i.salesCents / i.quantity)) : 0,
      cost: money(i.costCents),
      sales: money(i.salesCents),
      profit: money(i.salesCents - i.costCents),
    })),
    totals: {
      items: r.items.length,
      quantity: r.totals.quantity,
      cost: money(r.totals.costCents),
      sales: money(r.totals.salesCents),
      invoiceDiscount: money(r.totals.invoiceDiscountCents),
      grossProfit: money(r.totals.grossProfitCents),
      expenses: money(r.totals.expensesCents),
      netProfit: money(r.totals.netProfitCents),
    },
  };
}

// GET /api/day-close/daily/items?date=<businessDate> -- items sold that day
// (for Daily Closing users without the Reports module).
export const listDayItems = asyncHandler(async (req, res) => {
  res.json({ success: true, data: itemsSoldDTO(await getItemsSold({ type: 'day', key: req.query.date })) });
});

// GET /api/reports/items-sold?type=day|month|year&key=2026-10-19|2026-10|2026
export const itemsSoldReport = asyncHandler(async (req, res) => {
  res.json({ success: true, data: itemsSoldDTO(await getItemsSold({ type: req.query.type, key: req.query.key })) });
});

// GET /api/reports/items-sold/periods?type=day|month|year -- every period
// with a closing, newest first, with its totals.
export const itemsSoldPeriods = asyncHandler(async (req, res) => {
  const periods = await listItemsSoldPeriods({ type: req.query.type });
  res.json({
    success: true,
    data: periods.map((p) => ({
      key: p.key,
      dayCount: p.dayCount,
      invoiceCount: p.invoiceCount,
      sales: fromCents(p.revenueCents),
      cost: fromCents(p.cogsCents),
      grossProfit: fromCents(p.grossProfitCents),
      expenses: fromCents(p.expensesCents),
      netProfit: fromCents(p.netProfitCents),
    })),
  });
});

// POST /api/day-close/:id/reopen -- admin-only, reverses one Close Day using
// its own saved account snapshot. Route already restricts to admin; the
// service layer independently re-derives and enforces the same rule.
export const reopenDayCloseHandler = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;
  const dayClose = await reopenDayClose({ dayCloseId: req.params.id, user: req.user, reason });

  await logAudit({
    user: req.user,
    action: 'dayclose.reopen',
    entityType: 'DayClose',
    entityId: dayClose._id,
    details: { reason, restoredAccounts: dayClose.restoredAccounts.length },
  });

  res.json({ success: true, data: dayCloseDTO(dayClose, { canReopen: false }) });
});
