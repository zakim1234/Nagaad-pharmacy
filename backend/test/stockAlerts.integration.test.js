import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import InventoryItem from '../src/models/InventoryItem.js';
import InventoryLot from '../src/models/InventoryLot.js';
import { stockAlerts } from '../src/services/stockAlertService.js';

const DAY = 24 * 60 * 60 * 1000;

// Stock running down alerts at 400, 300, 200 of 500 and in red at 100; stock
// expiring within a month alerts in red, from its batches.
test('STOCK ALERTS -- steps since the last restock; expiry within a month', { timeout: 60000 }, async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27028/stock_alerts_${Date.now()}?replicaSet=stocktest`);
  try {
    const restocked = (quantity) => ({
      quantity,
      lowStockThreshold: 5,
      stockEvents: [
        { type: 'STOCK_IN', quantityBefore: 0, quantityAfter: 500 },
        { type: 'SALE', quantityBefore: 500, quantityAfter: quantity },
      ],
    });
    const full = await InventoryItem.create({ itemCode: 'A1', name: 'Full', ...restocked(450) });
    const at400 = await InventoryItem.create({ itemCode: 'A2', name: 'At 400', ...restocked(400) });
    const at300 = await InventoryItem.create({ itemCode: 'A3', name: 'At 300', ...restocked(300) });
    const at100 = await InventoryItem.create({ itemCode: 'A4', name: 'At 100', ...restocked(100) });
    const fresh = await InventoryItem.create({ itemCode: 'A5', name: 'Fresh', quantity: 50 });

    await InventoryLot.create([
      { item: at400._id, unitCostCents: 100, originalQuantity: 40, remainingQuantity: 40, expiryDate: new Date(Date.now() + 10 * DAY) },
      { item: at400._id, unitCostCents: 100, originalQuantity: 360, remainingQuantity: 360, expiryDate: new Date(Date.now() + 200 * DAY) },
      { item: full._id, unitCostCents: 100, originalQuantity: 10, remainingQuantity: 0, expiryDate: new Date(Date.now() + 5 * DAY) },
    ]);
    // No dated batches: the item's own expiry date counts.
    await InventoryItem.updateOne({ _id: fresh._id }, { expiryDate: new Date(Date.now() + 20 * DAY) });

    const { expiring, stock } = await stockAlerts();
    assert.deepEqual(stock.map((s) => [s.name, s.quantity, s.base, s.red]), [
      ['At 100', 100, 500, true],
      ['At 300', 300, 500, false],
      ['At 400', 400, 500, false],
    ]);
    assert.deepEqual(expiring.map((e) => [e.name, e.quantity]), [['At 400', 40], ['Fresh', 50]], 'a sold-out batch does not alert');
    assert.equal(expiring[0].daysLeft, 10);

    // Each step has its own key: dropping to the next step alerts again.
    const before = stock.find((s) => s.name === 'At 300').key;
    await InventoryItem.updateOne({ _id: at300._id }, { quantity: 280 });
    assert.equal((await stockAlerts()).stock.find((s) => s.name === 'At 300').key, before, 'same step, no new alert');
    await InventoryItem.updateOne({ _id: at300._id }, { quantity: 200 });
    assert.notEqual((await stockAlerts()).stock.find((s) => s.name === 'At 300').key, before);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
