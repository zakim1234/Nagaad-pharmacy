import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
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
router.post('/profit-sharing', requireRole('admin'), shareProfit);
router.post('/profit-sharing/:id/cancel', requireRole('admin'), cancelProfitShare);
router.post('/', requireRole('admin', 'manager'), createPartner);
router.put('/:id', requireRole('admin', 'manager'), updatePartner);
router.get('/:id/transactions', listPartnerTransactions);
router.post('/:id/contribute', requireRole('admin', 'manager'), contributeCapital);
router.post('/:id/withdraw', requireRole('admin', 'manager'), withdrawCapital);

export default router;
