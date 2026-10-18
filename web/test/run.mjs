// Bundles each *.test.jsx with esbuild (JSX + the shared workspace package) and runs it in Node with a jsdom preload.
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(path.join(tmpdir(), 'web-tests-'));
let failed = false;

for (const file of readdirSync(here).filter((f) => f.endsWith('.test.jsx'))) {
  const outfile = path.join(out, `${file}.cjs`);
  await build({ entryPoints: [path.join(here, file)], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile, external: ['jsdom'], logLevel: 'error' });
  console.log(`\n# ${file}`);
  try {
    const { stdout } = await promisify(execFile)('node', ['-r', path.join(here, 'setup-dom.cjs'), outfile], { timeout: 60_000 });
    process.stdout.write(stdout);
  } catch (err) {
    failed = true;
    process.stdout.write(err.stdout ?? '');
    process.stderr.write(err.stderr ?? String(err));
  }
}
process.exit(failed ? 1 : 0);
