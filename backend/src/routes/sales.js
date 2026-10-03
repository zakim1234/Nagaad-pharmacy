import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import {
  createSale,
  updateSale,
  cancelSale,
  listTodayDrafts,
  listSales,
  getSale,
  getReceipt,
  reverseSale,
  returnSale,
} from '../controllers/saleController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('pos'));

router.get('/drafts/today', listTodayDrafts);
router.get('/', listSales);
router.post('/', createSale);
router.get('/:id', getSale);
router.get('/:id/receipt', getReceipt);
router.put('/:id', updateSale);
router.post('/:id/cancel', cancelSale);
router.post('/:id/reverse', requireRole('admin', 'manager'), reverseSale);
router.post('/:id/return', requireRole('admin', 'manager'), returnSale);

export default router;
