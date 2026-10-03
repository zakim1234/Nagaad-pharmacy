import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
  itemName: { type: String, required: true },
  itemCode: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  unitPriceCents: { type: Number, required: true, min: 0 },
  discountCents: { type: Number, default: 0, min: 0 },
  lineTotalCents: { type: Number, required: true, min: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
  quotationNumber: { type: String, required: true, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, default: '' },
  date: { type: Date, required: true },
  expiryDate: { type: Date, required: true },
  items: { type: [itemSchema], required: true },
  subtotalCents: { type: Number, required: true },
  discountCents: { type: Number, default: 0 },
  totalDiscountCents: { type: Number, default: 0 },
  grandTotalCents: { type: Number, required: true },
  notes: { type: String, default: '', maxlength: 4000 },
  status: { type: String, enum: ['Pending', 'Accepted', 'Rejected', 'Expired', 'Converted'], default: 'Pending' },
  convertedInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', default: null },
  convertedInvoiceNumber: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
schema.index({ customer: 1, date: -1 });
schema.index({ status: 1, expiryDate: 1 });
export default mongoose.model('Quotation', schema);
