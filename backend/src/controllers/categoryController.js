import Category from '../models/Category.js';
import InventoryItem from '../models/InventoryItem.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function toDTO(c, itemCount) {
  return {
    id: c._id,
    name: c.name,
    itemCount,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// GET /api/categories?search=&withCounts=1
export const listCategories = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const filter = {};
  if (search && search.trim()) {
    filter.name = { $regex: search.trim(), $options: 'i' };
  }

  const categories = await Category.find(filter).sort({ name: 1 });
  const counts = await InventoryItem.aggregate([
    { $match: { category: { $ne: null } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  const countByCategory = new Map(counts.map((c) => [String(c._id), c.count]));

  res.json({
    success: true,
    data: categories.map((c) => toDTO(c, countByCategory.get(String(c._id)) || 0)),
  });
});

export const getCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found.');
  const itemCount = await InventoryItem.countDocuments({ category: category._id });
  res.json({ success: true, data: toDTO(category, itemCount) });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required.');

  const existing = await Category.findOne({ name: { $regex: `^${name.trim()}$`, $options: 'i' } });
  if (existing) throw new ApiError(409, 'A category with this name already exists.');

  const category = await Category.create({ name: name.trim() });
  res.status(201).json({ success: true, data: toDTO(category, 0) });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found.');

  const { name } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required.');

  const existing = await Category.findOne({
    _id: { $ne: category._id },
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
  });
  if (existing) throw new ApiError(409, 'A category with this name already exists.');

  category.name = name.trim();
  await category.save();

  const itemCount = await InventoryItem.countDocuments({ category: category._id });
  res.json({ success: true, data: toDTO(category, itemCount) });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new ApiError(404, 'Category not found.');

  const itemCount = await InventoryItem.countDocuments({ category: category._id });
  if (itemCount > 0) {
    throw new ApiError(409, 'This category is used by existing inventory items and cannot be deleted.');
  }

  await category.deleteOne();
  res.json({ success: true, data: { id: req.params.id } });
});
