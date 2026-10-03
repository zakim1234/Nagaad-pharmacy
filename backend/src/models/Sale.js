import mongoose from 'mongoose';

// Which lots (and therefore which purchases/suppliers) a sold quantity was
// drawn from, in FIFO order. Lets supplier/item profitability reports trace
// realized revenue and COGS back to the exact purchase batch. Populated only
// at CONFIRM time (Close Day) -- a DRAFT sale has reserved stock but has not
// consumed any lot yet.
const lotConsumptionSchema = new mongoose.Schema(
  {
    stockSerial: { type: String, default: '' },
    lot: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryLot', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    purchase: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    // min: 0, not 1 -- returnSale() decrements an entry's quantity toward 0
    // in place as its units are returned (rather than removing the entry),
    // so a FULLY returned line legitimately leaves a 0-quantity entry behind
    // as the record of "this many units, now all returned, were originally
    // consumed from this lot."
    quantity: { type: Number, required: true, min: 0 },
    unitCostCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleItemSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    itemCode: { type: String, default: '' },
    serialNumber: { type: String, default: '' },
    sku: { type: String, default: '' }, // legacy, kept for historical records
    quantity: { type: Number, required: true, min: 1 },
    unitPriceCents: { type: Number, required: true, min: 0 }, // selling price (rate) at time of sale -- cashier-editable per line
    // Estimated at Draft creation time (cashier-editable override, or the
    // item's current cost price if not overridden); replaced with the real
    // FIFO-weighted cost the moment the sale is CONFIRMED at Close Day, so
    // this estimate never becomes the historical COGS figure.
    costPriceCents: { type: Number, required: true, min: 0 },
    // Per-line discount at time of sale, in addition to the invoice-level
    // Sale.discountCents. Historical -- never recalculated later.
    discountCents: { type: Number, default: 0, min: 0 },
    subtotalCents: { type: Number, required: true, min: 0 }, // gross: quantity * unitPriceCents (before this line's discount)
    batchReservations: { type: [lotConsumptionSchema], default: [] },
    lotConsumption: { type: [lotConsumptionSchema], default: [] },
    // Cumulative quantity returned via POST /sales/:id/return. Never exceeds
    // `quantity`; used to cap how much of this line remains returnable.
    returnedQuantity: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// One audit record per partial return -- preserved permanently alongside the
// original invoice rather than rewriting its history in place.
const saleReturnSchema = new mongoose.Schema(
  {
    items: [
      {
        item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
        itemName: String,
        quantity: Number,
        unitPriceCents: Number,
      },
    ],
    amountCents: { type: Number, required: true }, // total value reversed by this return
    debtReducedCents: { type: Number, required: true, default: 0 }, // portion applied against still-unpaid balance
    refundCents: { type: Number, required: true, default: 0 }, // portion refunded out of the payment account (already paid)
    walletRefundCents: { type: Number, default: 0 }, // already-paid portion that came from wallet credit, given back to the wallet
    reason: { type: String, default: '' },
    // Snapshots taken immediately after this specific return was applied --
    // for the Return Receipt to show the balances as they stood at that
    // moment, never recalculated from today's (possibly different) figures
    // if further returns/payments happened on this invoice/customer since.
    // Optional/null on returns recorded before this field existed.
    invoiceBalanceAfterCents: { type: Number, default: null },
    customerBalanceAfterCents: { type: Number, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const saleSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    items: { type: [saleItemSchema], required: true, validate: (v) => v.length > 0 },
    subtotalCents: { type: Number, required: true, default: 0 },
    discountCents: { type: Number, required: true, default: 0 },
    totalCents: { type: Number, required: true, default: 0 },
    paidAmountCents: { type: Number, required: true, default: 0 }, // paid at the moment of sale (cash/account)
    // Applied from the customer's prepaid wallet credit. Debited from
    // Customer.walletBalanceCents immediately at Draft creation/edit (see
    // saleService.createSaleDraft) -- never posts a new Account receipt,
    // since that cash already entered an Account at deposit time.
    walletAmountCents: { type: Number, default: 0, min: 0 },
    paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    accountTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountTransaction', default: null },
    balanceAddedCents: { type: Number, required: true, default: 0 }, // credit created by this sale (totalCents - paidAmountCents - walletAmountCents)
    outstandingCents: { type: Number, required: true, default: 0 }, // remaining unpaid on THIS invoice (decreases as debt payments are allocated to it)
    costOfGoodsCents: { type: Number, required: true, default: 0 },
    profitCents: { type: Number, required: true, default: 0 },
    previousBalanceCents: { type: Number, required: true, default: 0 }, // customer's outstanding debt immediately before this sale (estimated at draft time, finalized at confirm)
    // DRAFT: created today, editable, reserves stock, excluded from finalized reports.
    // CONFIRMED: permanent -- created by Close Day. Deducts stock, posts revenue/COGS/profit/debt/account.
    // CANCELLED: released reservation, excluded from reports, history preserved.
    status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'CANCELLED'], default: 'DRAFT' },
    confirmedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledReason: { type: String, default: '' },
    returns: { type: [saleReturnSchema], default: [] },
    notes: { type: String, default: '', trim: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

saleSchema.index({ customer: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ quotation: 1 }, { unique: true, partialFilterExpression: { quotation: { $type: 'objectId' } } });

saleSchema.index({ customer: 1, outstandingCents: 1 });
saleSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Sale', saleSchema);
