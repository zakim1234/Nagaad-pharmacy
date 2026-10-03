import 'dotenv/config';
import { connectDB } from '../config/db.js';
import { migrateInventorySchema } from './migrateInventoryV2.js';
import InventoryItem from '../models/InventoryItem.js';

async function run() {
  await connectDB();
  await migrateInventorySchema();
  await InventoryItem.syncIndexes();
  console.log('[migrate] done.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
