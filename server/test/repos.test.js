import { test } from 'node:test';
import { createMemoryRepos } from '../src/repos/memory.js';
import { kitRepoContract } from '../test-support/repoContract.js';

for (const [name, fn] of kitRepoContract) test(`[memory] ${name}`, () => fn(createMemoryRepos()));

// The SAME contract against a real MongoDB. Skipped unless you point it at a scratch database:
//   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/prepkit_test npm test
// (The database is DROPPED before every case: never use a database you care about.)
const uri = process.env.TEST_MONGODB_URI;
if (!uri) {
  test('[mongo] repo contract', { skip: 'set TEST_MONGODB_URI to run it against a real MongoDB' }, () => {});
} else {
  const { default: mongoose } = await import('mongoose');
  const { createMongoRepos } = await import('../src/repos/mongo.js');
  const { UserModel } = await import('../src/models/User.js');
  const { KitModel } = await import('../src/models/Kit.js');
  await mongoose.connect(uri);
  for (const [name, fn] of kitRepoContract) {
    test(`[mongo] ${name}`, async () => {
      await mongoose.connection.dropDatabase();
      await Promise.all([UserModel.init(), KitModel.init()]); // build unique indexes before use
      await fn(createMongoRepos());
    });
  }
  test('[mongo] disconnect', async () => { await mongoose.disconnect(); });
}
