import Sale from '../models/Sale.js';
import Quotation from '../models/Quotation.js';
import Purchase from '../models/Purchase.js';
import StockAdjustment from '../models/StockAdjustment.js';
import StockEntry from '../models/StockEntry.js';

// Every document keeps a copy of the item's name from when it was made, so
// correcting a misspelt item (e.g. "prmol" -> "Baramol") must also correct
// those copies -- old invoices, quotations, returns, purchases, stock entries
// and adjustments then print the right name, and reports that group by name
// stop splitting one item in two. Only lines pointing at this item change;
// nothing else on a document (prices, quantities, totals) is touched. Safe to
// run again: lines that already carry the name are skipped.
export async function renameItemEverywhere(itemId, name) {
  const wrong = { item: itemId, itemName: { $ne: name } };
  const lines = (path) => [
    { [path]: { $elemMatch: wrong } },
    { $set: { [`${path}.$[line].itemName`]: name } },
    { arrayFilters: [{ 'line.item': itemId }] },
  ];
  const results = await Promise.all([
    Sale.updateMany(...lines('items')),
    Sale.updateMany(
      { 'returns.items': { $elemMatch: wrong } },
      { $set: { 'returns.$[].items.$[line].itemName': name } },
      { arrayFilters: [{ 'line.item': itemId }] }
    ),
    Quotation.updateMany(...lines('items')),
    Purchase.updateMany(...lines('items')),
    StockEntry.updateMany(...lines('rows')),
    StockAdjustment.updateMany(wrong, { $set: { itemName: name } }),
  ]);
  return results.reduce((sum, r) => sum + (r.modifiedCount || 0), 0);
}
