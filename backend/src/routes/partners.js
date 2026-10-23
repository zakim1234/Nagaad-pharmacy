import { Router } from 'express';
import { requireAuth, requireRole, requirePermission, requireSuperAdmin } from '../middleware/auth.js';
import {
  listPartners,
  createPartner,
  updatePartner,
  contributeCapital,
  withdrawCapital,
  listPartnerTransactions,
  profitSharingPreview,
  listProfitDistributions,
  getProfitDistribution,
  shareProfit,
  cancelProfitShare,
} from '../controllers/partnerController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('partners'));

router.get('/', listPartners);
router.get('/profit-sharing', listProfitDistributions);
router.get('/profit-sharing/preview', profitSharingPreview);
router.get('/profit-sharing/:id', getProfitDistribution);
// Year-end profit sharing is the Super Admin's only (company-wide, from the overview).
router.post('/profit-sharing', requireSuperAdmin, shareProfit);
router.post('/profit-sharing/:id/cancel', requireSuperAdmin, cancelProfitShare);
router.post('/', requireRole('admin', 'manager'), createPartner);
router.put('/:id', requireRole('admin', 'manager'), updatePartner);
router.get('/:id/transactions', listPartnerTransactions);
router.post('/:id/contribute', requireRole('admin', 'manager'), contributeCapital);
router.post('/:id/withdraw', requireRole('admin', 'manager'), withdrawCapital);

export default router;
