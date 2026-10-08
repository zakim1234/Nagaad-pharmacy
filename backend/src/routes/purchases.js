import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import {
  createPurchase,
  listPurchases,
  getPurchase,
  voidPurchase,
  updatePurchase,
  deletePurchase,
  addPurchasePayment,
  listPurchasePayments,
  reversePurchasePayment,
} from '../controllers/purchaseController.js';
import {
  listOwedSuppliers,
  listSupplierOutstanding,
  createBulkPayment,
  getBulkPayment,
  updatePurchasePayment,
} from '../controllers/purchasePaymentController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('purchases'));

router.get('/', listPurchases);
// Bulk payments -- before '/:id' so 'bulk-payments' is never read as an id.
router.get('/bulk-payments/suppliers', listOwedSuppliers);
router.get('/bulk-payments/outstanding', listSupplierOutstanding);
router.post('/bulk-payments', createBulkPayment);
router.get('/bulk-payments/:bulkId', getBulkPayment);
router.post('/', createPurchase);
router.get('/:id', getPurchase);
router.put('/:id', requireRole('admin', 'manager'), updatePurchase);
router.delete('/:id', requireRole('admin', 'manager'), deletePurchase);
router.post('/:id/void', requireRole('admin', 'manager'), voidPurchase);
router.get('/:id/payments', listPurchasePayments);
router.post('/:id/payments', addPurchasePayment);
router.put('/:id/payments/:paymentId', requireRole('admin', 'manager'), updatePurchasePayment);
router.post('/:id/payments/:paymentId/reverse', requireRole('admin', 'manager'), reversePurchasePayment);

export default router;
