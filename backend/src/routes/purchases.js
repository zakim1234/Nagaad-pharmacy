import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import {
  createPurchase,
  listPurchases,
  listSupplierSummary,
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
  cancelBulk,
  updatePurchasePayment,
} from '../controllers/purchasePaymentController.js';
import { getSupplierStatement } from '../controllers/supplierStatementController.js';
import { getPaymentPlan, savePaymentPlan, payPaymentPlan, listPaymentPlans, getPaymentPlanById, cancelPaymentPlan } from '../controllers/vendorPaymentPlanController.js';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('purchases'));

router.get('/', listPurchases);
router.get('/suppliers-summary', listSupplierSummary);
router.get('/suppliers/:supplierId/statement', getSupplierStatement);
// Bulk payments -- before '/:id' so 'bulk-payments' is never read as an id.
router.get('/bulk-payments/suppliers', listOwedSuppliers);
router.get('/bulk-payments/outstanding', listSupplierOutstanding);
router.post('/bulk-payments', createBulkPayment);
router.get('/bulk-payments/:bulkId', getBulkPayment);
router.post('/bulk-payments/:bulkId/cancel', requireRole('admin', 'manager'), cancelBulk);
// Vendor Balance Summary / payment plan.
router.get('/payment-plan', getPaymentPlan);
router.put('/payment-plan', savePaymentPlan);
router.post('/payment-plan/pay', requireRole('admin', 'manager'), payPaymentPlan);
router.get('/payment-plans', listPaymentPlans);
router.get('/payment-plans/:planId', getPaymentPlanById);
router.post('/payment-plans/:planId/cancel', requireRole('admin', 'manager'), cancelPaymentPlan);
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
