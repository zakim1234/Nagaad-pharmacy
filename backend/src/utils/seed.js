import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Category from '../models/Category.js';
import Supplier from '../models/Supplier.js';
import InventoryItem from '../models/InventoryItem.js';
import { nextSequence } from '../models/Counter.js';
import { toCents } from './money.js';

async function nextItemCode() {
  const seq = await nextSequence('itemCode');
  return `ITM-${String(seq).padStart(6, '0')}`;
}

async function seed() {
  await connectDB();

  const existingAdmin = await User.findOne({ username: 'admin' });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await User.create({ username: 'admin', passwordHash, name: 'Administrator', role: 'admin' });
    console.log('[seed] created admin user -> username: admin, password: admin123');
  } else {
    console.log('[seed] admin user already exists, skipping');
  }

  const categoryNames = ['Analgesics', 'Antibiotics', 'Vitamins & Supplements', 'First Aid', 'Personal Care'];
  const categoryIdByName = {};
  for (const name of categoryNames) {
    const category = await Category.findOneAndUpdate({ name }, { name }, { upsert: true, new: true });
    categoryIdByName[name] = category._id;
  }

  let supplier = await Supplier.findOne({ name: 'ABC Pharma Distributors' });
  if (!supplier) {
    supplier = await Supplier.create({
      name: 'ABC Pharma Distributors',
      phone: '+252613966868',
      email: 'orders@abcpharma.example',
      address: 'Mogadishu - Somalia',
    });
    console.log('[seed] created sample supplier');
  }

  const sampleItems = [
    { name: 'Paracetamol 500mg (Strip of 10)', serialNumber: 'SN-PARA500-01', category: 'Analgesics', unit: 'strip', quantity: 200, costPrice: 0.4, sellingPrice: 0.8, lowStockThreshold: 30 },
    { name: 'Amoxicillin 500mg (Strip of 10)', serialNumber: 'SN-AMOX500-01', category: 'Antibiotics', unit: 'strip', quantity: 120, costPrice: 1.2, sellingPrice: 2.2, lowStockThreshold: 20 },
    { name: 'Vitamin C 1000mg (Bottle of 30)', serialNumber: 'SN-VITC1000-01', category: 'Vitamins & Supplements', unit: 'bottle', quantity: 60, costPrice: 2.5, sellingPrice: 4.5, lowStockThreshold: 15 },
    { name: 'Ibuprofen 400mg (Strip of 10)', serialNumber: 'SN-IBUP400-01', category: 'Analgesics', unit: 'strip', quantity: 90, costPrice: 0.6, sellingPrice: 1.1, lowStockThreshold: 20 },
    { name: 'Cough Syrup 100ml', serialNumber: 'SN-COUGH100-01', category: 'First Aid', unit: 'bottle', quantity: 4, costPrice: 1.5, sellingPrice: 2.8, lowStockThreshold: 10 },
  ];

  for (const it of sampleItems) {
    const exists = await InventoryItem.findOne({ serialNumber: it.serialNumber });
    if (!exists) {
      const { category, ...rest } = it;
      await InventoryItem.create({
        ...rest,
        itemCode: await nextItemCode(),
        category: categoryIdByName[category] || null,
        costPriceCents: toCents(it.costPrice),
        sellingPriceCents: toCents(it.sellingPrice),
        supplier: supplier._id,
      });
    }
  }
  console.log('[seed] sample inventory ensured');

  console.log('[seed] done.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
