import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pos_inventory';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`[db] connected -> ${uri}`);

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });
}

export default mongoose;
