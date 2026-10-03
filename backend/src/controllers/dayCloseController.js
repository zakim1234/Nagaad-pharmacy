import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { logAudit } from '../services/auditService.js';
import { buildDayClosePreview, closeDay, getDayCloseHistory, getDailyClosings, getBusinessDayStatus, openDay, reopenDayClose } from '../services/dayCloseService.js';
import { saleToDTO } from './saleController.js';

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
