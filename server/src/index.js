import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDb } from './models/db.js';
import { createMongoRepos } from './repos/mongo.js';

await connectDb(); // auth and kits need the database; fail fast if it's down
createApp({ repos: createMongoRepos() }).listen(env.port, () => console.log(`[server] http://localhost:${env.port}`));
