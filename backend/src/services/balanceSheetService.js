import Account from '../models/Account.js';
import Customer from '../models/Customer.js';
import Purchase from '../models/Purchase.js';
import InventoryItem from '../models/InventoryItem.js';
import Partner from '../models/Partner.js';
import FixedAsset from '../models/FixedAsset.js';
import { computePeriod, toDayString } from './profitLossService.js';
import { fromCents } from '../utils/money.js';
import { ApiError } from '../utils/ApiError.js';
import { BUSINESS_NAME } from '../config/business.js';

// Every one of these is the business's CURRENT live total -- this app has no
// historical snapshot/ledger of "what the total inventory value was" or
// "what every customer's balance was" on an arbitrary past date, only of
// money movements (Sale/Expense/AccountTransaction) which genuinely do have
// dates. So "as of <date>" only actually changes which fiscal year Net
// Income/Retained Earnings are split at; every balance line below is always
// today's figure regardless of the date picked. See buildBalanceSheet's
// `asOfNote`, surfaced on the report for exactly this reason.

export async function getTotalCashCents() {
  const [agg] = await Account.aggregate([{ $group: { _id: null, total: { $sum: '$currentBalanceCents' } } }]);
  return agg?.total || 0;
}

export async function getTotalReceivableCents() {
  const [agg] = await Customer.aggregate([{ $match: { balanceCents: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balanceCents' } } }]);
  return agg?.total || 0;
}

export async function getTotalInventoryValueCents() {
  const [agg] = await InventoryItem.aggregate([{ $group: { _id: null, total: { $sum: { $multiply: ['$quantity', '$costPriceCents'] } } } }]);
  return agg?.total || 0;
}

export async function getTotalPayableCents() {
  const [agg] = await Purchase.aggregate([{ $match: { status: { $ne: 'voided' }, balanceCents: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balanceCents' } } }]);
  return agg?.total || 0;
}

export async function getTotalPartnerEquityCents() {
  const [agg] = await Partner.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, total: { $sum: '$currentEquityCents' } } }]);
  return agg?.total || 0;
}

export async function getTotalFixedAssetsCents() {
  const [agg] = await FixedAsset.aggregate([{ $match: { isActive: true } }, { $group: { _id: null, total: { $sum: '$valueCents' } } }]);
  return agg?.total || 0;
}

function parseAsOfDate(value) {
  if (!value) {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return now;
  }
  const day = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new ApiError(400, 'Enter a valid date.');
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) throw new ApiError(400, 'Enter a valid date.');
  return date;
}

// Net Income (this line, on the Balance Sheet) = accrual profit from the
// start of the calendar year containing `asOf` through `asOf`.
// Retained Earnings = accrual profit from all recorded history before that
// year began. Together they are the business's total accumulated profit to
// date, split at the fiscal-year boundary the way a standard balance sheet
// does. "Fiscal year = calendar year" is a default, not something the app
// lets an admin configure yet.
async function getNetIncomeAndRetainedEarnings(asOf) {
  const fiscalYearStart = new Date(asOf.getFullYear(), 0, 1, 0, 0, 0, 0);
  const inception = new Date(2000, 0, 1); // any date before this system could have real data
  const [currentYear, priorYears] = await Promise.all([
    computePeriod({ start: fiscalYearStart, end: asOf, basis: 'accrual' }),
    computePeriod({ start: inception, end: new Date(fiscalYearStart.getTime() - 1), basis: 'accrual' }),
  ]);
  return { netIncomeCents: currentYear.netIncomeCents, retainedEarningsCents: priorYears.netIncomeCents };
}

export async function buildBalanceSheet({ date } = {}) {
  const asOf = parseAsOfDate(date);
  // Compared as the same "YYYY-MM-DD" string `date` already is against
  // today's local calendar day, not `new Date(date).toDateString()`: a bare
  // "YYYY-MM-DD" string parses as UTC midnight, which `.toDateString()`
  // then renders in the server's local timezone -- a day behind for any
  // timezone behind UTC (e.g. America/Los_Angeles), which would make an
  // admin's own "today" never match and show a misleading "not necessarily
  // today" note.
  const isToday = !date || String(date).slice(0, 10) === toDayString(new Date());

  const [cashCents, receivableCents, inventoryCents, payableCents, fixedAssetsCents, partnersEquityCents, { netIncomeCents, retainedEarningsCents }] =
    await Promise.all([
      getTotalCashCents(),
      getTotalReceivableCents(),
      getTotalInventoryValueCents(),
      getTotalPayableCents(),
      getTotalFixedAssetsCents(),
      getTotalPartnerEquityCents(),
      getNetIncomeAndRetainedEarnings(asOf),
    ]);

  const totalCurrentAssetsCents = cashCents + receivableCents + inventoryCents;
  const totalAssetsCents = totalCurrentAssetsCents + fixedAssetsCents;
  const totalLiabilitiesCents = payableCents;
  const totalEquityCents = partnersEquityCents + retainedEarningsCents + netIncomeCents;
  const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;

  return {
    title: 'Balance Sheet',
    business: BUSINESS_NAME,
    // Local calendar day, not asOf.toISOString().slice(0, 10) -- that
    // converts to UTC first, which silently rolls a late-day local instant
    // (asOf is pinned to 23:59:59.999 local) into the next UTC day for any
    // server timezone behind UTC (e.g. asking for "today" in America/Los_
    // Angeles could come back labelled tomorrow).
    asOf: toDayString(asOf),
    asOfNote: isToday
      ? null
      : "Cash, Receivables, Inventory, Payables, Partners' Capital and Fixed Assets are always today's figures -- this app keeps no historical snapshot of them for a past date. Only Net Income/Retained Earnings reflect the date chosen.",
    assets: {
      cash: fromCents(cashCents),
      receivable: fromCents(receivableCents),
      inventory: fromCents(inventoryCents),
      totalCurrentAssets: fromCents(totalCurrentAssetsCents),
      fixedAssets: fromCents(fixedAssetsCents),
      totalAssets: fromCents(totalAssetsCents),
    },
    liabilities: {
      payable: fromCents(payableCents),
      totalCurrentLiabilities: fromCents(totalLiabilitiesCents),
      totalLiabilities: fromCents(totalLiabilitiesCents),
    },
    equity: {
      partnersCapital: fromCents(partnersEquityCents),
      retainedEarnings: fromCents(retainedEarningsCents),
      netIncome: fromCents(netIncomeCents),
      totalEquity: fromCents(totalEquityCents),
    },
    totalLiabilitiesAndEquity: fromCents(totalLiabilitiesAndEquityCents),
    // A non-zero difference means something was recorded outside the paths
    // this report knows about (e.g. a Fixed Asset added with no matching
    // capital contribution/account deduction) -- expected until every such
    // gap is entered, not necessarily a bug. See QAYBTA 4 of the spec.
    isBalanced: totalAssetsCents === totalLiabilitiesAndEquityCents,
    differenceCents: totalAssetsCents - totalLiabilitiesAndEquityCents,
    difference: fromCents(totalAssetsCents - totalLiabilitiesAndEquityCents),
  };
}
