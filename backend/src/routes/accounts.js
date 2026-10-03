import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  getAccountTransactions,
  accountsReport,
} from '../controllers/accountController.js';

const router = Router();
router.use(requireAuth);

// The account-picker surface: every payment (POS, Purchases, Wallet
// Deposit) needs the list of accounts to choose from, regardless of
// whether the current user has the standalone Accounts module.
router.get('/', listAccounts);

// The actual Accounts module: reports, per-account detail/ledger, and
// creating/editing accounts (already admin/manager only).
router.get('/report', requirePermission('accounts'), accountsReport);
router.post('/', requirePermission('accounts'), requireRole('admin', 'manager'), createAccount);
router.get('/:id', requirePermission('accounts'), getAccount);
router.put('/:id', requirePermission('accounts'), requireRole('admin', 'manager'), updateAccount);
router.get('/:id/transactions', requirePermission('accounts'), getAccountTransactions);

export default router;
