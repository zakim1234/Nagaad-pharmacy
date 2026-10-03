import mongoose from 'mongoose';

// Used to generate gap-free, human-readable sequential numbers
// (receipt numbers, purchase numbers) via atomic findOneAndUpdate increments.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

export async function nextSequence(name, session = null) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return doc.seq;
}

export default Counter;
