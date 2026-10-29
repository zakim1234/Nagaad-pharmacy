import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// Someone who works here and is paid a salary but does not use the system
// (a porter, a cleaner, a guard...). They appear on the salary sheet with the
// users.
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    job: { type: String, default: '', trim: true, maxlength: 60 }, // e.g. Porter / Xamaal
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

schema.index({ active: 1, name: 1 });
schema.plugin(branchScoped);

export default mongoose.model('Worker', schema);
