import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { quickCreateItem, listQuickCategories } from '../controllers/quickItemController.js';

const router = Router();
router.use(requireAuth);
// Admin always passes requirePermission; everyone else needs "Can create items".
router.use(requirePermission('createItems'));

router.get('/categories', listQuickCategories);
router.post('/', quickCreateItem);

export default router;
