import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  listInventory,
  searchInventory,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getAlertsSummary,
} from '../controllers/inventoryController.js';

const router = Router();
router.use(requireAuth);

// Shared lookup/create surface: Seller/POS (product search, editing a
// Draft's existing lines, "+ Add New Item") and Stock both depend on this
// regardless of whether the current user has the standalone Inventory
// module -- gating these would break product search at the register.
router.get('/search', searchInventory);
router.post('/', createInventoryItem);
router.get('/:id', getInventoryItem);

// The actual Inventory module: browsing, editing, deleting, alerts.
router.get('/alerts/summary', requirePermission('inventory'), getAlertsSummary);
router.get('/', requirePermission('inventory'), listInventory);
router.put('/:id', requirePermission('inventory'), updateInventoryItem);
router.delete('/:id', requirePermission('inventory'), deleteInventoryItem);

export default router;
