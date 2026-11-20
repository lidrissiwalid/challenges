import mongoose from 'mongoose';

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });

  console.log('[db] Connected to MongoDB');
}
