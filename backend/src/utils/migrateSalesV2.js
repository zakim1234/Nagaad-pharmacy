import mongoose from 'mongoose';

// Brings pre-existing Sale documents up to the Draft/Close-Day schema:
// the old 'completed' status becomes 'CONFIRMED' (with confirmedAt
// backfilled from createdAt) and 'voided' becomes 'CANCELLED'. Uses the raw
// driver so it never throws a Mongoose cast/enum-validation error on
// legacy-shaped documents.
export async function migrateSalesSchema() {
  const db = mongoose.connection.db;
  const sales = db.collection('sales');

  const completedResult = await sales.updateMany(
    { status: 'completed' },
    [{ $set: { status: 'CONFIRMED', confirmedAt: { $ifNull: ['$confirmedAt', '$createdAt'] } } }]
  );
  const voidedResult = await sales.updateMany(
    { status: 'voided' },
    [
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: { $ifNull: ['$cancelledAt', '$voidedAt'] },
          cancelledReason: { $ifNull: ['$cancelledReason', '$voidedReason'] },
        },
      },
    ]
  );

  const updated = (completedResult.modifiedCount || 0) + (voidedResult.modifiedCount || 0);
  if (updated > 0) {
    console.log(`[migrate] sales: updated ${updated} sale(s) to the Draft/Close-Day status schema.`);
  }
  return updated;
}

export default migrateSalesSchema;
