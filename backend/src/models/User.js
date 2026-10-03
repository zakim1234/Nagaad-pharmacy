import mongoose from 'mongoose';

// Every permission-restrictable module. Kept here (not derived from routes)
// so both the backend middleware and the Users admin UI validate against
// exactly the same canonical list.
export const PERMISSION_MODULES = [
  'stock',
  'inventory',
  'categories',
  'pos',
  'quotations',
  'purchases',
  'accounts',
  'customers',
  'suppliers',
  'supplierInvoices',
  'reports',
  'expenses',
  'createItems',
  'partners',
  'fixedAssets',
  'zakat',
];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    // 'admin'/'manager'/'cashier' are the original built-in roles; 'custom'
    // lets an admin hand-pick permissions without pretending the user fits
    // one of the templates. An admin always has full access regardless of
    // `permissions` -- see middleware/permissions.js.
    role: { type: String, enum: ['admin', 'manager', 'cashier', 'custom'], default: 'admin' },
    // Effective only for non-admin roles. Manager/cashier still start with
    // no modules granted -- an admin must explicitly grant each one, this
    // is not a role-template shortcut.
    permissions: { type: [String], enum: PERMISSION_MODULES, default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
