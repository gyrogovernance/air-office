import { expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDdgsSearchProvider } from '../../../packages/providers/src/ddgs-search.adapter';

const fixtureRoot = join(import.meta.dir, '.tmp-ddgs');
mkdirSync(fixtureRoot, { recursive: true });

function writeWorker(name: string, source: string): string {
  const path = join(fixtureRoot, name);
  writeFileSync(path, source);
  return path;
}

test('built-in search retries a transient miss', async () => {
  const counter = join(fixtureRoot, `retry-count-${Date.now()}.txt`);
  writeFileSync(counter, '0');
  const script = writeWorker('retry-worker.mjs', `
import { readFileSync, writeFileSync } from 'node:fs';
const counter = ${JSON.stringify(counter)};
process.stdin.resume();
process.stdin.on('end', () => {
  const hits = Number(readFileSync(counter, 'utf8') || '0') + 1;
  writeFileSync(counter, String(hits));
  if (hits === 1) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'Web search could not complete. Try again shortly.' }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    ok: true,
    results: [{ title: 'Cake', url: 'https://example.com/cake', snippet: 'A white cake.' }]
  }));
});
`);
  const provider = createDdgsSearchProvider({ command: [process.execPath, script], timeoutMs: 10_000 });
  const result = await provider.search('white cake');
  expect(result.results).toEqual([{ title: 'Cake', url: 'https://example.com/cake', snippet: 'A white cake.' }]);
});

test('built-in search keeps concurrent callers in one lane', async () => {
  const script = writeWorker('lane-worker.mjs', `
process.stdin.resume();
process.stdin.on('end', async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  process.stdout.write(JSON.stringify({
    ok: true,
    results: [{ title: 'One', url: 'https://example.com/one', snippet: 'ok' }]
  }));
});
`);
  const provider = createDdgsSearchProvider({ command: [process.execPath, script], timeoutMs: 10_000, maxConcurrentRequests: 1 });
  const started = Date.now();
  const [first, second] = await Promise.all([provider.search('one'), provider.search('two')]);
  expect(first.results[0]?.snippet).toBe('ok');
  expect(second.results[0]?.snippet).toBe('ok');
  expect(Date.now() - started).toBeGreaterThanOrEqual(280);
});
