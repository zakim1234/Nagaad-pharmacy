import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  listSuppliers,
  searchSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierHistory,
  getSupplierAnalysis,
} from '../controllers/supplierController.js';

const router = Router();
router.use(requireAuth);

// Shared lookup/create surface: needed by Purchase Invoices and the
// Supplier Invoice archive to pick or create a supplier regardless of
// whether the current user has the standalone Suppliers module.
router.get('/search', searchSuppliers);
router.post('/', createSupplier);
router.get('/:id', getSupplier);

// The actual Suppliers module.
router.get('/', requirePermission('suppliers'), listSuppliers);
router.put('/:id', requirePermission('suppliers'), updateSupplier);
router.delete('/:id', requirePermission('suppliers'), deleteSupplier);
router.get('/:id/history', requirePermission('suppliers'), getSupplierHistory);
router.get('/:id/analysis', requirePermission('suppliers'), getSupplierAnalysis);

export default router;
