import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { listBranches, createBranch, updateBranch } from '../controllers/branchController.js';
import { getSuperDashboard } from '../controllers/superDashboardController.js';

const router = Router();
router.use(requireAuth);

router.get('/', listBranches);
router.get('/dashboard', requireSuperAdmin, getSuperDashboard);
router.post('/', requireSuperAdmin, createBranch);
router.put('/:id', requireSuperAdmin, updateBranch);

export default router;
