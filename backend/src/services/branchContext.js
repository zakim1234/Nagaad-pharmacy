import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';

// Multi-branch data separation.
//
// Every request runs inside a branch context (set by requireAuth from the
// user's branch, or the branch a Super Admin switched to). Models that hold
// branch data use the branchScoped plugin below, which adds
// { branch: <current branch> } to every query and aggregate and stamps the
// branch on every new document -- so one branch never sees or changes
// another branch's data, without each query having to remember it.
//
// Outside any context (startup migrations, scripts, tests that never create
// a branch) queries are not filtered at all, exactly as before branches
// existed.
const storage = new AsyncLocalStorage();

export function currentBranch() {
  return storage.getStore()?.branch || null;
}

// Runs fn with `branch` as the current branch (used per request, and by the
// Super Admin dashboard to gather each branch's figures in turn).
export function runWithBranch(branch, fn) {
  return storage.run({ branch: branch ? new mongoose.Types.ObjectId(String(branch)) : null }, fn);
}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
];

export function branchScoped(schema) {
  schema.add({ branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true } });

  function scopeQuery() {
    const branch = currentBranch();
    if (!branch || this.getOptions().skipBranch) return;
    if (this.getFilter().branch === undefined) this.where({ branch });
  }
  for (const op of QUERY_OPS) schema.pre(op, scopeQuery);

  schema.pre('aggregate', function () {
    const branch = currentBranch();
    if (!branch || this.options?.skipBranch) return;
    this.pipeline().unshift({ $match: { branch } });
  });

  schema.pre('validate', function () {
    if (!this.branch) {
      const branch = currentBranch();
      if (branch) this.branch = branch;
    }
  });

  schema.pre('insertMany', function (next, docs) {
    const branch = currentBranch();
    if (branch) for (const d of Array.isArray(docs) ? docs : [docs]) if (d && !d.branch) d.branch = branch;
    next();
  });
}
