import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

const WEAK_PASSWORDS = new Set(['admin', '123456', 'password', 'admin123', 'changeme', 'letmein']);
const MIN_PASSWORD_LENGTH = 12;

function validateEnv() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required to run the admin seed script.');
  }
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD is required. Set it in the environment before running this script.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('SEED_ADMIN_PASSWORD is too common/weak. Choose a strong, unique password.');
  }
}

async function seedAdmin() {
  validateEnv();

  const username = (process.env.SEED_ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const name = process.env.SEED_ADMIN_NAME || 'System Administrator';

  await connectDB();

  const existingAdmin = await User.findOne({ username });
  if (existingAdmin) {
    console.log('Admin already exists. No new admin created.');
    return;
  }

  // User.passwordHash is stored pre-hashed by every code path that creates a
  // user (see authController.register) -- the User model has no pre('save')
  // hook of its own, so this script must hash here too, exactly once.
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 10);

  await User.create({
    username,
    passwordHash,
    name,
    role: 'admin',
    active: true,
  });

  console.log(`Admin created successfully. (username: ${username})`);
}

seedAdmin()
  .catch((error) => {
    console.error('Admin seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
