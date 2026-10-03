import Category from '../models/Category.js';
import InventoryItem from '../models/InventoryItem.js';
import { receiveStock, escapeRegex } from '../services/stockReceiptService.js';
import { batchSummary } from '../services/batchService.js';
import { logAudit } from '../services/auditService.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';
import { runInTransaction } from '../utils/transaction.js';

// GET /api/quick-items/categories -- the category picker for the quick-create
// form. Lives here (behind 'createItems') so a cashier who may create items does
// not also need the whole Categories module just to file one.
export const listQuickCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ name: 1 });
  res.json({ success: true, data: categories.map((c) => ({ id: c._id, name: c.name })) });
});

// POST /api/quick-items -- creates a brand-new item AND receives its opening
// stock in one transaction, through the same Stock IN code the Stock page uses
// (so it gets a Stock Entry serial, a lot, a stock event and a Weighted Average
// Cost seeded from the cost typed here -- 0 if none). The item is returned in
// the shape of the POS item search so the caller can drop it straight into the
// sale as a normal line.
export const quickCreateItem = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'Item name is required.');
  if (name.length > 200) throw new ApiError(400, 'Item name is too long (200 characters max).');

  const { sellingPrice, initialQuantity, cost, categoryId } = req.body;
  const selling = Number(sellingPrice);
  if (sellingPrice === '' || sellingPrice == null || !Number.isFinite(selling) || selling < 0 || !Number.isSafeInteger(toCents(selling))) {
    throw new ApiError(400, 'Enter a valid selling price.');
  }
  const quantity = Number(initialQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new ApiError(400, 'Initial quantity must be a positive whole number.');
  const costNumber = cost === '' || cost == null ? 0 : Number(cost);
  if (!Number.isFinite(costNumber) || costNumber < 0 || !Number.isSafeInteger(toCents(costNumber))) throw new ApiError(400, 'Cost cannot be negative.');

  // The Stock page treats a same-named item as "add stock to that item"; here the
  // cashier asked for a NEW item, so silently topping up an existing one (possibly
  // an inactive one the POS search hides) would be wrong. Say so instead.
  const existing = await InventoryItem.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  if (existing) {
    throw new ApiError(
      409,
      existing.status === 'active'
        ? `An item named "${existing.name}" already exists. Search for it and add it to the sale instead.`
        : `An item named "${existing.name}" already exists but is inactive. Ask an admin to reactivate it.`
    );
  }

  const item = await runInTransaction(async (session) => {
    const { items } = await receiveStock(session, {
      rows: [{ name, quantity, costPrice: costNumber, sellingPrice: selling, categoryId: categoryId || null }],
      user: req.user,
    });
    return items[0];
  });

  await logAudit({
    user: req.user,
    action: 'inventory.quickCreate',
    entityType: 'InventoryItem',
    entityId: item._id,
    details: { name: item.name, itemCode: item.itemCode, quantity, sellingPrice: selling, cost: costNumber },
  });

  const summary = await batchSummary(item, false);
  res.status(201).json({
    success: true,
    data: {
      id: item._id,
      name: item.name,
      itemCode: item.itemCode,
      serialNumber: item.serialNumber || '',
      unit: item.unit,
      sellingPrice: fromCents(item.sellingPriceCents),
      costPrice: fromCents(item.costPriceCents),
      quantity: item.quantity,
      availableQuantity: summary.availableQuantity,
    },
  });
});
