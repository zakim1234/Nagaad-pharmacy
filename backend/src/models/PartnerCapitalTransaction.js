import mongoose from 'mongoose';

// The append-only ledger behind Partner.currentEquityCents, mirroring how
// AccountTransaction backs Account.currentBalanceCents.
const schema = new mongoose.Schema(
  {
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    partnerName: { type: String, default: '' },
    type: { type: String, enum: ['CONTRIBUTION', 'WITHDRAWAL'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    accountName: { type: String, default: '' },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    date: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 500 },
    equityBeforeCents: { type: Number, required: true },
    equityAfterCents: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ partner: 1, createdAt: -1 });
schema.index({ date: -1 });

export default mongoose.model('PartnerCapitalTransaction', schema);
