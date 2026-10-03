import Partner from '../models/Partner.js';
import {
  getTotalCashCents,
  getTotalReceivableCents,
  getTotalInventoryValueCents,
  getTotalPayableCents,
  getTotalFixedAssetsCents,
} from './balanceSheetService.js';
import { ApiError } from '../utils/ApiError.js';
import { fromCents } from '../utils/money.js';

export const DEFAULT_ZAKAT_RATE_BPS = 250; // 2.5%

export function parseRateBps(rate) {
  if (rate === undefined || rate === null || rate === '') return DEFAULT_ZAKAT_RATE_BPS;
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ApiError(400, 'Zakat rate must be a percentage between 0 and 100.');
  return Math.round(n * 100);
}

export function parseCalcDate(value) {
  if (!value) return new Date();
  const day = String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new ApiError(400, 'Enter a valid calculation date.');
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) throw new ApiError(400, 'Enter a valid calculation date.');
  return date;
}

// Shared by the live preview (GET) and the confirmed save (POST) so the two
// can never disagree about the arithmetic -- only about whether the result
// gets persisted/deducted.
export async function calculateZakat({ date, rateBps, includeFixedAssets }) {
  const calculationDate = parseCalcDate(date);
  const rate = parseRateBps(rateBps);
  const includeFixed = includeFixedAssets === true || includeFixedAssets === 'true';

  const [cashCents, inventoryCents, receivableCents, payableCents, fixedAssetsCents, partners] = await Promise.all([
    getTotalCashCents(),
    getTotalInventoryValueCents(),
    getTotalReceivableCents(),
    getTotalPayableCents(),
    includeFixed ? getTotalFixedAssetsCents() : Promise.resolve(0),
    Partner.find({ isActive: true }).sort({ createdAt: 1 }),
  ]);

  const totalZakatableAssetsCents = cashCents + inventoryCents + receivableCents + fixedAssetsCents;
  const netZakatableWealthCents = Math.max(0, totalZakatableAssetsCents - payableCents);
  const zakatDueCents = Math.round((netZakatableWealthCents * rate) / 10000);

  const totalEquityCents = partners.reduce((sum, p) => sum + p.currentEquityCents, 0);
  const breakdown = partners.map((p) => {
    const equityPct = totalEquityCents > 0 ? Math.round((p.currentEquityCents / totalEquityCents) * 10000) / 100 : 0;
    return { partnerId: p._id, partnerName: p.name, equityPct, shareCents: Math.round((zakatDueCents * p.currentEquityCents) / (totalEquityCents || 1)) };
  });
  // Rounding can leave the shares off by a cent or two from zakatDueCents;
  // the largest share absorbs the remainder so the breakdown always adds up
  // to exactly the total due.
  if (breakdown.length > 0) {
    const allocated = breakdown.reduce((sum, b) => sum + b.shareCents, 0);
    const drift = zakatDueCents - allocated;
    if (drift !== 0) {
      const largest = breakdown.reduce((best, b) => (b.shareCents > best.shareCents ? b : best), breakdown[0]);
      largest.shareCents += drift;
    }
  }

  return {
    calculationDate,
    rateBps: rate,
    ratePct: rate / 100,
    includeFixedAssets: includeFixed,
    cashCents,
    inventoryCents,
    receivableCents,
    fixedAssetsCents,
    payableCents,
    totalZakatableAssetsCents,
    netZakatableWealthCents,
    zakatDueCents,
    breakdown,
    totalEquityCents,
  };
}

export function zakatToDTO(z) {
  return {
    calculationDate: z.calculationDate,
    ratePct: z.rateBps / 100,
    includeFixedAssets: z.includeFixedAssets,
    assets: {
      cash: fromCents(z.cashCents),
      inventory: fromCents(z.inventoryCents),
      receivable: fromCents(z.receivableCents),
      fixedAssets: fromCents(z.fixedAssetsCents),
      total: fromCents(z.totalZakatableAssetsCents),
    },
    liabilities: { payable: fromCents(z.payableCents) },
    netZakatableWealth: fromCents(z.netZakatableWealthCents),
    zakatDue: fromCents(z.zakatDueCents),
    breakdown: z.breakdown.map((b) => ({
      partnerId: b.partnerId,
      partnerName: b.partnerName,
      equityPct: b.equityPct,
      share: fromCents(b.shareCents),
    })),
  };
}
