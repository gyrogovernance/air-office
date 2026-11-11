import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { launchService, stopService } from '../../support/service-launch.adapter';

let processHandle: Subprocess;
let token: string;
let base: string;
const scratch = mkdtempSync(join(tmpdir(), 'air-capabilities-'));
const searchQueries: string[] = [];
const searchCategories: (string | null)[] = [];

// A SearxNG-shaped search endpoint, so the web-search tool runs against the documented contract.
const searchStub = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/search') return new Response('Not found', { status: 404 });
  searchQueries.push(url.searchParams.get('q') ?? '');
  searchCategories.push(url.searchParams.get('categories'));
  return Response.json({ results: [
    { title: 'AIR Office', url: 'https://example.com/air-office', content: 'The workspace under test.' },
    { title: 'Second hit', url: 'https://example.com/second', content: 'Another snippet.' }
  ] });
} });

// An OpenAI-compatible images endpoint behind the configured provider connection.
const imageStub = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== '/v1/images/generations') return new Response('Not found', { status: 404 });
  await request.json();
  return Response.json({ data: [{ url: 'https://img.test/generated.png' }] });
} });

const filesRoot = join(scratch, 'authorized-root');
mkdirSync(filesRoot, { recursive: true });
const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const baseEnv = (): Record<string, string> => ({
  OFFICE_RUNTIME_DIR: join(scratch, 'runtime'),
  OFFICE_CHAT_DATABASE_PATH: join(scratch, 'chat.sqlite'),
  OFFICE_FILES_ROOT: filesRoot,
  OFFICE_CREDENTIALS: 'environment',
  OFFICE_OPENAI_BASE_URL: `http://127.0.0.1:${imageStub.port}/v1`,
  OFFICE_OPENAI_MODELS: 'gpt-test',
  OFFICE_OPENAI_IMAGE_MODELS: 'dall-e-test',
  OFFICE_SEARCH_ENDPOINT: `http://127.0.0.1:${searchStub.port}/search`
});
const launch = async (extraEnv: Record<string, string> = {}) => {
  const launched = await launchService({ env: { ...baseEnv(), ...extraEnv } });
  processHandle = launched.processHandle;
  base = launched.base;
  token = launched.token;
};
const stop = async () => { await stopService(processHandle); };
beforeAll(async () => { await launch(); }, 30_000);
afterAll(async () => { await stop(); searchStub.stop(true); imageStub.stop(true); rmSync(scratch, { recursive: true, force: true }); }, 30_000);

const invoke = (id: string, input: unknown, confirmed?: boolean) => fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id, input, ...(confirmed === undefined ? {} : { confirmed }) }) });

test('the capability report is authenticated and names the configured engines', async () => {
  expect((await fetch(`${base}/api/v1/capabilities`)).status).toBe(401);
  const report = await (await fetch(`${base}/api/v1/capabilities`, { headers: headers() })).json() as {
    webSearch: { configured: boolean; provider: string | null; endpoint: string | null };
    codeInterpreter: { languages: string[] };
    memory: { enabled: boolean };
    providers: { id: string; imageGeneration: boolean }[];
  };
  expect(report.webSearch).toMatchObject({ configured: true, provider: 'searxng', endpoint: `http://127.0.0.1:${searchStub.port}/search` });
  expect(report.codeInterpreter).toEqual({ languages: ['javascript'] });
  expect(report.memory).toEqual({ enabled: true });
  expect(report.providers).toContainEqual({ id: 'local-replay', imageGeneration: true });
  expect(report.providers).toContainEqual({ id: 'openai', imageGeneration: true });
});

test('web research runs through the product search routes and refuses malformed input first', async () => {
  const queried = await fetch(`${base}/api/v1/web-search/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ query: 'air office workspace', limit: 5, category: 'news' }) });
  expect(queried.status).toBe(200);
  const outcome = await queried.json() as { provider: string; results: { title: string; url: string; snippet: string }[] };
  expect(outcome.provider).toBe('searxng');
  expect(outcome.results.map((result) => result.url)).toEqual(['https://example.com/air-office', 'https://example.com/second']);
  expect(searchQueries.at(-1)).toBe('air office workspace');
  expect(searchCategories.at(-1)).toBe('news');
  const invalid = await fetch(`${base}/api/v1/web-search/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ limit: 5 }) });
  expect(invalid.status).toBe(400);
});

