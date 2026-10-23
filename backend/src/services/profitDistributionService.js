import Partner from '../models/Partner.js';
import PartnerCapitalTransaction from '../models/PartnerCapitalTransaction.js';
import ProfitDistribution from '../models/ProfitDistribution.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { computePeriod } from './profitLossService.js';
import { postImmediateTransaction } from './accountService.js';
import { ApiError } from '../utils/ApiError.js';
import { runInTransaction } from '../utils/transaction.js';
import { currentBranch } from './branchContext.js';

// Year-end profit sharing: the year's net profit (the same accrual figure as
// Profit & Loss and the Balance Sheet) split between the partners by
// percentage -- by default each partner's share of the capital.

export async function yearNetProfitCents(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1, 0, 0, 0, -1);
  const { netIncomeCents } = await computePeriod({ start, end, basis: 'accrual' });
  return netIncomeCents;
}

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError(400, 'Choose a valid year.');
  return year;
}

// Splits `totalCents` by percentages; the last partner takes the rounding
// remainder so the shares always add up to the total exactly.
export function splitByPercent(totalCents, percents) {
  let given = 0;
  return percents.map((p, i) => {
    const cents = i === percents.length - 1 ? totalCents - given : Math.round((totalCents * p) / 100);
    given += cents;
    return cents;
  });
}

// What sharing `year` would look like right now: the profit and each active
// partner's default percentage (their share of the capital).
export async function previewDistribution({ year: rawYear }) {
  const year = parseYear(rawYear);
  const [netProfitCents, partners, existing] = await Promise.all([
    yearNetProfitCents(year),
    Partner.find({ isActive: true }).sort({ createdAt: 1 }),
    ProfitDistribution.findOne({ year, status: 'ACTIVE', ...(currentBranch() ? { branch: { $in: [currentBranch(), null] } } : {}) }).setOptions({ skipBranch: true }),
  ]);
  const totalEquity = partners.reduce((s, p) => s + Math.max(0, p.currentEquityCents), 0);
  const raw = partners.map((p) => (totalEquity > 0 ? (Math.max(0, p.currentEquityCents) / totalEquity) * 100 : partners.length ? 100 / partners.length : 0));
  // Two decimals, nudged so they add up to exactly 100.
  const percents = raw.map((r) => Math.round(r * 100) / 100);
  if (percents.length) percents[percents.length - 1] = Math.round((100 - percents.slice(0, -1).reduce((s, x) => s + x, 0)) * 100) / 100;
  const amounts = splitByPercent(Math.max(0, netProfitCents), percents);
  return {
    year,
    netProfitCents,
    existing,
    partners: partners.map((p, i) => ({ partner: p, percent: percents[i], amountCents: amounts[i] })),
  };
}

