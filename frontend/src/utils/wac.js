// Informational-only preview of the Weighted Average Cost blend, mirroring
// backend/src/services/costingService.js exactly (including its zero-stock
// rule and round-half-up rounding to the nearest cent). This is NEVER
// authoritative -- the backend always recalculates from the live database
// quantity/average at save time, so a stale preview (e.g. another user
// received stock in between) can never corrupt the real value.
export function previewWeightedAverageCost({ currentQuantity, currentAverageCost, incomingQuantity, incomingUnitCost }) {
  const oldQuantity = Number(currentQuantity) || 0;
  const oldAverageCostCents = Math.round((Number(currentAverageCost) || 0) * 100);
  const qty = Number(incomingQuantity);
  const unitCostCents = Math.round((Number(incomingUnitCost) || 0) * 100);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitCostCents) || unitCostCents < 0) return null;

  const newQuantity = oldQuantity + qty;
  const newAverageCostCents =
    oldQuantity <= 0 ? Math.round(unitCostCents) : Math.round((oldQuantity * oldAverageCostCents + qty * unitCostCents) / newQuantity);

  return {
    projectedQuantity: newQuantity,
    projectedAverageCost: newAverageCostCents / 100,
    currentQuantity: oldQuantity,
    currentAverageCost: oldAverageCostCents / 100,
  };
}
