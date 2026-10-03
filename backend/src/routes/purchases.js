import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import {
  createPurchase,
  listPurchases,
  getPurchase,
  voidPurchase,
  addPurchasePayment,
  listPurchasePayments,
  reversePurchasePayment,
} from '../controllers/purchaseController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('purchases'));

router.get('/', listPurchases);
router.post('/', createPurchase);
router.get('/:id', getPurchase);
router.post('/:id/void', requireRole('admin', 'manager'), voidPurchase);
router.get('/:id/payments', listPurchasePayments);
router.post('/:id/payments', addPurchasePayment);
router.post('/:id/payments/:paymentId/reverse', requireRole('admin', 'manager'), reversePurchasePayment);

export default router;
