import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { getPreview, confirmClose, listHistory, listDaily, getStatus, openDayHandler, reopenDayCloseHandler } from '../controllers/dayCloseController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('pos'));

router.get('/status', getStatus);
router.get('/preview', getPreview);
router.get('/history', listHistory);
router.get('/daily', listDaily);
// Closing/opening the business day is a critical, irreversible financial
// operation -- restricted to admin/manager the same way voiding a
// sale/purchase already is. Open Day is admin-only per spec.
router.post('/confirm', requireRole('admin', 'manager'), confirmClose);
router.post('/open', requireRole('admin'), openDayHandler);
// Reopening a specific past close is the same accounting-sensitive,
// admin-only action as Open Day -- reverses one closing's account resets
// using its own saved snapshot rather than a blank slate.
router.post('/:id/reopen', requireRole('admin'), reopenDayCloseHandler);

export default router;
