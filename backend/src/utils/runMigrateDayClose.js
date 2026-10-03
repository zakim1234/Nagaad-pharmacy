// Drops DayClose's old unique index on businessDate and creates the new
// (non-unique, still indexed) one -- required because the Close Day/Open
// Day workflow now legitimately allows multiple DayClose documents on the
// same calendar date (one per close event, e.g. close at 2pm, Open Day,
// close again at 6pm). This only touches index metadata, never documents:
// no existing DayClose data is read, modified, or deleted.
import 'dotenv/config';
import { connectDB } from '../config/db.js';
import DayClose from '../models/DayClose.js';
import BusinessDay from '../models/BusinessDay.js';

async function run() {
  await connectDB();
  await DayClose.syncIndexes();
  await BusinessDay.syncIndexes();
  console.log('[migrate] DayClose/BusinessDay indexes synced.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
