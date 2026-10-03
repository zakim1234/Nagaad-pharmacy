import InventoryLot from '../models/InventoryLot.js';

// Creates one lot per purchase line so the exact supplier/cost of every unit
// bought can be traced forward to whatever sale eventually consumes it.
export async function createLotForPurchase({ item, supplier, purchase, unitCostCents, quantity }, session) {
  const [lot] = await InventoryLot.create(
    [
      {
        item: item._id || item,
        supplier: supplier?._id || supplier || null,
        purchase: purchase?._id || purchase || null,
        unitCostCents,
        originalQuantity: quantity,
        remainingQuantity: quantity,
        isLegacy: false,
      },
    ],
    { session }
  );
  return lot;
}

// Consumes `quantity` units of `item` from its oldest available lots (FIFO),
// creating a synthetic "legacy" lot on the fly to cover any shortfall (stock
// that existed before lot tracking, or was entered without a purchase) using
// the item's current cost price. Returns the per-lot breakdown consumed and
// the resulting weighted-average unit cost, which becomes the sale line's
// historical costPriceCents.
export async function consumeLotsFIFO(item, quantity, session) {
  const itemId = item._id || item;
  let remaining = quantity;
  const breakdown = [];

  const lots = await InventoryLot.find({ item: itemId, remainingQuantity: { $gt: 0 } })
    .sort({ createdAt: 1 })
    .session(session || null);

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.remainingQuantity, remaining);
    lot.remainingQuantity -= take;
    await lot.save({ session });
    breakdown.push({
      lot: lot._id,
      supplier: lot.supplier,
      purchase: lot.purchase,
      quantity: take,
      unitCostCents: lot.unitCostCents,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    // No purchase history covers this quantity (legacy stock, or a manual
    // stock adjustment). Fabricate a legacy lot at the item's current cost
    // so the sale still has a valid, traceable cost basis instead of
    // silently under/over-stating COGS.
    const costPriceCents = item.costPriceCents ?? 0;
    const [legacyLot] = await InventoryLot.create(
      [
        {
          item: itemId,
          supplier: item.supplier || null,
          purchase: null,
          unitCostCents: costPriceCents,
          originalQuantity: remaining,
          remainingQuantity: 0,
          isLegacy: true,
        },
      ],
      { session }
    );
    breakdown.push({
      lot: legacyLot._id,
      supplier: legacyLot.supplier,
      purchase: null,
      quantity: remaining,
      unitCostCents: costPriceCents,
    });
    remaining = 0;
  }

  const totalCostCents = breakdown.reduce((sum, b) => sum + b.quantity * b.unitCostCents, 0);
  const totalQty = breakdown.reduce((sum, b) => sum + b.quantity, 0);
  const weightedUnitCostCents = totalQty > 0 ? Math.round(totalCostCents / totalQty) : 0;

  return { breakdown, weightedUnitCostCents, totalCostCents };
}

// Reverses a previous consumption (used when voiding a sale): restores
// quantity back onto the exact lots it was taken from.
export async function restoreLotConsumption(lotConsumption, session) {
  for (const entry of lotConsumption) {
    await InventoryLot.findByIdAndUpdate(
      entry.lot,
      { $inc: { remainingQuantity: entry.quantity } },
      { session }
    );
  }
}
