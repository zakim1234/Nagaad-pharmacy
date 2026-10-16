import mongoose from 'mongoose';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import BusinessDay from '../models/BusinessDay.js';
import SupplierInvoiceArchive from '../models/SupplierInvoiceArchive.js';

const NOT_SCOPED = new Set(['User', 'Counter', 'Branch']);

// Unique indexes that are per branch now (see the models); the old
// company-wide versions are dropped so a second branch can reuse a name.
const OLD_UNIQUE_INDEXES = [
  ['accounts', 'name_1'],
  ['categories', 'name_1'],
  ['expensecategories', 'name_1'],
  ['inventoryitems', 'itemCode_1'],
  ['inventoryitems', 'serialNumber_1'],
  ['supplierinvoicearchives', 'serialNumber_1'],
];

// Idempotent, runs at startup. On a deployment from before branches: creates
// the first branch, puts every existing record and user in it, gives that
// branch the business day, and makes the oldest admin the Super Admin.
// Afterwards it only fills in anything still missing a branch.
export async function migrateBranches() {
  let first = await Branch.findOne().sort({ createdAt: 1 });
  if (!first) {
    first = await Branch.create({ name: process.env.FIRST_BRANCH_NAME || 'Main Branch' });
    console.log(`[branches] created first branch "${first.name}"`);
  }

  for (const model of Object.values(mongoose.models)) {
    if (NOT_SCOPED.has(model.modelName) || !model.schema.path('branch')) continue;
    if (model.modelName === 'BusinessDay') continue;
    const res = await model.collection.updateMany({ $or: [{ branch: { $exists: false } }, { branch: null }] }, { $set: { branch: first._id } });
    if (res.modifiedCount) console.log(`[branches] ${model.modelName}: ${res.modifiedCount} record(s) put in "${first.name}"`);
  }

  // The single business day becomes the first branch's.
  const old = await BusinessDay.collection.findOne({ _id: 'current' });
  if (old) {
    const id = `current:${first._id}`;
    if (!(await BusinessDay.collection.findOne({ _id: id }))) await BusinessDay.collection.insertOne({ ...old, _id: id, branch: first._id });
    await BusinessDay.collection.deleteOne({ _id: 'current' });
  }

  // Users: everyone without a branch joins the first branch; the oldest admin
  // becomes the Super Admin (sees and switches between all branches).
  if (!(await User.exists({ isSuperAdmin: true }))) {
    const owner = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
    if (owner) {
      await User.updateOne({ _id: owner._id }, { $set: { isSuperAdmin: true, branch: null } });
      console.log(`[branches] ${owner.username} is the Super Admin`);
    }
  }
  await User.updateMany({ isSuperAdmin: { $ne: true }, $or: [{ branch: { $exists: false } }, { branch: null }] }, { $set: { branch: first._id } });

  for (const [collection, index] of OLD_UNIQUE_INDEXES) {
    try {
      await mongoose.connection.db.collection(collection).dropIndex(index);
      console.log(`[branches] dropped company-wide index ${collection}.${index}`);
    } catch {
      // already gone (or the collection doesn't exist yet)
    }
  }
  await SupplierInvoiceArchive.syncIndexes();
}
