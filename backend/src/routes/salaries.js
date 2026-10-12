import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getSalarySheet,
  saveSalarySheet,
  paySalarySheet,
  listSalarySheets,
  getSalarySheetById,
  cancelSalarySheet,
  getSalaryStatement,
} from '../controllers/salaryController.js';

// Salaries are admin/manager only.
const router = Router();
router.use(requireAuth);
router.use(requireRole('admin', 'manager'));

router.get('/sheet', getSalarySheet);
router.put('/sheet', saveSalarySheet);
router.post('/sheet/pay', paySalarySheet);
router.get('/sheets', listSalarySheets);
router.get('/statement', getSalaryStatement);
router.get('/sheets/:id', getSalarySheetById);
router.post('/sheets/:id/cancel', cancelSalarySheet);

export default router;
