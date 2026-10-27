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
  Undo2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { hasPermission } from '../constants/permissions.js';
import { BUSINESS } from '../constants/business.js';
import logo from '../images/logo.png';
import BranchSwitcher from '../components/BranchSwitcher.jsx';
import client, { getSelectedBranch } from '../api/client.js';

// The Super Admin outside any branch sees only the company-wide pages; a
// branch's own pages appear once they open a branch.
const OVERVIEW_PATHS = ['/super-dashboard', '/all-branches', '/reports', '/items-sold', '/refunds', '/partners', '/commissions', '/zakat', '/users', '/branches'];
const inOverviewPath = (path) => OVERVIEW_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
// Only on the Super Admin's own screen, never inside a branch.
const SUPER_ONLY_PATHS = ['/all-branches', '/super-dashboard', '/zakat', '/commissions', '/partners/profit-sharing', '/branches'];
const isSuperOnlyPath = (path) => SUPER_ONLY_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
const inOverview = (user) => !!user?.isSuperAdmin && !getSelectedBranch();

// `module: null` means always visible to any authenticated user (no
// standalone permission gate) -- Dashboard only, per the deliberate choice
// to leave it ungated ("if appropriate").
const navItems = [
  { to: '/super-dashboard', label: 'Dashboard', icon: LayoutDashboard, module: null, superAdmin: true, section: 'Overview' },
  { to: '/all-branches', label: 'All Branches', icon: Globe2, module: null, superAdmin: true, section: 'Overview' },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: null, section: 'Overview' },
  { to: '/pos', label: 'Seller / POS', icon: ShoppingCart, module: 'pos', section: 'Sales' },
  { to: '/daily-closing', label: 'Daily Closing', icon: CalendarCheck, module: 'pos', section: 'Sales' },
  { to: '/quotations', label: 'Quotation', icon: FileText, module: 'quotations', section: 'Sales' },
  { to: '/customers', label: 'Customers', icon: Users, module: 'customers', section: 'Sales' },
  { to: '/stock', label: 'Stock', icon: Boxes, module: 'stock', section: 'Stock' },
  { to: '/stock-adjustments', label: 'Stock Adjustment', icon: SlidersHorizontal, module: 'stock', section: 'Stock' },
  { to: '/inventory', label: 'Inventory', icon: Boxes, module: 'inventory', section: 'Stock' },
  { to: '/categories', label: 'Categories', icon: Tag, module: 'categories', section: 'Stock' },
  { to: '/purchases', label: 'Purchase Invoices', icon: FileText, module: 'purchases', section: 'Purchasing' },
  { to: '/suppliers', label: 'Suppliers', icon: Building2, module: 'suppliers', section: 'Purchasing' },
  { to: '/supplier-invoices', label: 'Supplier Invoices', icon: Receipt, module: 'supplierInvoices', section: 'Purchasing' },
  { to: '/accounts', label: 'Accounts', icon: Wallet, module: 'accounts', section: 'Money' },
  { to: '/expenses', label: 'Expenses', icon: HandCoins, module: 'expenses', section: 'Money' },
  { to: '/salaries', label: 'Salaries', icon: Banknote, module: null, roles: ['admin', 'manager'], section: 'Money' },
  { to: '/commissions', label: 'Commissions', icon: BadgePercent, module: null, superAdmin: true, section: 'Money' },
  { to: '/partners', label: 'Partners / Investors', icon: Handshake, module: 'partners', section: 'Money' },
  { to: '/fixed-assets', label: 'Fixed Assets', icon: Archive, module: 'fixedAssets', section: 'Money' },
  { to: '/zakat', label: 'Zakat', icon: Percent, module: 'zakat', superAdmin: true, section: 'Money' },
  { to: '/reports', label: 'Reports', icon: BarChart3, module: 'reports', section: 'Reports' },
  { to: '/items-sold', label: 'Items Sold', icon: PackageCheck, module: 'reports', section: 'Reports' },
  { to: '/refunds', label: 'Refunds', icon: Undo2, module: 'pos', section: 'Reports' },
];

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const items = navItems
    .filter(({ module, roles, superAdmin }) => (superAdmin ? !!user?.isSuperAdmin : roles ? roles.includes(user?.role) : module === null || hasPermission(user, module)))
    .concat(user?.role === 'admin' ? [{ to: '/users', label: 'Users', icon: UserCog, module: null, section: 'Admin' }] : [])
    .concat(user?.isSuperAdmin ? [{ to: '/branches', label: 'Branches', icon: Store, module: null, section: 'Admin' }] : [])
    .filter(({ to }) => (inOverview(user) ? OVERVIEW_PATHS.includes(to) : !SUPER_ONLY_PATHS.includes(to)));
  // Grouped under small section headings, in the order they first appear.
  const sections = [];
  for (const item of items) {
    let group = sections.find((g) => g.name === item.section);
    if (!group) sections.push((group = { name: item.section, items: [] }));
    group.items.push(item);
  }

  return (
    <div className="flex h-full flex-col surface-blue text-neutral-300">
      <div className="flex items-center gap-3 px-5 pb-4 pt-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white p-1">
          <img src={logo} alt={BUSINESS.name} className="h-full w-full object-contain" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
            {BUSINESS.name}
          </p>
          <p className="truncate text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500">Inventory &amp; POS</p>
        </div>
      </div>

      <BranchSwitcher />
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {sections.map((group) => (
          <div key={group.name} className="mt-4 first:mt-1">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">{group.name}</p>
            <div className="space-y-px">
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13.5px] transition-colors ${
                      isActive ? 'bg-white/[0.55] font-semibold text-white' : 'font-medium text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full ${isActive ? 'bg-brand-700' : 'bg-transparent'}`} />
                      <Icon className={`h-[17px] w-[17px] shrink-0 ${isActive ? 'text-brand-400' : 'text-neutral-500 group-hover:text-neutral-300'}`} />
                      <span className="truncate">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 to-brand-400 text-xs font-bold text-neutral-950">
            {user?.name?.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
            <p className="truncate text-[11px] capitalize text-neutral-500">{user?.isSuperAdmin ? 'Super Admin' : user?.role}</p>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </div>
    </div>
  );
}

// Thin bar over every page: where you are (a branch, or all branches) and today.
function TopBar() {
  const { user } = useAuth();
  const [branchName, setBranchName] = useState('');
  useEffect(() => {
    const id = getSelectedBranch();
    if (!user || !id) return;
    client
      .get('/branches')
      .then((r) => setBranchName(r.data.data.find((b) => String(b.id) === id)?.name || ''))
      .catch(() => setBranchName(''));
  }, [user]);
  const where = inOverview(user) ? 'All branches' : branchName;
  return (
    <div className="hidden items-center justify-between border-b border-white/[0.06] surface-blue px-8 py-2.5 md:flex no-print">
      <p className="flex items-center gap-2 text-[13px] text-neutral-400">
        {where && (
          <>
            <Store className="h-3.5 w-3.5 text-brand-400" />
            <span className="font-semibold text-white">{where}</span>
            <span className="text-neutral-700">/</span>
          </>
        )}
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <p className="text-[13px] text-neutral-400">
        Signed in as <span className="font-semibold text-white">{user?.name}</span>
      </p>
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
    else if (!inOverview(user) && isSuperOnlyPath(location.pathname)) navigate('/dashboard', { replace: true });
  }, [user, location.pathname, navigate]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f6f4]">
      {/* Desktop / tablet sidebar */}
      <aside className="hidden w-64 shrink-0 no-print md:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden no-print">
          <div
            className="absolute inset-0 bg-neutral-900/40 transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 surface-blue shadow-xl transition-transform duration-200">
            <div className="flex items-center justify-end px-2.5 pt-2.5">
              <button
                onClick={() => setMobileOpen(false)}
                className="relative z-10 rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
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
        <header className="flex items-center gap-3 border-b border-neutral-200/80 bg-white px-4 py-3 md:hidden no-print">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100">
            <Menu className="h-5 w-5" />
          </button>
          <img src={logo} alt={BUSINESS.name} className="h-7 w-7 rounded-md object-contain" />
          <p className="text-sm font-semibold text-neutral-900">{BUSINESS.name}</p>
        </header>

        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
