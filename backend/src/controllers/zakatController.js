import ZakatRecord from '../models/ZakatRecord.js';
import Expense from '../models/Expense.js';
import Account from '../models/Account.js';
import { nextSequence } from '../models/Counter.js';
import { calculateZakat, zakatToDTO, parseCalcDate, parseRateBps } from '../services/zakatService.js';
import { ensureExpenseCategory } from '../services/expenseCategoryService.js';
import { postImmediateTransaction } from '../services/accountService.js';
import { logAudit } from '../services/auditService.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';
import { gregorianToApproximateHijriYear } from '../utils/hijriDate.js';
import { toDayString } from '../services/profitLossService.js';

const ZAKAT_CATEGORY = 'Zakat';

function recordToDTO(z) {
  return {
    id: z._id,
    calculationDate: z.calculationDate,
    hijriYear: gregorianToApproximateHijriYear(z.calculationDate),
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
    breakdown: z.breakdown.map((b) => ({ partnerId: b.partner, partnerName: b.partnerName, equityPct: b.equityPct, share: fromCents(b.shareCents) })),
    deductionMode: z.deductionMode,
    paymentAccountName: z.paymentAccountName,
    status: z.status,
    paidAt: z.paidAt,
    note: z.note,
    createdAt: z.createdAt,
  };
}

// GET /api/zakat/preview?date=&rate=&includeFixedAssets= -- live numbers,
// nothing saved. Powers the calculator page as the admin adjusts inputs.
export const previewZakat = asyncHandler(async (req, res) => {
  const result = await calculateZakat({ date: req.query.date, rateBps: req.query.rate, includeFixedAssets: req.query.includeFixedAssets });
  res.json({
    success: true,
    data: { ...zakatToDTO(result), calculationDate: result.calculationDate, hijriYear: gregorianToApproximateHijriYear(result.calculationDate) },
  });
});

