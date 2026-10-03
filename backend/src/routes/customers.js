import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
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
  getCustomerStatement,
  depositToWallet,
  getWalletHistory,
} from '../controllers/customerController.js';

const router = Router();
router.use(requireAuth);

// Shared lookup/create surface: needed by Seller/POS and Quotation (pick or
// create a customer for a sale) regardless of whether the current user has
// the standalone Customers module -- gating these would break that workflow.
router.get('/search', searchCustomers);
router.post('/', createCustomer);
router.get('/:id', getCustomer);

// The actual Customers module: browsing, editing, debt/wallet management.
router.get('/', requirePermission('customers'), listCustomers);
router.put('/:id', requirePermission('customers'), updateCustomer);
router.delete('/:id', requirePermission('customers'), deleteCustomer);
router.get('/:id/history', requirePermission('customers'), getCustomerHistory);
router.get('/:id/statement', requirePermission('customers'), getCustomerStatement);
router.get('/:id/debt', requirePermission('customers'), getCustomerDebt);
router.post('/:id/payments', requirePermission('customers'), payCustomerDebt);
router.post('/:id/wallet/deposit', requirePermission('customers'), depositToWallet);
router.get('/:id/wallet/history', requirePermission('customers'), getWalletHistory);

export default router;
