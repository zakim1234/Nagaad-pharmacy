// Builds SupplierInvoiceArchive's new unique index on serialNumber. Checks
// for pre-existing duplicate serials FIRST and refuses to build the index
// (without touching any document) if any are found, since a straight
// syncIndexes() would otherwise fail outright on a database that already
// has them. Resolve any reported duplicates (rename one archive's serial,
// e.g. append "-2") and re-run this script -- it is safe to re-run.
import 'dotenv/config';
import { connectDB } from '../config/db.js';
import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';

async function run() {
  await connectDB();

  const duplicates = await SupplierInvoiceArchive.aggregate([
    { $group: { _id: '$serialNumber', count: { $sum: 1 }, archiveNumbers: { $push: '$archiveNumber' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (duplicates.length > 0) {
    console.error('[migrate] Cannot build the unique serialNumber index -- these serial numbers are used by more than one archive:');
    for (const d of duplicates) {
      console.error(`  - "${d._id}": ${d.archiveNumbers.join(', ')}`);
    }
    console.error('[migrate] Resolve the duplicates above (no data was changed) and re-run this script.');
    process.exit(1);
  }

  await SupplierInvoiceArchive.syncIndexes();
  console.log('[migrate] SupplierInvoiceArchive.serialNumber unique index synced.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
