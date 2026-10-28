import DayClose from '../models/DayClose.js';

// Only the admin (and the Super Admin) see the business as a whole. Everyone
// else -- cashiers, managers -- sees only their own work since the last Close
// Day: what they sold and the money they took. It starts again from 0 after
// each Close Day; nothing is deleted, the admin still sees it all.
export const seesEverything = (user) => user?.role === 'admin' || !!user?.isSuperAdmin;

// When the current business day's work began: the last Close Day that is
// still standing (a reopened one no longer counts).
export async function lastCloseAt() {
  const last = await DayClose.findOne({ reopened: { $ne: true } }).sort({ closedAt: -1 }).select('closedAt').lean();
  return last?.closedAt || new Date(0);
}
