import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';

// Drops only the transactional/business-data collections (test fixtures from
// earlier development), leaving the User collection (and its admin login)
// untouched. Run this once after the schema upgrade that introduced
// InventoryLot / CustomerLedger / Payment allocations, then re-run the seed
// script to get clean sample data compatible with the new schema.
async function reset() {
  await connectDB();
  const collections = [
    'sales',
    'purchases',
    'payments',
    'customers',
    'customerledgers',
    'inventorylots',
    'inventoryitems',
    'suppliers',
    'categories',
    'counters',
    'auditlogs',
  ];

  for (const name of collections) {
    try {
      await mongoose.connection.db.collection(name).drop();
      console.log(`[reset] dropped ${name}`);
    } catch (err) {
      if (err.codeName === 'NamespaceNotFound') {
        console.log(`[reset] ${name} did not exist, skipping`);
      } else {
        throw err;
      }
    }
  }

  console.log('[reset] done.');
  process.exit(0);
}

reset().catch((err) => {
  console.error('[reset] failed:', err);
  process.exit(1);
});