test('image generation serves provider data and the offline replay image', async () => {
  const generated = await fetch(`${base}/api/v1/images`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'a lighthouse in fog' }) });
  expect(generated.status).toBe(200);
  const result = await generated.json() as { provider: string; images: { url?: string; data?: string; mimeType?: string }[] };
  expect(result.provider).toBe('openai');
  expect(result.images).toEqual([{ url: 'https://img.test/generated.png' }]);

  const replay = await fetch(`${base}/api/v1/images`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'a lighthouse', provider: 'local-replay' }) });
  expect(replay.status).toBe(200);
  const replayResult = await replay.json() as { provider: string; images: { data?: string; mimeType?: string }[] };
  expect(replayResult.provider).toBe('local-replay');
  expect(replayResult.images[0]?.mimeType).toBe('image/svg+xml');
  expect(replayResult.images[0]?.data?.startsWith('data:image/svg+xml')).toBe(true);

  expect((await fetch(`${base}/api/v1/images`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: 'x', provider: 'missing' }) })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/images`, { method: 'POST', headers: headers(), body: JSON.stringify({ prompt: '   ' }) })).status).toBe(400);
  expect((await fetch(`${base}/api/v1/images`, { method: 'POST', body: JSON.stringify({ prompt: 'x' }) })).status).toBe(401);
});

test('memory stores facts, gates on its switch, and clears only after confirmation', async () => {
  expect((await fetch(`${base}/api/v1/memories`)).status).toBe(401);
  const stored = await fetch(`${base}/api/v1/memories`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 'Prefers concise answers', conversationId: 'conversation-1' }) });
  expect(stored.status).toBe(201);
  const memory = (await stored.json() as { memory: { id: string; content: string; conversationId: string | null } }).memory;
  expect(memory.conversationId).toBe('conversation-1');
  expect((await fetch(`${base}/api/v1/memories?q=concise`, { headers: headers() })).json()).resolves.toMatchObject({ enabled: true, memories: [{ id: memory.id }] });
  expect(await (await fetch(`${base}/api/v1/memories?q=nothing-matches`, { headers: headers() })).json()).toMatchObject({ memories: [] });
  expect((await fetch(`${base}/api/v1/memories`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: ' ' }) })).status).toBe(400);

  expect((await fetch(`${base}/api/v1/memory`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: false }) })).json()).resolves.toEqual({ enabled: false });
  const refused = await fetch(`${base}/api/v1/memories`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 'Stored while disabled' }) });
  expect(refused.status).toBe(409);
  expect((await refused.json() as { error: string }).error).toContain('Memory is turned off');
  // The management listing keeps showing stored facts while the switch is off.
  expect(await (await fetch(`${base}/api/v1/memories`, { headers: headers() })).json()).toMatchObject({ memories: expect.arrayContaining([expect.objectContaining({ id: memory.id })]) });
  expect(await (await fetch(`${base}/api/v1/memory`, { headers: headers() })).json()).toEqual({ enabled: false });
  expect((await fetch(`${base}/api/v1/memory`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: true }) })).status).toBe(200);

  const patched = await fetch(`${base}/api/v1/memories/${encodeURIComponent(memory.id)}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ content: 'Concise answers, updated' }) });
  expect(patched.status).toBe(200);
  expect((await patched.json() as { memory: { content: string } }).memory.content).toBe('Concise answers, updated');
  expect((await fetch(`${base}/api/v1/memories/missing`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ content: 'x' }) })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/memories/${encodeURIComponent(memory.id)}`, { method: 'DELETE', headers: headers() })).status).toBe(204);
  expect((await fetch(`${base}/api/v1/memories/${encodeURIComponent(memory.id)}`, { method: 'DELETE', headers: headers() })).status).toBe(404);

  await fetch(`${base}/api/v1/memories`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 'First spare fact' }) });
  await fetch(`${base}/api/v1/memories`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 'Second spare fact' }) });
  expect((await fetch(`${base}/api/v1/memories`, { method: 'DELETE', headers: headers(), body: JSON.stringify({}) })).status).toBe(409);
  const cleared = await fetch(`${base}/api/v1/memories`, { method: 'DELETE', headers: headers(), body: JSON.stringify({ confirmed: true }) });
  expect((await cleared.json() as { cleared: number }).cleared).toBe(2);
  expect(await (await fetch(`${base}/api/v1/memories`, { headers: headers() })).json()).toMatchObject({ memories: [] });
});

test('the memory tools confirm their write and recall stored facts', async () => {
  const unconfirmed = await invoke('builtin:memory-remember', { content: 'Works from the AIR Office workspace' });
  expect(unconfirmed.status).toBe(409);
  expect((await unconfirmed.json() as { error: string }).error).toContain('confirmation');
  const confirmed = (await (await invoke('builtin:memory-remember', { content: 'Works from the AIR Office workspace' }, true)).json() as { invocation: { status: string; result: { memory: { content: string } } } }).invocation;
  expect(confirmed.status).toBe('succeeded');
  expect(confirmed.result.memory.content).toBe('Works from the AIR Office workspace');
  const recalled = (await (await invoke('builtin:memory-search', { query: 'AIR Office', limit: 10 })).json() as { invocation: { status: string; result: { enabled: boolean; memories: { content: string }[] } } }).invocation;
  expect(recalled.status).toBe('succeeded');
  expect(recalled.result.enabled).toBe(true);
  expect(recalled.result.memories.map((fact) => fact.content)).toContain('Works from the AIR Office workspace');
});

test('the code interpreter runs snippets only after its tool is enabled', async () => {
  expect((await invoke('builtin:run-code', { code: 'console.log(1)' })).status).toBe(404);
  const enabled = await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'builtin:run-code', enabled: true }) });
  expect(enabled.status).toBe(200);
  const unconfirmed = await invoke('builtin:run-code', { code: 'console.log(1)' });
  expect(unconfirmed.status).toBe(409);
  expect((await unconfirmed.json() as { error: string }).error).toContain('confirmation');
  const run = (await (await invoke('builtin:run-code', { code: `console.log('local run ' + 6 * 7)` }, true)).json() as { invocation: { status: string; result: { stdout: string; status: string; truncated: boolean } } }).invocation;
  expect(run.status).toBe('succeeded');
  expect(run.result.status).toBe('succeeded');
  expect(run.result.stdout.trim()).toBe('local run 42');
  expect(run.result.truncated).toBe(false);
  const wrongLanguage = (await (await invoke('builtin:run-code', { code: 'print(1)', language: 'python' }, true)).json() as { invocation: { status: string; error: string } }).invocation;
  expect(wrongLanguage.status).toBe('failed');
  expect(wrongLanguage.error).toContain('JavaScript snippets only');
});

test('clearing the search endpoint restores the free default and disabling search remains explicit', async () => {
  // The endpoint is a stored setting, so it is cleared through the setting
  // rather than through the environment variable that only seeds it once.
  await fetch(`${base}/api/v1/web-search`, { method: 'PUT', headers: headers(), body: JSON.stringify({ endpoint: null }) });
  await stop();
  await launch({ OFFICE_SEARCH_ENDPOINT: '' });
  const report = await (await fetch(`${base}/api/v1/capabilities`, { headers: headers() })).json() as { webSearch: { configured: boolean; provider: string | null; endpoint: string | null } };
  expect(report.webSearch).toMatchObject({ configured: true, provider: 'ddgs', endpoint: null });
  await fetch(`${base}/api/v1/web-search`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: false }) });
  const gap = await fetch(`${base}/api/v1/web-search/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ query: 'air office' }) });
  expect(gap.status).toBe(503);
  expect((await gap.json() as { error: string }).error).toContain('Web search is switched off');
  expect(searchQueries.length).toBe(1);
}, 30_000);
