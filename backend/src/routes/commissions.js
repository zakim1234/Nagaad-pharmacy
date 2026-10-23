import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { commissionPreview, listCommissions, getCommission, createCommission, cancelCommissionHandler } from '../controllers/commissionController.js';

// Commission (staff and admin) is the Super Admin's only.
const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

router.get('/preview', commissionPreview);
router.get('/', listCommissions);
router.get('/:id', getCommission);
router.post('/', createCommission);
router.post('/:id/cancel', cancelCommissionHandler);

export default router;
