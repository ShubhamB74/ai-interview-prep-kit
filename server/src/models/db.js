import mongoose from 'mongoose';
import { env } from '../config/env.js';

export async function connectDb() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 3000 });
  console.log('[db] connected');
}
// PHASE 1: User, Kit (kit JSON + status + input hash for dedupe), PracticeProgress (Phase 7)
