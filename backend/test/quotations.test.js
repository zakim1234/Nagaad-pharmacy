import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuotation, effectiveStatus } from '../src/services/quotationService.js';
const itemId = '123456789012345678901234';
test('quoted totals preserve cents, line discounts and overall discount', () => {
  const result = calculateQuotation([{ itemId, quantity: 100, unitPrice: 1.10, discount: 5 }], 2);
  assert.equal(result.subtotalCents, 11000);
  assert.equal(result.items[0].lineTotalCents, 10500);
  assert.equal(result.grandTotalCents, 10300);
});
test('invalid prices, quantities, duplicates and excessive discounts are rejected', () => {
  for (const value of ['invalid', Infinity, -1, '']) assert.throws(() => calculateQuotation([{ itemId, quantity: 1, unitPrice: value }]));
  for (const quantity of [0, -1, 1.2, Infinity]) assert.throws(() => calculateQuotation([{ itemId, quantity, unitPrice: 1 }]));
  assert.throws(() => calculateQuotation([{ itemId, quantity: 1, unitPrice: 1 }], 2));
  assert.throws(() => calculateQuotation([{ itemId, quantity: 1, unitPrice: 1 }, { itemId, quantity: 1, unitPrice: 1 }]));
});
test('expiry is consistent without changing converted or rejected history', () => {
  const expiryDate = new Date('2025-01-01');
  const now = new Date('2026-01-01');
  assert.equal(effectiveStatus({ status: 'Accepted', expiryDate }, now), 'Expired');
  assert.equal(effectiveStatus({ status: 'Pending', expiryDate }, now), 'Expired');
  assert.equal(effectiveStatus({ status: 'Converted', expiryDate }, now), 'Converted');
  assert.equal(effectiveStatus({ status: 'Rejected', expiryDate }, now), 'Rejected');
});
