import { Router } from 'express';
import { login, me, register } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';

const router = Router();

router.post('/login', login);
router.post('/register', optionalAuth, register);
router.get('/me', requireAuth, me);

export default router;
