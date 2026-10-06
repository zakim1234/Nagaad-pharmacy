import { Router } from 'express';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { createArchive, searchArchives, getArchive, updateArchive, deleteArchive } from '../controllers/supplierInvoiceArchiveController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('supplierInvoices'));
router.post('/', createArchive);
router.get('/', searchArchives);
router.get('/:id', getArchive);
// Corrections and removals are admin/manager only, like other edits/deletes.
router.put('/:id', requireRole('admin', 'manager'), updateArchive);
router.delete('/:id', requireRole('admin', 'manager'), deleteArchive);

export default router;
