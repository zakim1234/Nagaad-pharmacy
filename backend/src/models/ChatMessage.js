import mongoose from 'mongoose';
import { branchScoped } from '../services/branchContext.js';

// A chat message between the people of one branch. Temporary on purpose:
// every message is deleted at Close Day (see dayCloseService), so nothing
// said in the chat is kept past the business day.
const schema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromName: { type: String, default: '' },
    // null: the branch group chat ("Everyone"); otherwise one person.
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    readBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    // A Super Admin message to every branch: one copy per branch (so each
    // branch's Close Day deletes its own), all sharing this id.
    broadcastId: { type: String, default: '' },
  },
  { timestamps: true }
);

schema.index({ to: 1, createdAt: 1 });
schema.index({ from: 1, to: 1, createdAt: 1 });
schema.plugin(branchScoped);

export default mongoose.model('ChatMessage', schema);
