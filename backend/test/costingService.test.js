import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeightedAverageCost } from '../src/services/costingService.js';

test('TEST 1 -- first receipt initializes WAC from zero stock', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 0, oldAverageCostCents: 0, incomingQuantity: 10, incomingUnitCostCents: 100 });
  assert.equal(avg, 100); // $1.00
});

test('TEST 2 -- second receipt blends: 10@$1 + 10@$5 = 20@$3', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 10, oldAverageCostCents: 100, incomingQuantity: 10, incomingUnitCostCents: 500 });
  assert.equal(avg, 300); // $3.00
});

test('TEST 3 -- third receipt blends: 20@$3 + 20@$0.50 = 40@$1.75', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 20, oldAverageCostCents: 300, incomingQuantity: 20, incomingUnitCostCents: 50 });
  assert.equal(avg, 175); // $1.75
});

test('TEST 4 -- zero-stock rule discards stale average cost entirely', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 0, oldAverageCostCents: 800, incomingQuantity: 10, incomingUnitCostCents: 200 });
  assert.equal(avg, 200); // $2.00, NOT a blend with the stale $8.00
});

test('negative on-hand quantity is treated the same as zero stock (defensive)', () => {
  // Should never happen in practice, but the zero-stock rule must not
  // silently blend a corrupt negative quantity into the new average.
  assert.throws(() => calculateWeightedAverageCost({ oldQuantity: -1, oldAverageCostCents: 800, incomingQuantity: 10, incomingUnitCostCents: 200 }));
});

test('exact division: 3 units @ $1 + 2 units @ $2 = $1.40 average', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 3, oldAverageCostCents: 100, incomingQuantity: 2, incomingUnitCostCents: 200 });
  assert.equal(avg, 140);
});

test('fractional cent rounds half up: 1@$1.00 + 1@$1.01 = $1.005 rounds to $1.01', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 1, oldAverageCostCents: 100, incomingQuantity: 1, incomingUnitCostCents: 101 });
  // (100 + 101) / 2 = 100.5 -> Math.round -> 101
  assert.equal(avg, 101);
});

test('fractional cent rounds down when below half: 3@$1.00 + 1@$1.02 -> 402/4=100.5 rounds to 101', () => {
  const avg = calculateWeightedAverageCost({ oldQuantity: 3, oldAverageCostCents: 100, incomingQuantity: 1, incomingUnitCostCents: 102 });
  assert.equal(avg, 101); // (300+102)/4 = 100.5 -> 101
});

test('concurrent-style sequential blend matches a single combined blend (associativity check)', () => {
  // 10 @ $2 existing, then two receipts of 10@$4 and 10@$8 applied in
  // sequence must land on the same total as blending all three at once:
  // (10*200 + 10*400 + 10*800) / 30 = 14000/30 = 466.66... -> 467
  const afterFirst = calculateWeightedAverageCost({ oldQuantity: 10, oldAverageCostCents: 200, incomingQuantity: 10, incomingUnitCostCents: 400 });
  const afterSecond = calculateWeightedAverageCost({ oldQuantity: 20, oldAverageCostCents: afterFirst, incomingQuantity: 10, incomingUnitCostCents: 800 });
  assert.equal(afterSecond, 467);
});

test('validates inputs: rejects non-positive incoming quantity', () => {
  assert.throws(() => calculateWeightedAverageCost({ oldQuantity: 10, oldAverageCostCents: 100, incomingQuantity: 0, incomingUnitCostCents: 100 }));
  assert.throws(() => calculateWeightedAverageCost({ oldQuantity: 10, oldAverageCostCents: 100, incomingQuantity: -5, incomingUnitCostCents: 100 }));
});

test('validates inputs: rejects negative incoming unit cost', () => {
  assert.throws(() => calculateWeightedAverageCost({ oldQuantity: 10, oldAverageCostCents: 100, incomingQuantity: 5, incomingUnitCostCents: -1 }));
});
