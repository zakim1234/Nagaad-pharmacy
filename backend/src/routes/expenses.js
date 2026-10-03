import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { createExpense, listExpenses, voidExpense, getExpenseCategories, createExpenseCategory } from '../controllers/expenseController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('expenses'));

router.get('/', listExpenses);
router.get('/categories', getExpenseCategories);
router.post('/categories', requireRole('admin', 'manager'), createExpenseCategory);
router.post('/', createExpense);
router.post('/:id/void', requireRole('admin', 'manager'), voidExpense);

export default router;
