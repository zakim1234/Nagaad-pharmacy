import mongoose from 'mongoose';
await mongoose.connect('mongodb://127.0.0.1:27028/admin?directConnection=true');
try { await mongoose.connection.db.admin().command({ replSetInitiate: { _id: 'stocktest', members: [{ _id: 0, host: '127.0.0.1:27028' }] } }); } catch (e) { if (e.codeName !== 'AlreadyInitialized') throw e; }
await mongoose.disconnect();
