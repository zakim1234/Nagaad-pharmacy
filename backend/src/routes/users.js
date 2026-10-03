import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, setUserActive, listPermissionModules } from '../controllers/userController.js';

const router = Router();
router.use(requireAuth);
// Users administration is admin-only -- never grantable as a module
// permission to any other role.
router.use(requireRole('admin'));

router.get('/', listUsers);
router.get('/permission-modules', listPermissionModules);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/active', setUserActive);

export default router;
