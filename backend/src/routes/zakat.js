import { Router } from 'express';
import { requireAuth, requireRole, requirePermission, requireSuperAdmin } from '../middleware/auth.js';
import { previewZakat, confirmZakat, updateZakatRecord, deleteZakatRecord, markZakatPaid, listZakatRecords } from '../controllers/zakatController.js';

const router = Router();
// Zakat is the Super Admin's only.
router.use(requireAuth);
router.use(requireSuperAdmin);
router.use(requirePermission('zakat'));

router.get('/preview', previewZakat);
router.get('/', listZakatRecords);
router.post('/', requireRole('admin', 'manager'), confirmZakat);
router.put('/:id', requireRole('admin', 'manager'), updateZakatRecord);
router.delete('/:id', requireRole('admin', 'manager'), deleteZakatRecord);
router.post('/:id/mark-paid', requireRole('admin', 'manager'), markZakatPaid);

export default router;
