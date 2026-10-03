import ExpenseCategory from '../models/ExpenseCategory.js';
import { ApiError } from '../utils/ApiError.js';

// Seeded the first time categories are read. Includes the four the Expenses
// module originally shipped with, so existing expenses keep resolving.
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries',
  'Labor',
  'Transport',
  'Fuel',
  'Office Supplies',
  'Security & Hygiene',
  'Refreshments',
  'Other',
];

const COLLATION = { locale: 'en', strength: 2 }; // case-insensitive

async function ensureSeeded() {
  if (await ExpenseCategory.estimatedDocumentCount()) return;
  await ExpenseCategory.bulkWrite(
    DEFAULT_EXPENSE_CATEGORIES.map((name, i) => ({
      updateOne: { filter: { name }, update: { $setOnInsert: { name, sortOrder: i } }, upsert: true, collation: COLLATION },
    }))
  );
}

// Active category names in display order.
export async function listExpenseCategories() {
  await ensureSeeded();
  const docs = await ExpenseCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  return docs.map((d) => d.name);
}

// Returns the canonical spelling of a category, or throws 400 if it doesn't exist.
export async function resolveExpenseCategory(name) {
  await ensureSeeded();
  const doc = await ExpenseCategory.findOne({ name: String(name || '').trim(), isActive: true }).collation(COLLATION);
  if (!doc) throw new ApiError(400, 'Select a valid expense category.');
  return doc.name;
}

export async function addExpenseCategory(rawName) {
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ApiError(400, 'Category name is required.');
  if (name.length > 60) throw new ApiError(400, 'Category name is too long (60 characters max).');
  await ensureSeeded();
  if (await ExpenseCategory.exists({ name }).collation(COLLATION)) throw new ApiError(409, `The category "${name}" already exists.`);
  const last = await ExpenseCategory.findOne().sort({ sortOrder: -1 });
  const doc = await ExpenseCategory.create({ name, sortOrder: (last?.sortOrder ?? -1) + 1 });
  return doc.name;
}

// Idempotent version of addExpenseCategory: returns the category's canonical
// name whether it already existed or was just created. Used where a feature
// (e.g. auto-deducting Zakat) needs a specific category to exist without
// making the admin create it by hand first.
export async function ensureExpenseCategory(rawName) {
  await ensureSeeded();
  const name = String(rawName || '').trim().replace(/\s+/g, ' ');
  const existing = await ExpenseCategory.findOne({ name, isActive: true }).collation(COLLATION);
  if (existing) return existing.name;
  return addExpenseCategory(name);
}
