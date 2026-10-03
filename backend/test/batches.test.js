import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateBatches } from '../src/services/batchService.js';
const now = new Date('2026-09-15');
const batch = (id, qty, expiry, cost, received = '2026-09-01') => ({ _id: id, remainingQuantity: qty, expiryDate: expiry, unitCostCents: cost, receivedAt: received });
test('FEFO splits a sale across batches and preserves exact COGS', () => {
  const allocations = allocateBatches([batch('B', 100, '2028-01-01', 120), batch('A', 20, '2027-01-01', 100)], 50, now);
  assert.deepEqual(allocations.map(a => [a.lot, a.quantity]), [['A', 20], ['B', 30]]);
  assert.equal(allocations.reduce((s, a) => s + a.quantity * a.unitCostCents, 0), 5600);
});
test('expired and reserved units are excluded', () => {
  assert.throws(() => allocateBatches([batch('expired', 100, '2026-01-01', 10), { ...batch('held', 10, null, 10), reservedQuantity: 9 }], 2, now), /Insufficient sellable/);
});
test('FIFO breaks equal expiry dates and handles missing expiry', () => {
  const lots = [batch('B', 5, null, 10, '2026-09-02'), batch('A', 5, null, 10), batch('C', 5, '2027-01-01', 10)];
  assert.deepEqual(allocateBatches(lots, 12, now).map(a => [a.lot, a.quantity]), [['C', 5], ['A', 5], ['B', 2]]);
});
test('zero and exhausted batches cannot supply stock', () => assert.throws(() => allocateBatches([batch('A', 0, null, 10)], 1, now)));
