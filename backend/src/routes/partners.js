import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { listPartners, createPartner, updatePartner, contributeCapital, withdrawCapital, listPartnerTransactions } from '../controllers/partnerController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('partners'));

router.get('/', listPartners);
router.post('/', requireRole('admin', 'manager'), createPartner);
router.put('/:id', requireRole('admin', 'manager'), updatePartner);
router.get('/:id/transactions', listPartnerTransactions);
router.post('/:id/contribute', requireRole('admin', 'manager'), contributeCapital);
router.post('/:id/withdraw', requireRole('admin', 'manager'), withdrawCapital);

export default router;
