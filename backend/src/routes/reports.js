import { Router } from 'express';
import { quotationReport } from '../controllers/quotationController.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  salesReport,
  profitReport,
  profitByItemDrilldown,
  inventoryReport,
  customersReport,
  purchasesReport,
  itemProfitReport,
  listReportableUsers,
  userPerformanceReport,
} from '../controllers/reportController.js';
import {
  profitLossReport,
  profitLossExport,
  balanceSheetReport,
  balanceSheetExport,
  expenseReport,
  paymentMethodReport,
  expiredProductsReport,
  lowStockReport,
  salesReturnReport,
  purchaseReturnReport,
} from '../controllers/financialReportController.js';
import { getCustomerHistory } from '../controllers/customerController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('reports'));

router.get('/sales', salesReport);
router.get('/quotations', quotationReport);
router.get('/profit', profitReport);
router.get('/profit/items/:itemId', profitByItemDrilldown);
router.get('/inventory', inventoryReport);
router.get('/customers', customersReport);
router.get('/customers/:id', getCustomerHistory);
router.get('/purchases', purchasesReport);
router.get('/item-profit/:itemId', itemProfitReport);
router.get('/profit-loss', profitLossReport);
router.get('/profit-loss/export', profitLossExport);
router.get('/balance-sheet', balanceSheetReport);
router.get('/balance-sheet/export', balanceSheetExport);
router.get('/expenses', expenseReport);
router.get('/payment-methods', paymentMethodReport);
router.get('/expired-products', expiredProductsReport);
router.get('/low-stock', lowStockReport);
router.get('/sales-returns', salesReturnReport);
router.get('/purchase-returns', purchaseReturnReport);
router.get('/users', listReportableUsers);
router.get('/user-performance', userPerformanceReport);

export default router;