export async function createDistribution({ year: rawYear, mode, paymentAccountId, shares, date, note = '', user }) {
  const year = parseYear(rawYear);
  if (!['PAYOUT', 'CAPITAL'].includes(mode)) throw new ApiError(400, 'Choose to pay the partners out or add it to their capital.');
  if (!Array.isArray(shares) || !shares.length) throw new ApiError(400, 'Choose the partners and their percentages.');
  const percents = shares.map((s) => Number(s.percent));
  if (percents.some((p) => !Number.isFinite(p) || p < 0 || p > 100)) throw new ApiError(400, 'Each percentage must be between 0 and 100.');
  const total = Math.round(percents.reduce((s, p) => s + p, 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) throw new ApiError(400, `The percentages must add up to 100% (now ${total}%).`);
  if (String(note).length > 500) throw new ApiError(400, 'Note is too long (500 characters max).');

  const netProfitCents = await yearNetProfitCents(year);
  if (netProfitCents <= 0) throw new ApiError(400, `${year} has no profit to share (net result ${(netProfitCents / 100).toFixed(2)}).`);
  const amounts = splitByPercent(netProfitCents, percents);
  const when = date ? new Date(`${String(date).slice(0, 10)}T12:00:00`) : new Date();
  if (Number.isNaN(when.getTime())) throw new ApiError(400, 'Enter a valid date.');

  return runInTransaction(async (session) => {
    // A year is shared once: by a branch, or company-wide from the overview
    // (which also sees every branch's own sharing).
    const companyWide = await ProfitDistribution.exists({ year, status: 'ACTIVE', branch: null }).setOptions({ skipBranch: true }).session(session);
    if (companyWide || (await ProfitDistribution.exists({ year, status: 'ACTIVE' }).session(session))) {
      throw new ApiError(409, `The ${year} profit has already been shared. Cancel that one first to share it again.`);
    }
    let account = null;
    if (mode === 'PAYOUT') {
      if (!paymentAccountId) throw new ApiError(400, 'Choose the account the profit is paid from.');
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected account is not available.');
    }
    const seq = await nextSequence('profitDistribution', session);
    const distributionNumber = `PD-${year}-${String(seq).padStart(4, '0')}`;

    const built = [];
    for (let i = 0; i < shares.length; i++) {
      const partner = await Partner.findById(shares[i].partnerId).session(session);
      if (!partner || !partner.isActive) throw new ApiError(404, 'A selected partner no longer exists.');
      if (built.some((b) => String(b.partner) === String(partner._id))) throw new ApiError(400, `${partner.name} is listed twice.`);
      const amountCents = amounts[i];
      let accountTxn = null;
      if (amountCents > 0 && account) {
        accountTxn = await postImmediateTransaction(
          {
            account,
            direction: 'OUT',
            type: 'PARTNER_WITHDRAWAL',
            amountCents,
            referenceType: 'Partner',
            referenceId: partner._id,
            description: `${year} profit share for ${partner.name} (${percents[i]}%) -- ${distributionNumber}`,
            createdBy: user,
          },
          session
        );
      }
      const before = partner.currentEquityCents;
      if (mode === 'CAPITAL') partner.currentEquityCents += amountCents;
      partner.totalProfitCents = (partner.totalProfitCents || 0) + amountCents;
      await partner.save({ session });
      let capitalTxn = null;
      if (amountCents > 0) {
        [capitalTxn] = await PartnerCapitalTransaction.create(
          [
            {
              partner: partner._id,
              partnerName: partner.name,
              type: 'PROFIT_SHARE',
              amountCents,
              account: account?._id || null,
              accountName: account?.name || '',
              accountTransaction: accountTxn?._id || null,
              date: when,
              note: `${year} profit, ${percents[i]}% -- ${mode === 'PAYOUT' ? `paid from ${account.name}` : 'added to capital'} (${distributionNumber})`,
              equityBeforeCents: before,
              equityAfterCents: partner.currentEquityCents,
              createdBy: user?._id || null,
            },
          ],
          { session }
        );
      }
      built.push({ partner: partner._id, partnerName: partner.name, percent: percents[i], amountCents, capitalTransaction: capitalTxn?._id || null, accountTransaction: accountTxn?._id || null });
    }

    const [doc] = await ProfitDistribution.create(
      [
        {
          distributionNumber,
          year,
          netProfitCents,
          mode,
          account: account?._id || null,
          accountName: account?.name || '',
          date: when,
          note: String(note).trim(),
          shares: built,
          createdBy: user?._id || null,
          createdByName: user?.name || '',
        },
      ],
      { session }
    );
    return doc;
  });
}

// Reverses a distribution: payouts come back into the account, capital
// additions come off each partner's capital. The record stays, marked
// CANCELLED.
export async function cancelDistribution({ id, reason = '', user }) {
  return runInTransaction(async (session) => {
    const doc = await ProfitDistribution.findById(id).session(session);
    if (!doc) throw new ApiError(404, 'Profit distribution not found.');
    if (doc.status === 'CANCELLED') throw new ApiError(409, 'This distribution is already cancelled.');
    const account = doc.account ? await Account.findById(doc.account).session(session) : null;

    for (const share of doc.shares) {
      if (share.amountCents <= 0) continue;
      const partner = await Partner.findById(share.partner).session(session);
      if (!partner) continue;
      const before = partner.currentEquityCents;
      if (doc.mode === 'CAPITAL') {
        if (partner.currentEquityCents < share.amountCents) {
          throw new ApiError(409, `${partner.name}'s capital is now below their ${(share.amountCents / 100).toFixed(2)} profit share, so it cannot be taken back.`);
        }
        partner.currentEquityCents -= share.amountCents;
      }
      partner.totalProfitCents = Math.max(0, (partner.totalProfitCents || 0) - share.amountCents);
      await partner.save({ session });
      let accountTxn = null;
      if (doc.mode === 'PAYOUT' && account) {
        accountTxn = await postImmediateTransaction(
          {
            account,
            direction: 'IN',
            type: 'ADJUSTMENT',
            amountCents: share.amountCents,
            referenceType: 'Partner',
            referenceId: partner._id,
            description: `Cancelled ${doc.year} profit share for ${partner.name} -- ${doc.distributionNumber}`,
            createdBy: user,
          },
          session
        );
      }
      await PartnerCapitalTransaction.create(
        [
          {
            partner: partner._id,
            partnerName: partner.name,
            type: 'PROFIT_SHARE_CANCELLED',
            amountCents: share.amountCents,
            account: account?._id || null,
            accountName: account?.name || '',
            accountTransaction: accountTxn?._id || null,
            date: new Date(),
            note: `Cancelled ${doc.year} profit share (${doc.distributionNumber})${reason ? `: ${reason}` : ''}`,
            equityBeforeCents: before,
            equityAfterCents: partner.currentEquityCents,
            createdBy: user?._id || null,
          },
        ],
        { session }
      );
    }
    doc.status = 'CANCELLED';
    doc.cancelledAt = new Date();
    doc.cancelledByName = user?.name || '';
    doc.cancelReason = String(reason || '').slice(0, 500);
    await doc.save({ session });
    return doc;
  });
}

// Profit shared out up to `asOf` (active distributions) -- the Balance
// Sheet takes it off retained earnings: paid out it left the business,
// added to capital it now sits in Partners' Capital instead.
export async function distributedProfitCents(asOf) {
  const [agg] = await ProfitDistribution.aggregate([
    { $match: { status: 'ACTIVE', date: { $lte: asOf } } },
    { $group: { _id: null, cents: { $sum: '$netProfitCents' } } },
  ]);
  return agg?.cents || 0;
}
