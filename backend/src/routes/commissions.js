import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { commissionPreview, listCommissions, getCommission, createCommission, cancelCommissionHandler } from '../controllers/commissionController.js';

// Commission: admins pay and cancel; managers can look.
const router = Router();
router.use(requireAuth);
router.use(requireRole('admin', 'manager'));

router.get('/preview', commissionPreview);
router.get('/', listCommissions);
router.get('/:id', getCommission);
router.post('/', requireRole('admin'), createCommission);
router.post('/:id/cancel', requireRole('admin'), cancelCommissionHandler);

export default router;
