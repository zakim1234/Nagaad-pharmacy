// Must match backend/src/models/User.js PERMISSION_MODULES exactly.
export const PERMISSION_MODULES = [
  { key: 'stock', label: 'Stock' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'categories', label: 'Categories' },
  { key: 'pos', label: 'Seller / POS' },
  { key: 'quotations', label: 'Quotation' },
  { key: 'purchases', label: 'Purchase Invoices' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'customers', label: 'Customers' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'supplierInvoices', label: 'Supplier Invoices' },
  { key: 'reports', label: 'Reports' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'createItems', label: 'Can create items (POS quick-create)' },
  { key: 'partners', label: 'Partners / Investors' },
  { key: 'fixedAssets', label: 'Fixed Assets' },
  { key: 'zakat', label: 'Zakat Calculator' },
];

export const ROLES = ['admin', 'manager', 'cashier', 'custom'];

export function hasPermission(user, moduleKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (user.permissions || []).includes(moduleKey);
}
