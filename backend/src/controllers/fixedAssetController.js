import FixedAsset from '../models/FixedAsset.js';
import { logAudit } from '../services/auditService.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toCents, fromCents } from '../utils/money.js';

function toDTO(a) {
  return {
    id: a._id,
    name: a.name,
    value: fromCents(a.valueCents),
    dateAdded: a.dateAdded,
    notes: a.notes,
    isActive: a.isActive,
    createdAt: a.createdAt,
  };
}

function parseAssetDate(value) {
  if (!value) return new Date();
  const day = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError(400, 'Enter a valid date.');
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'Enter a valid date.');
  return date;
}

// GET /api/fixed-assets
export const listFixedAssets = asyncHandler(async (req, res) => {
  const assets = await FixedAsset.find({ isActive: true }).sort({ dateAdded: -1, createdAt: -1 });
  const totalCents = assets.reduce((sum, a) => sum + a.valueCents, 0);
  res.json({ success: true, data: { total: fromCents(totalCents), assets: assets.map(toDTO) } });
});

// POST /api/fixed-assets -- admin/manager only (enforced at the route)
export const createFixedAsset = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'Asset name is required.');
  const value = Number(req.body.value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(toCents(value))) throw new ApiError(400, 'Enter a valid value.');

  const asset = await FixedAsset.create({
    name,
    valueCents: toCents(value),
    dateAdded: parseAssetDate(req.body.dateAdded),
    notes: String(req.body.notes || '').trim(),
    createdBy: req.user?._id || null,
  });
  await logAudit({ user: req.user, action: 'fixedAsset.create', entityType: 'FixedAsset', entityId: asset._id, details: { name, value } });
  res.status(201).json({ success: true, data: toDTO(asset) });
});

// PUT /api/fixed-assets/:id -- admin/manager only
export const updateFixedAsset = asyncHandler(async (req, res) => {
  const asset = await FixedAsset.findById(req.params.id);
  if (!asset || !asset.isActive) throw new ApiError(404, 'Fixed asset not found.');

  const name = String(req.body.name || '').trim();
  if (!name) throw new ApiError(400, 'Asset name is required.');
  const value = Number(req.body.value);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(toCents(value))) throw new ApiError(400, 'Enter a valid value.');

  asset.name = name;
  asset.valueCents = toCents(value);
  if (req.body.dateAdded !== undefined) asset.dateAdded = parseAssetDate(req.body.dateAdded);
  if (req.body.notes !== undefined) asset.notes = String(req.body.notes || '').trim();
  await asset.save();

  await logAudit({ user: req.user, action: 'fixedAsset.update', entityType: 'FixedAsset', entityId: asset._id, details: { name, value } });
  res.json({ success: true, data: toDTO(asset) });
});

// POST /api/fixed-assets/:id/remove -- admin/manager only. Kept (not
// deleted) so the Balance Sheet stays reconstructable for any past date;
// simply excluded from the current total once removed.
export const removeFixedAsset = asyncHandler(async (req, res) => {
  const asset = await FixedAsset.findById(req.params.id);
  if (!asset) throw new ApiError(404, 'Fixed asset not found.');
  if (!asset.isActive) throw new ApiError(409, 'This asset has already been removed.');
  asset.isActive = false;
  asset.removedAt = new Date();
  asset.removedReason = String(req.body.reason || '').trim();
  await asset.save();
  await logAudit({ user: req.user, action: 'fixedAsset.remove', entityType: 'FixedAsset', entityId: asset._id, details: { name: asset.name } });
  res.json({ success: true, data: toDTO(asset) });
});
