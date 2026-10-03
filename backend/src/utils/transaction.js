import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

// Financial and stock writes must never fall back to partial standalone writes.
export async function runInTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (err) {
    if (err?.code === 20) throw new ApiError(503, 'This operation requires MongoDB configured as a replica set. No changes were saved.');
    throw err;
  } finally { await session.endSession(); }
}
