import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './models/db.js';

try {
  await connectDb();
} catch (err) {
  // Phase 0: allow the API to boot without Mongo so we can iterate on the pipeline.
  console.warn('[db] not connected:', err.message);
}
createApp().listen(env.port, () => console.log(`[server] http://localhost:${env.port}`));
