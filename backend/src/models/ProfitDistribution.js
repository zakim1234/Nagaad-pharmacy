import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// One year's net profit shared out between the partners by percentage --
// either paid out of an account (PAYOUT) or added to each partner's capital
// (CAPITAL). Cancelling reverses it and keeps this record for the audit trail.
const shareSchema = new mongoose.Schema(
  {
    partner: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    partnerName: String,
    percent: { type: Number, required: true }, // 0-100, two decimals
    amountCents: { type: Number, required: true },
    capitalTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerCapitalTransaction', default: null },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    distributionNumber: { type: String, required: true }, // PD-2026-0001
    year: { type: Number, required: true },
    netProfitCents: { type: Number, required: true }, // the year's net profit when shared
    mode: { type: String, enum: ['PAYOUT', 'CAPITAL'], required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null }, // PAYOUT only
    accountName: { type: String, default: '' },
    date: { type: Date, required: true },
    note: { type: String, default: '', maxlength: 500 },
    shares: { type: [shareSchema], default: [] },
    status: { type: String, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledAt: { type: Date, default: null },
    cancelledByName: { type: String, default: '' },
    cancelReason: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

schema.index({ year: -1, status: 1 });

schema.plugin(branchScoped);

export default mongoose.model('ProfitDistribution', schema);
