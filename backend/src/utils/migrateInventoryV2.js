import mongoose from 'mongoose';
import { nextSequence } from '../models/Counter.js';

async function nextItemCode() {
  const seq = await nextSequence('itemCode');
  return `ITM-${String(seq).padStart(6, '0')}`;
}

// Brings pre-existing InventoryItem documents up to the current schema:
// - free-text `category` strings become references to Category documents
// - every item gets a human-readable, auto-generated `itemCode`
// - `serialNumber` is backfilled to an empty string where missing
// Uses the raw driver (not the InventoryItem model) so it works safely no
// matter what shape old documents are in -- it must never throw a Mongoose
// cast error on legacy data.
export async function migrateInventorySchema() {
  const db = mongoose.connection.db;
  const items = db.collection('inventoryitems');
  const categories = db.collection('categories');

  const categoryIdByName = new Map();
  async function resolveCategoryId(rawName) {
    const name = (rawName || '').trim() || 'Uncategorized';
    const key = name.toLowerCase();
    if (categoryIdByName.has(key)) return categoryIdByName.get(key);
    const existing = await categories.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
    if (existing) {
      categoryIdByName.set(key, existing._id);
      return existing._id;
    }
    const now = new Date();
    try {
      const res = await categories.insertOne({ name, createdAt: now, updatedAt: now });
      categoryIdByName.set(key, res.insertedId);
      return res.insertedId;
    } catch (err) {
      // Another concurrent process created the same category first; use it.
      if (err.code === 11000) {
        const raceWinner = await categories.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        if (raceWinner) {
          categoryIdByName.set(key, raceWinner._id);
          return raceWinner._id;
        }
      }
      throw err;
    }
  }

  const cursor = items.find({
    $or: [{ category: { $type: 'string' } }, { itemCode: { $exists: false } }, { serialNumber: { $exists: false } }],
  });

  let updated = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const update = {};

    if (typeof doc.category === 'string') {
      update.category = await resolveCategoryId(doc.category);
    }
    if (!doc.itemCode) {
      update.itemCode = await nextItemCode();
    }
    if (doc.serialNumber === undefined) {
      update.serialNumber = '';
    }

    if (Object.keys(update).length > 0) {
      await items.updateOne({ _id: doc._id }, { $set: update });
      updated += 1;
    }
  }

  if (updated > 0) {
    console.log(`[migrate] inventory: updated ${updated} item(s) to the new schema.`);
  }
  return updated;
}

export default migrateInventorySchema;
