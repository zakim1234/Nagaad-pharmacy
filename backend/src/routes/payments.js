import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listPayments, getPaymentReceipt } from '../controllers/paymentController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listPayments);
router.get('/:id/receipt', getPaymentReceipt);

export default router;
