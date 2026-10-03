import mongoose from 'mongoose';

const breakdownRowSchema = new mongoose.Schema(
  {
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    partnerName: { type: String, default: '' },
    equityPct: { type: Number, required: true },
    shareCents: { type: Number, required: true },
  },
  { _id: false }
);

// One finalized Zakat calculation (confirmed, not just previewed). The
// underlying figures are copied in at confirmation time -- never
// recalculated later -- so this stays an accurate historical record even as
// the business's live balances keep moving.
const schema = new mongoose.Schema(
  {
    calculationDate: { type: Date, required: true },
    rateBps: { type: Number, required: true, default: 250 }, // basis points: 250 = 2.5%
    includeFixedAssets: { type: Boolean, default: false },
    cashCents: { type: Number, required: true },
    inventoryCents: { type: Number, required: true },
    receivableCents: { type: Number, required: true },
    fixedAssetsCents: { type: Number, required: true, default: 0 },
    payableCents: { type: Number, required: true },
    totalZakatableAssetsCents: { type: Number, required: true },
    netZakatableWealthCents: { type: Number, required: true },
    zakatDueCents: { type: Number, required: true },
    breakdown: { type: [breakdownRowSchema], default: [] },
    // AUTO: zakatDueCents was deducted as one Expense from paymentAccount, status is PAID.
    // MANUAL: only calculated/recorded, no money moved; status starts RECORDED and can later be marked PAID.
    deductionMode: { type: String, enum: ['AUTO', 'MANUAL'], required: true },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    paymentAccountName: { type: String, default: '' },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
    status: { type: String, enum: ['RECORDED', 'PAID'], default: 'RECORDED' },
    paidAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ calculationDate: -1 });

export default mongoose.model('ZakatRecord', schema);
