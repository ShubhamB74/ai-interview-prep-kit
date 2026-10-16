import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { evaluateCases } from '../src/cli/evaluateCore.js';

const okKit = (days) => ({
  source: { company: 'A', company_url: 'u', role: 'r', location: '', jd_chars: 1, researched_at: 't', pages_used: [] },
  company_brief: { summary: '', what_they_do: '', sources: [] }, role: { title: '', seniority: '', responsibilities: [], requirements: [] },
  questions: [], flashcards: [], schedule: { days_available: days, days: Array.from({ length: days }, (_, i) => ({ day: i + 1, focus: 'f', question_ids: [], minutes: 0 })) },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});

test('evaluateCases: one entry per input case in order; a failing case does not stop the run', async () => {
  const seen = [];
  const pipeline = async ({ jd, days }) => {
    seen.push([jd, days]);
    if (jd === 'boom') throw Object.assign(new Error('LLM exploded'), { code: 'LLM_UNAVAILABLE' });
    if (jd === 'weird') throw new Error('no code');
    return okKit(days);
  };
  const out = await evaluateCases([
    { id: 'a', jd: 'one', company_url: 'http://x', days: 5 },
    { id: 'b', jd: 'boom', company_url: 'http://x', days: 3 },
    { id: 'c', jd: 'weird', company_url: 'http://x', days: 1 },
    { id: 'd', jd: 'two', company_url: 'http://x', days: 60 },
  ], { pipeline });
  assert.deepEqual(out.map((e) => [e.id, e.status]), [['a', 'ok'], ['b', 'failed'], ['c', 'failed'], ['d', 'ok']]);
  assert.deepEqual(out[1].error, { code: 'LLM_UNAVAILABLE', message: 'LLM exploded' });
  assert.equal(out[2].error.code, 'UNEXPECTED');
  assert.equal(out[1].kit, null);
  assert.equal(out[0].error, null);
  assert.deepEqual(seen.map((s) => s[1]), [5, 3, 1, 60], 'the days value of each case is used');
});

test('evaluateCases: malformed cases and kits that fail validation are recorded, not thrown', async () => {
  const out = await evaluateCases([
    { id: 'x', jd: 'ok', company_url: 'http://x', days: 0 },
    { jd: 'no id', company_url: 'u', days: 2 },
    { id: 'y', jd: 'ok', company_url: 'http://x', days: 2 },
  ], { pipeline: async () => ({ not: 'a kit' }) });
  assert.deepEqual(out.map((e) => e.error.code), ['INVALID_CASE', 'INVALID_CASE', 'INVALID_KIT']);
  assert.equal(out[1].id, 'unknown');
});

test('CLI from a clean environment: runs, writes the Appendix B shape, records every case as failed (no API key)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evaluate-'));
  const input = path.join(dir, 'cases.json');
  await fs.writeFile(input, JSON.stringify([
    { id: 'case-01', jd: 'Senior Backend Engineer\n\nRequired: Node.js', company_url: 'http://127.0.0.1:1/acme/', days: 5 },
    { id: 'case-02', jd: 'Stub.', company_url: 'not a url', days: 1 },
  ]));
  const root = path.resolve(import.meta.dirname, '../..');
  const env = { ...process.env, LLM_API_KEY: '', INIT_CWD: dir };
  await promisify(execFile)('node', ['server/src/cli/evaluate.js', '--input', 'cases.json', '--output', 'kits.json'], { cwd: root, env });
  const out = JSON.parse(await fs.readFile(path.join(dir, 'kits.json'), 'utf8'));
  assert.equal(out.version, '1.0');
  assert.ok(!Number.isNaN(Date.parse(out.generated_at)));
  assert.deepEqual(out.kits.map((k) => k.id), ['case-01', 'case-02']);
  for (const k of out.kits) {
    assert.deepEqual(Object.keys(k).sort(), ['error', 'id', 'kit', 'status']);
    assert.equal(k.status, 'failed');
    assert.equal(k.kit, null);
    assert.equal(k.error.code, 'LLM_NOT_CONFIGURED');
  }
});

test('CLI without arguments exits with usage (code 2)', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  await assert.rejects(promisify(execFile)('node', ['server/src/cli/evaluate.js'], { cwd: root }), (e) => e.code === 2 && /Usage/.test(e.stderr));
});