async function generateExpenseNumber(session) {
  const seq = await nextSequence('expense', session);
  return `EXP-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
}

// POST /api/zakat -- admin/manager only. Confirms a calculation (recomputed
// here, not trusted from the client) and either deducts it as one Expense
// (AUTO) or just records it for partners to settle individually (MANUAL).
export const confirmZakat = asyncHandler(async (req, res) => {
  const { deductionMode, paymentAccountId, note } = req.body;
  if (!['AUTO', 'MANUAL'].includes(deductionMode)) throw new ApiError(400, 'Choose how Zakat will be paid: AUTO or MANUAL.');
  if (deductionMode === 'AUTO' && !paymentAccountId) throw new ApiError(400, 'Select a payment account to deduct Zakat from.');
  if (String(note || '').length > 1000) throw new ApiError(400, 'Note is too long (1000 characters max).');

  const calc = await calculateZakat({ date: req.body.date, rateBps: req.body.rate, includeFixedAssets: req.body.includeFixedAssets });
  if (calc.zakatDueCents <= 0) throw new ApiError(409, 'Zakat due is zero -- nothing to record.');

  const record = await runInTransaction(async (session) => {
    let account = null;
    let expense = null;
    if (deductionMode === 'AUTO') {
      account = await Account.findById(paymentAccountId).session(session);
      if (!account || !account.isActive) throw new ApiError(400, 'Selected payment account is not available.');

      const categoryName = await ensureExpenseCategory(ZAKAT_CATEGORY);
      const expenseNumber = await generateExpenseNumber(session);
      const txn = await postImmediateTransaction(
        {
          account,
          direction: 'OUT',
          type: 'EXPENSE',
          amountCents: calc.zakatDueCents,
          referenceType: 'Expense',
          referenceId: null,
          description: `Zakat ${expenseNumber} for ${toDayString(calc.calculationDate)}`,
          createdBy: req.user,
        },
        session
      );
      [expense] = await Expense.create(
        [
          {
            expenseNumber,
            category: categoryName,
            amountCents: calc.zakatDueCents,
            date: calc.calculationDate,
            paymentAccount: account._id,
            paymentAccountName: account.name,
            accountTransaction: txn._id,
            note: String(note || '').trim(),
            createdBy: req.user?._id || null,
            createdByName: req.user?.name || '',
          },
        ],
        { session }
      );
      txn.referenceId = expense._id;
      await txn.save({ session });
    }

    const [created] = await ZakatRecord.create(
      [
        {
          calculationDate: calc.calculationDate,
          rateBps: calc.rateBps,
          includeFixedAssets: calc.includeFixedAssets,
          cashCents: calc.cashCents,
          inventoryCents: calc.inventoryCents,
          receivableCents: calc.receivableCents,
          fixedAssetsCents: calc.fixedAssetsCents,
          payableCents: calc.payableCents,
          totalZakatableAssetsCents: calc.totalZakatableAssetsCents,
          netZakatableWealthCents: calc.netZakatableWealthCents,
          zakatDueCents: calc.zakatDueCents,
          breakdown: calc.breakdown.map((b) => ({ partner: b.partnerId, partnerName: b.partnerName, equityPct: b.equityPct, shareCents: b.shareCents })),
          deductionMode,
          paymentAccount: account?._id || null,
          paymentAccountName: account?.name || '',
          expense: expense?._id || null,
          status: deductionMode === 'AUTO' ? 'PAID' : 'RECORDED',
          paidAt: deductionMode === 'AUTO' ? new Date() : null,
          note: String(note || '').trim(),
          createdBy: req.user?._id || null,
        },
      ],
      { session }
    );
    return created;
  });

  await logAudit({
    user: req.user,
    action: 'zakat.confirm',
    entityType: 'ZakatRecord',
    entityId: record._id,
    details: { amount: fromCents(record.zakatDueCents), deductionMode, date: calc.calculationDate },
  });

  res.status(201).json({ success: true, data: recordToDTO(record) });
});

// POST /api/zakat/:id/mark-paid -- admin/manager only. For a MANUAL record
// once every partner has settled their own share outside the system.
export const markZakatPaid = asyncHandler(async (req, res) => {
  const record = await ZakatRecord.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Zakat record not found.');
  if (record.status === 'PAID') throw new ApiError(409, 'This Zakat record is already marked as paid.');
  record.status = 'PAID';
  record.paidAt = new Date();
  await record.save();
  await logAudit({ user: req.user, action: 'zakat.markPaid', entityType: 'ZakatRecord', entityId: record._id, details: {} });
  res.json({ success: true, data: recordToDTO(record) });
});

// PUT /api/zakat/:id -- admin/manager only. Corrects the RECORD itself
// (a typo'd rate, a wrong total, the wrong account noted down, a status that
// was never flipped) -- it never moves money. In particular, if the mode/
// account says AUTO, nothing here touches the Expense or Account that were
// actually debited when this was first confirmed; that already happened and
// stays exactly as it was. Reversing a real deduction is a separate, manual
// step outside this form (e.g. voiding the linked Expense).
export const updateZakatRecord = asyncHandler(async (req, res) => {
  const record = await ZakatRecord.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Zakat record not found.');

  if (req.body.date !== undefined) record.calculationDate = parseCalcDate(req.body.date);
  if (req.body.rate !== undefined) record.rateBps = parseRateBps(req.body.rate);

  if (req.body.totalZakat !== undefined) {
    const n = Number(req.body.totalZakat);
    if (!Number.isFinite(n) || n < 0) throw new ApiError(400, 'Enter a valid Total Zakat amount.');
    const newTotalCents = Math.round(n * 100);
    // Reallocate the breakdown to the corrected total, keeping each
    // partner's equity share (%) the same and absorbing any rounding
    // remainder into the largest share -- so the rows still sum to exactly
    // the new total instead of quietly drifting from it.
    if (record.breakdown.length > 0) {
      let allocated = 0;
      for (const row of record.breakdown) {
        row.shareCents = Math.round((newTotalCents * row.equityPct) / 100);
        allocated += row.shareCents;
      }
      const drift = newTotalCents - allocated;
      if (drift !== 0) {
        const largest = record.breakdown.reduce((best, r) => (r.shareCents > best.shareCents ? r : best), record.breakdown[0]);
        largest.shareCents += drift;
      }
    }
    record.zakatDueCents = newTotalCents;
  }

  if (req.body.deductionMode !== undefined) {
    if (!['AUTO', 'MANUAL'].includes(req.body.deductionMode)) throw new ApiError(400, 'Mode must be AUTO or MANUAL.');
    record.deductionMode = req.body.deductionMode;
    if (record.deductionMode === 'AUTO') {
      if (req.body.paymentAccountId) {
        const account = await Account.findById(req.body.paymentAccountId);
        if (!account) throw new ApiError(400, 'Selected payment account no longer exists.');
        record.paymentAccount = account._id;
        record.paymentAccountName = account.name;
      } else if (!record.paymentAccount) {
        // Switching a MANUAL record to Auto with no account given -- there is
        // nothing to fall back to. Staying/becoming Auto with an account
        // already on the record (or just set above) is fine as-is.
        throw new ApiError(400, 'Select a payment account for Auto mode.');
      }
    } else {
      record.paymentAccount = null;
      record.paymentAccountName = '';
    }
  }

  if (req.body.status !== undefined) {
    if (!['RECORDED', 'PAID'].includes(req.body.status)) throw new ApiError(400, 'Status must be RECORDED or PAID.');
    if (req.body.status === 'PAID' && record.status !== 'PAID') record.paidAt = new Date();
    if (req.body.status === 'RECORDED') record.paidAt = null;
    record.status = req.body.status;
  }

  if (req.body.note !== undefined) {
    if (String(req.body.note).length > 1000) throw new ApiError(400, 'Note is too long (1000 characters max).');
    record.note = String(req.body.note).trim();
  }

  await record.save();
  await logAudit({ user: req.user, action: 'zakat.update', entityType: 'ZakatRecord', entityId: record._id, details: { amount: fromCents(record.zakatDueCents) } });
  res.json({ success: true, data: recordToDTO(record) });
});

// DELETE /api/zakat/:id -- admin/manager only. Deletes the record itself
// (permanently -- unlike Partners/Fixed Assets, this is a real delete, not a
// soft-remove); the audit log keeps a trace of what it contained. If the
// record was AUTO, the Expense/Account deduction it caused already happened
// and is NOT reversed or touched by this -- the frontend warns about this
// before confirming.
export const deleteZakatRecord = asyncHandler(async (req, res) => {
  const record = await ZakatRecord.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Zakat record not found.');

  await logAudit({
    user: req.user,
    action: 'zakat.delete',
    entityType: 'ZakatRecord',
    entityId: record._id,
    details: {
      amount: fromCents(record.zakatDueCents),
      date: record.calculationDate,
      deductionMode: record.deductionMode,
      paymentAccountName: record.paymentAccountName,
      linkedExpense: record.expense,
    },
  });
  await record.deleteOne();
  res.json({ success: true, data: { id: req.params.id } });
});

// GET /api/zakat -- history
export const listZakatRecords = asyncHandler(async (req, res) => {
  const records = await ZakatRecord.find().sort({ calculationDate: -1, createdAt: -1 });
  res.json({ success: true, data: records.map(recordToDTO) });
});
