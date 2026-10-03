import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { listFixedAssets, createFixedAsset, updateFixedAsset, removeFixedAsset } from '../controllers/fixedAssetController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('fixedAssets'));

router.get('/', listFixedAssets);
router.post('/', requireRole('admin', 'manager'), createFixedAsset);
router.put('/:id', requireRole('admin', 'manager'), updateFixedAsset);
router.post('/:id/remove', requireRole('admin', 'manager'), removeFixedAsset);

export default router;
