import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// The append-only ledger behind Partner.currentEquityCents, mirroring how
// AccountTransaction backs Account.currentBalanceCents.
const schema = new mongoose.Schema(
  {
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    partnerName: { type: String, default: '' },
    type: { type: String, enum: ['CONTRIBUTION', 'WITHDRAWAL', 'PROFIT_SHARE', 'PROFIT_SHARE_CANCELLED'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null }, // none for a profit share added to capital
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

schema.plugin(branchScoped);

export default mongoose.model('PartnerCapitalTransaction', schema);
