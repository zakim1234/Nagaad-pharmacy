import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentStatusOf } from '../src/controllers/purchaseController.js';

test('Unpaid when nothing has been paid', () => {
  assert.equal(paymentStatusOf({ paidAmountCents: 0, totalCostCents: 1000 }), 'Unpaid');
});
test('Partial when paid is between 0 and total', () => {
  assert.equal(paymentStatusOf({ paidAmountCents: 400, totalCostCents: 1000 }), 'Partial');
});
test('Paid when paid meets or exceeds total', () => {
  assert.equal(paymentStatusOf({ paidAmountCents: 1000, totalCostCents: 1000 }), 'Paid');
  assert.equal(paymentStatusOf({ paidAmountCents: 1000, totalCostCents: 0 }), 'Paid');
});
