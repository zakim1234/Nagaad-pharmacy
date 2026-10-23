import { Router } from 'express';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import {
  listCustomers,
  searchCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerHistory,
  getCustomerDebt,
  payCustomerDebt,
  cancelCustomerPayment,
  getCustomerStatement,
  depositToWallet,
  getCustomerItemsReport,
  withdrawFromWallet,
  payDebtFromWallet,
  setWalletAutoPay,
  getWalletHistory,
  listDebtors,
} from '../controllers/customerController.js';

const router = Router();
router.use(requireAuth);

// Shared lookup/create surface: needed by Seller/POS and Quotation (pick or
// create a customer for a sale) regardless of whether the current user has
// the standalone Customers module -- gating these would break that workflow.
router.get('/search', searchCustomers);
router.post('/', createCustomer);
router.get('/debtors', requirePermission('customers'), listDebtors);
router.get('/:id', getCustomer);

// The actual Customers module: browsing, editing, debt/wallet management.
router.get('/', requirePermission('customers'), listCustomers);
router.put('/:id', requirePermission('customers'), updateCustomer);
router.delete('/:id', requirePermission('customers'), deleteCustomer);
router.get('/:id/history', requirePermission('customers'), getCustomerHistory);
router.get('/:id/statement', requirePermission('customers'), getCustomerStatement);
router.get('/:id/items', requirePermission('customers'), getCustomerItemsReport);
router.get('/:id/debt', requirePermission('customers'), getCustomerDebt);
router.post('/:id/payments', requirePermission('customers'), payCustomerDebt);
router.post('/:id/payments/:paymentId/cancel', requirePermission('customers'), requireRole('admin', 'manager'), cancelCustomerPayment);
router.post('/:id/wallet/deposit', requirePermission('customers'), depositToWallet);
router.post('/:id/wallet/withdraw', requirePermission('customers'), withdrawFromWallet);
router.post('/:id/wallet/pay-debt', requirePermission('customers'), payDebtFromWallet);
router.put('/:id/wallet/auto-pay', requirePermission('customers'), setWalletAutoPay);
router.get('/:id/wallet/history', requirePermission('customers'), getWalletHistory);

export default router;
