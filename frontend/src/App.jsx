import StockPage from './pages/stock/StockPage.jsx';
import StockAdjustmentsPage from './pages/stock/StockAdjustmentsPage.jsx';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import SalesInvoicePage from './pages/pos/SalesInvoicePage.jsx';
import QuotationsPage from './pages/quotations/QuotationsPage.jsx';
import QuotationDetailPage from './pages/quotations/QuotationDetailPage.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import RequirePermission from './components/RequirePermission.jsx';
import AppLayout from './layouts/AppLayout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import InventoryPage from './pages/inventory/InventoryPage.jsx';
import InventoryPrintPage from './pages/inventory/InventoryPrintPage.jsx';
import CategoriesPage from './pages/categories/CategoriesPage.jsx';
import POSPage from './pages/pos/POSPage.jsx';
import CloseDayHistoryPage from './pages/pos/CloseDayHistoryPage.jsx';
import PurchasesPage from './pages/purchases/PurchasesPage.jsx';
import PurchaseDetailPage from './pages/purchases/PurchaseDetailPage.jsx';
import CustomersPage from './pages/customers/CustomersPage.jsx';
import CustomerDetailPage from './pages/customers/CustomerDetailPage.jsx';
import CustomerStatementPage from './pages/customers/CustomerStatementPage.jsx';
import SuppliersPage from './pages/suppliers/SuppliersPage.jsx';
import SupplierDetailPage from './pages/suppliers/SupplierDetailPage.jsx';
import SupplierInvoicesPage from './pages/suppliers/SupplierInvoicesPage.jsx';
import AccountsPage from './pages/accounts/AccountsPage.jsx';
import ExpensesPage from './pages/expenses/ExpensesPage.jsx';
import PartnersPage from './pages/partners/PartnersPage.jsx';
import FixedAssetsPage from './pages/fixedAssets/FixedAssetsPage.jsx';
import ZakatPage from './pages/zakat/ZakatPage.jsx';
import ReportsPage from './pages/reports/ReportsPage.jsx';
import ReceiptPage from './pages/receipt/ReceiptPage.jsx';
import PaymentReceiptPage from './pages/receipt/PaymentReceiptPage.jsx';
import PurchaseReceiptPage from './pages/receipt/PurchaseReceiptPage.jsx';
import BulkPaymentReceiptPage from './pages/receipt/BulkPaymentReceiptPage.jsx';
import ReturnReceiptPage from './pages/receipt/ReturnReceiptPage.jsx';
import UsersPage from './pages/users/UsersPage.jsx';
import NotFound from './pages/NotFound.jsx';

function POSWorkspace() { const location = useLocation(); return <POSPage key={location.search} />; }

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/inventory" element={<RequirePermission module="inventory"><InventoryPage /></RequirePermission>} />
              <Route path="/inventory/:id/print" element={<RequirePermission module="inventory"><InventoryPrintPage /></RequirePermission>} />
              <Route path="/categories" element={<RequirePermission module="categories"><CategoriesPage /></RequirePermission>} />
              <Route path="/pos" element={<RequirePermission module="pos"><SalesInvoicePage /></RequirePermission>} />
              <Route path="/pos/new" element={<RequirePermission module="pos"><POSWorkspace /></RequirePermission>} />
              <Route path="/quotations" element={<RequirePermission module="quotations"><QuotationsPage /></RequirePermission>} />
              <Route path="/quotations/new" element={<RequirePermission module="quotations"><QuotationDetailPage key="new" /></RequirePermission>} />
              <Route path="/quotations/:id" element={<RequirePermission module="quotations"><QuotationDetailPage /></RequirePermission>} />
              {/* Close Day now lives inside Daily Closing; old links redirect there. */}
              <Route path="/pos/close-day" element={<Navigate to="/daily-closing" replace />} />
              <Route path="/pos/close-day/history" element={<Navigate to="/daily-closing" replace />} />
              <Route path="/daily-closing" element={<RequirePermission module="pos"><CloseDayHistoryPage /></RequirePermission>} />
              <Route path="/stock" element={<RequirePermission module="stock"><StockPage /></RequirePermission>} />
              <Route path="/stock-adjustments" element={<RequirePermission module="stock"><StockAdjustmentsPage /></RequirePermission>} />
              <Route path="/purchases" element={<RequirePermission module="purchases"><PurchasesPage /></RequirePermission>} />
              <Route path="/purchases/:id" element={<RequirePermission module="purchases"><PurchaseDetailPage /></RequirePermission>} />
              <Route path="/purchases/:id/receipt" element={<RequirePermission module="purchases"><PurchaseReceiptPage /></RequirePermission>} />
              <Route path="/purchases/bulk-payments/:bulkId" element={<RequirePermission module="purchases"><BulkPaymentReceiptPage /></RequirePermission>} />
              <Route path="/customers" element={<RequirePermission module="customers"><CustomersPage /></RequirePermission>} />
              <Route path="/customers/:id" element={<RequirePermission module="customers"><CustomerDetailPage /></RequirePermission>} />
              <Route path="/customers/:id/statement" element={<RequirePermission module="customers"><CustomerStatementPage /></RequirePermission>} />
              <Route path="/suppliers" element={<RequirePermission module="suppliers"><SuppliersPage /></RequirePermission>} />
              <Route path="/suppliers/:id" element={<RequirePermission module="suppliers"><SupplierDetailPage /></RequirePermission>} />
              <Route path="/supplier-invoices" element={<RequirePermission module="supplierInvoices"><SupplierInvoicesPage /></RequirePermission>} />
              <Route path="/accounts" element={<RequirePermission module="accounts"><AccountsPage /></RequirePermission>} />
              <Route path="/expenses" element={<RequirePermission module="expenses"><ExpensesPage /></RequirePermission>} />
              <Route path="/partners" element={<RequirePermission module="partners"><PartnersPage /></RequirePermission>} />
              <Route path="/fixed-assets" element={<RequirePermission module="fixedAssets"><FixedAssetsPage /></RequirePermission>} />
              <Route path="/zakat" element={<RequirePermission module="zakat"><ZakatPage /></RequirePermission>} />
              <Route path="/reports" element={<RequirePermission module="reports"><ReportsPage /></RequirePermission>} />
              <Route path="/receipt/:id" element={<RequirePermission module="pos"><ReceiptPage /></RequirePermission>} />
              <Route path="/receipt/:id/return/:index" element={<RequirePermission module="pos"><ReturnReceiptPage /></RequirePermission>} />
              <Route path="/payment-receipt/:id" element={<RequirePermission module="customers"><PaymentReceiptPage /></RequirePermission>} />
              <Route path="/users" element={<RequirePermission adminOnly><UsersPage /></RequirePermission>} />
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
