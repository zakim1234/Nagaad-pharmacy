import mongoose from 'mongoose';

// A singleton document (_id is always the literal string 'current') tracking
// whether the business day is OPEN or CLOSED right now. Kept separate from
// DayClose (which is an immutable per-close snapshot, many of which can
// exist) -- this is the live, mutable "is Seller/POS allowed to sell right
// now" switch that saleService.createSaleDraft checks on every new sale.
const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'current' },
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    businessDate: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    openedByName: { type: String, default: '' },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closedByName: { type: String, default: '' },
    lastDayClose: { type: mongoose.Schema.Types.ObjectId, ref: 'DayClose', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('BusinessDay', schema);
