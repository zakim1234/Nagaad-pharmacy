import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLinePricing } from '../src/services/saleService.js';

const item = (over = {}) => ({ name: 'Widget', sellingPriceCents: 500, costPriceCents: 300, ...over });

test('defaults to the item\'s current price/cost when the line supplies neither', () => {
  const r = resolveLinePricing({ quantity: 2 }, item());
  assert.deepEqual(r, { unitPriceCents: 500, costPriceCents: 300, discountCents: 0, subtotalCents: 1000 });
});

test('cashier-supplied rate and cost price are independent overrides', () => {
  const r = resolveLinePricing({ quantity: 3, unitPrice: 4, costPrice: 2.5 }, item());
  assert.equal(r.unitPriceCents, 400);
  assert.equal(r.costPriceCents, 250);
  assert.equal(r.subtotalCents, 1200); // gross, before line discount
});

test('changing rate never changes cost, and vice versa', () => {
  const rateOnly = resolveLinePricing({ quantity: 1, unitPrice: 9 }, item());
  assert.equal(rateOnly.costPriceCents, 300); // unchanged from item default
  const costOnly = resolveLinePricing({ quantity: 1, costPrice: 1 }, item());
  assert.equal(costOnly.unitPriceCents, 500); // unchanged from item default
});

test('line discount reduces the line but never below zero net, and rejects excess', () => {
  const r = resolveLinePricing({ quantity: 2, unitPrice: 5, discount: 3 }, item());
  assert.equal(r.subtotalCents, 1000); // still gross
  assert.equal(r.discountCents, 300);
  assert.throws(() => resolveLinePricing({ quantity: 2, unitPrice: 5, discount: 11 }, item()), /cannot exceed its line total/);
});

test('a quoted price (quotation conversion) always wins over any rate in the line', () => {
  const r = resolveLinePricing({ quantity: 1, unitPrice: 999 }, item(), 700);
  assert.equal(r.unitPriceCents, 700);
});

test('rejects a negative rate or cost price', () => {
  assert.throws(() => resolveLinePricing({ quantity: 1, unitPrice: -1 }, item()), /Invalid rate/);
  assert.throws(() => resolveLinePricing({ quantity: 1, costPrice: -1 }, item()), /Invalid cost price/);
});
