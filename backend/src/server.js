import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { migrateInventorySchema } from './utils/migrateInventoryV2.js';
import { migrateSalesSchema } from './utils/migrateSalesV2.js';
import { seedDefaultAccounts } from './utils/seedAccounts.js';
import InventoryItem from './models/InventoryItem.js';

const PORT = process.env.PORT || 5010;

// JWT_SECRET has no safe default -- authController signs/verifies every
// token with it, so a missing secret must fail loudly at startup rather
// than surface as a confusing runtime error on the first login attempt.
function validateEnv() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required. Set it in the environment before starting the server.');
  }
  if (!process.env.MONGO_URI) {
    console.warn('[server] MONGO_URI is not set -- falling back to mongodb://127.0.0.1:27017/pos_inventory');
  }
}

async function start() {
  try {
    validateEnv();
    await connectDB();
    await migrateInventorySchema();
    await migrateSalesSchema();
    await seedDefaultAccounts();
    await InventoryItem.syncIndexes();
    // Bind to 0.0.0.0 (not just localhost) so a reverse proxy (Nginx, etc.)
    // running outside this process/container can reach the API.
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[server] Inventory API listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

start();
