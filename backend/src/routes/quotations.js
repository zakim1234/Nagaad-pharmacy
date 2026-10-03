import { Router } from 'express';
import { requireAuth, requireRole, requirePermission } from '../middleware/auth.js';
import { listQuotations, getQuotation, createQuotation, updateQuotation, setQuotationStatus, deleteQuotation, convertQuotation } from '../controllers/quotationController.js';
const router = Router();
router.use(requireAuth);
// Reading one quotation and converting it are also reachable from
// Seller/POS ("Convert Quotation to Invoice") -- carved out of the
// 'quotations' gate so a cashier with only the POS module can still
// complete a conversion the Quotations team already marked Accepted.
router.get('/:id', getQuotation);
router.post('/:id/convert', convertQuotation);

router.get('/', requirePermission('quotations'), listQuotations);
router.post('/', requirePermission('quotations'), createQuotation);
router.put('/:id', requirePermission('quotations'), updateQuotation);
router.patch('/:id/status', requirePermission('quotations'), setQuotationStatus);
router.delete('/:id', requirePermission('quotations'), requireRole('admin', 'manager'), deleteQuotation);
export default router;
