import { ApiError } from '../utils/ApiError.js';

// The single authoritative Weighted Average Cost (WAC) formula for the whole
// application. Every place that receives inventory (Stock IN, a customer
// return, a full sale reversal) must call this instead of recalculating its
// own blend, so the business rule can never drift between call sites.
//
// Canonical formula:
//   newAverageCost = (oldQuantity * oldAverageCost + incomingQuantity * incomingUnitCost)
//                     / (oldQuantity + incomingQuantity)
//
// Zero-stock rule: if there is no stock currently on hand, any stale old
// average cost is discarded entirely rather than blended in -- the new
// average simply becomes the incoming unit cost.
//
// Rounding policy: the project stores money as integer cents everywhere
// (see utils/money.js), so this returns integer cents too. A weighted
// average frequently does not divide evenly; this uses standard round-half-
// up (Math.round) on the blended total, matching the rounding already used
// for FIFO lot-blended costs elsewhere in the codebase (lotService.js,
// batchService.js). This is Option B from the spec: plain cents with a
// documented, deterministic rounding rule, chosen over a higher-precision
// "micro-cents" representation because introducing a second money precision
// tier would ripple through every consumer of *Cents fields across the
// codebase (models, reports, frontend display) for a rounding drift that is
// at most a fraction of a cent per receipt -- not worth the blast radius.
export function calculateWeightedAverageCost({ oldQuantity, oldAverageCostCents, incomingQuantity, incomingUnitCostCents }) {
  if (!Number.isFinite(oldQuantity) || oldQuantity < 0) throw new ApiError(400, 'Invalid current stock quantity for cost calculation.');
  if (!Number.isFinite(oldAverageCostCents) || oldAverageCostCents < 0) throw new ApiError(400, 'Invalid current average cost for cost calculation.');
  if (!Number.isSafeInteger(incomingQuantity) || incomingQuantity <= 0) throw new ApiError(400, 'Incoming quantity must be a positive whole number.');
  if (!Number.isFinite(incomingUnitCostCents) || incomingUnitCostCents < 0) throw new ApiError(400, 'Incoming unit cost cannot be negative.');

  if (oldQuantity <= 0) return Math.round(incomingUnitCostCents);

  const newQuantity = oldQuantity + incomingQuantity;
  const newInventoryValueCents = oldQuantity * oldAverageCostCents + incomingQuantity * incomingUnitCostCents;
  return Math.round(newInventoryValueCents / newQuantity);
}
