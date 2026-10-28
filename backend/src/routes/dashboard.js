import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getDashboard } from '../controllers/dashboardController.js';

const router = Router();
router.use(requireAuth);
// The whole business is for the admin; everyone else's dashboard is My Report.
router.get('/', requireRole('admin'), getDashboard);

export default router;
