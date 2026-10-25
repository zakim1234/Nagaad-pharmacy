import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

// Sets a new password for an existing user (default: admin) and makes sure the
// account is active. For when the password is forgotten:
//   RESET_PASSWORD='new-password' npm run reset:admin
//   RESET_USERNAME=cali RESET_PASSWORD='new-password' npm run reset:admin
const MIN_PASSWORD_LENGTH = 8;

async function resetPassword() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required (backend/.env).');
  const password = process.env.RESET_PASSWORD || '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`RESET_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const username = (process.env.RESET_USERNAME || 'admin').trim().toLowerCase();

  await connectDB();
  const user = await User.findOne({ username });
  if (!user) {
    const names = (await User.find({}, { username: 1 }).lean()).map((u) => u.username);
    throw new Error(`No user called "${username}". Users: ${names.join(', ') || 'none'}`);
  }
  user.passwordHash = await bcrypt.hash(password, 10);
  user.active = true;
  await user.save();
  console.log(`Password changed for "${username}". You can sign in now.`);
}

resetPassword()
  .catch((error) => {
    console.error('Password reset failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
