import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Boxes,
  Tag,
  ShoppingCart,
  Users,
  Building2,
  BarChart3,
  BadgePercent,
  PackageCheck,
  Wallet,
  FileText,
  Receipt,
  HandCoins,
  Handshake,
  Archive,
  Percent,
  LogOut,
  Menu,
  X,
  UserCog,
  CalendarCheck,
  SlidersHorizontal,
  Banknote,
  Globe2,
  Store,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';
import { BUSINESS } from '../constants/business.js';
import logo from '../images/logo.png';
import BranchSwitcher from '../components/BranchSwitcher.jsx';
import { getSelectedBranch } from '../api/client.js';

// The Super Admin outside any branch sees only the company-wide pages; a
// branch's own pages appear once they open a branch.
const OVERVIEW_PATHS = ['/super-dashboard', '/all-branches', '/reports', '/items-sold', '/partners', '/commissions', '/zakat', '/users', '/branches'];
const inOverviewPath = (path) => OVERVIEW_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
const inOverview = (user) => !!user?.isSuperAdmin && !getSelectedBranch();

// `module: null` means always visible to any authenticated user (no
// standalone permission gate) -- Dashboard only, per the deliberate choice
// to leave it ungated ("if appropriate").
const navItems = [
  { to: '/super-dashboard', label: 'Dashboard', icon: LayoutDashboard, module: null, superAdmin: true },
  { to: '/all-branches', label: 'All Branches', icon: Globe2, module: null, superAdmin: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: null },
  { to: '/stock', label: 'Stock', icon: Boxes, module: 'stock' },
  { to: '/stock-adjustments', label: 'Stock Adjustment', icon: SlidersHorizontal, module: 'stock' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, module: 'inventory' },
  { to: '/categories', label: 'Categories', icon: Tag, module: 'categories' },
  { to: '/pos', label: 'Seller / POS', icon: ShoppingCart, module: 'pos' },
  { to: '/daily-closing', label: 'Daily Closing', icon: CalendarCheck, module: 'pos' },
  { to: '/quotations', label: 'Quotation', icon: FileText, module: 'quotations' },
  { to: '/purchases', label: 'Purchase Invoices', icon: FileText, module: 'purchases' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, module: 'accounts' },
  { to: '/partners', label: 'Partners / Investors', icon: Handshake, module: 'partners' },
  { to: '/fixed-assets', label: 'Fixed Assets', icon: Archive, module: 'fixedAssets' },
  { to: '/zakat', label: 'Zakat', icon: Percent, module: 'zakat' },
  { to: '/customers', label: 'Customers', icon: Users, module: 'customers' },
  { to: '/suppliers', label: 'Suppliers', icon: Building2, module: 'suppliers' },
  { to: '/supplier-invoices', label: 'Supplier Invoices', icon: Receipt, module: 'supplierInvoices' },
  { to: '/expenses', label: 'Expenses', icon: HandCoins, module: 'expenses' },
  { to: '/salaries', label: 'Salaries', icon: Banknote, module: null, roles: ['admin', 'manager'] },
  { to: '/commissions', label: 'Commissions', icon: BadgePercent, module: null, roles: ['admin', 'manager'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports' },
  { to: '/items-sold', label: 'Items Sold', icon: PackageCheck, module: 'reports' },
];

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <img src={logo} alt={BUSINESS.name} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-slate-900">{BUSINESS.name}</p>
          <p className="truncate text-xs font-normal leading-tight text-slate-400">Inventory &amp; POS</p>
        </div>
      </div>

      <BranchSwitcher />
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pt-1">
        {navItems
          .filter(({ module, roles, superAdmin }) => (superAdmin ? !!user?.isSuperAdmin : roles ? roles.includes(user?.role) : module === null || hasPermission(user, module)))
          .concat(user?.role === 'admin' ? [{ to: '/users', label: 'Users', icon: UserCog, module: null }] : [])
          .concat(user?.isSuperAdmin ? [{ to: '/branches', label: 'Branches', icon: Store, module: null }] : [])
          .filter(({ to }) => (inOverview(user) ? OVERVIEW_PATHS.includes(to) : !['/all-branches', '/super-dashboard'].includes(to)))
          .map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-brand-50 font-medium text-brand-700' : 'font-normal text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`h-4 w-0.5 shrink-0 rounded-full ${isActive ? 'bg-brand-600' : 'bg-transparent'}`} />
                <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-500'}`} />
                <span className="truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-2.5">
        <div className="mb-1.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
            {user?.name?.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
            <p className="truncate text-xs font-normal capitalize text-slate-400">{user?.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-normal text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Logout
        </button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (inOverview(user) && !inOverviewPath(location.pathname)) navigate('/super-dashboard', { replace: true });
  }, [user, location.pathname, navigate]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white no-print md:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden no-print">
          <div
            className="absolute inset-0 bg-slate-900/40 transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl transition-transform duration-200">
            <div className="flex items-center justify-end px-2.5 pt-2.5">
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="-mt-11">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden no-print">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>
          <img src={logo} alt={BUSINESS.name} className="h-7 w-7 rounded-md object-contain" />
          <p className="text-sm font-semibold text-slate-900">{BUSINESS.name}</p>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
