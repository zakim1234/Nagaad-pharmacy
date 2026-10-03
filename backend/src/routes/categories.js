import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listCategories, getCategory, createCategory, updateCategory, deleteCategory } from '../controllers/categoryController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('categories'));

router.get('/', listCategories);
router.post('/', createCategory);
router.get('/:id', getCategory);
router.put('/:id', updateCategory);
router.delete('/:id', deleteCategory);

export default router;
