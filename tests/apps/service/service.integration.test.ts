import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationGraph } from '@office/chat/domain';
import { createRichDocument, markdownToNativeBody } from '@office/editor/rich-document-domain';
import type { Subprocess } from 'bun';
import { launchService, stopService } from '../../support/service-launch.adapter';

let processHandle: Subprocess;
let port: number;
let token: string;
let base: string;
const scratch = mkdtempSync(join(tmpdir(), 'air-chat-service-'));
let providerRequests: { messages: { role: string; content: string }[] }[] = [];
let lemonadeScenario: 'ready' | 'loading' | 'malformed' | 'oversized' | 'cancel' = 'ready';
let lemonadeAuthHeaders: string[] = [];
let lemonadeChatRequests: { model: string; messages: { role: string; content: string }[] }[] = [];
const lemonadeStub = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  lemonadeAuthHeaders.push(request.headers.get('authorization') ?? '');
  const path = new URL(request.url).pathname;
  if (path === '/v1/health') {
    if (lemonadeScenario === 'cancel') return new Promise<Response>(() => {});
    if (lemonadeScenario === 'malformed') return new Response('{', { headers: { 'content-type': 'application/json' } });
    if (lemonadeScenario === 'oversized') return new Response(' '.repeat(600_000), { headers: { 'content-type': 'application/json' } });
    return Response.json(lemonadeScenario === 'loading' ? { status: 'loading' } : { status: 'ready', ready: true }, { status: lemonadeScenario === 'loading' ? 503 : 200 });
  }
  if (path === '/v1/system-info') return Response.json({ platform: 'test' });
  if (path === '/v1/models') return Response.json({ object: 'list', data: [{ id: 'managed-chat', object: 'model', labels: ['chat'] }] });
  if (path === '/v1/embeddings') return Response.json({ object: 'list', model: 'test-embedding', data: ((await request.json()) as { input: string[] }).input.map((_, index) => ({ object: 'embedding', index, embedding: [1, 0] })) });
  if (path === '/v1/audio/generations' || path === '/v1/images/generations') return new Response('unsupported fixture', { status: 404 });
  if (path === '/v1/chat/completions') {
    lemonadeChatRequests.push(await request.json() as { model: string; messages: { role: string; content: string }[] });
    return new Response([`data: ${JSON.stringify({ choices: [{ delta: { content: 'managed response' } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'].join(''), { headers: { 'content-type': 'text/event-stream' } });
  }
  return new Response('Not found', { status: 404 });
} });
const providerStub = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  // OpenAI-compatible clients call /v1/chat/completions when the base URL has no /v1 suffix.
  if (path !== '/chat/completions' && path !== '/v1/chat/completions') return new Response('Not found', { status: 404 });
  const payload = await request.json() as { messages: { role: string; content: string }[] };
  providerRequests.push(payload);
  return new Response([`data: ${JSON.stringify({ choices: [{ delta: { content: 'captured' } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'].join(''), { headers: { 'content-type': 'text/event-stream' } });
} });
// The authorized root lives outside the repository so no test ever writes into the working tree.
const filesRoot = join(scratch, 'authorized-root');
mkdirSync(filesRoot, { recursive: true });
writeFileSync(join(filesRoot, 'fixture.md'), 'fixture content', 'utf8');
const headers = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const launch = async (extraEnv: Record<string, string> = {}) => {
  const launched = await launchService({
    env: {
      OFFICE_RUNTIME_DIR: join(scratch, 'runtime'),
      OFFICE_CHAT_DATABASE_PATH: join(scratch, 'chat.sqlite'),
      OFFICE_DOCUMENTS_DATABASE_PATH: join(scratch, 'documents.sqlite'),
      OFFICE_KNOWLEDGE_DATABASE_PATH: join(scratch, 'knowledge.sqlite'),
      OFFICE_JOBS_DATABASE_PATH: join(scratch, 'jobs.sqlite'),
      OFFICE_FILES_ROOT: filesRoot,
      OFFICE_CREDENTIALS: 'environment',
      OFFICE_OPENAI_BASE_URL: `http://127.0.0.1:${providerStub.port}`,
      OFFICE_OPENAI_MODELS: 'gpt-test',
      OFFICE_LEMONADE_BASE_ORIGIN: `http://127.0.0.1:${lemonadeStub.port}`,
      OFFICE_LEMONADE_INSTANCE_ID: 'test-instance',
      OFFICE_LEMONADE_GENERATION: '7',
      OFFICE_LEMONADE_RELEASE: '2026.42.1',
      OFFICE_LEMONADE_TOKEN: 'runtime-secret-test',
      OFFICE_LEMONADE_EMBEDDING_MODEL: 'test-embedding',
      OFFICE_LEMONADE_EMBEDDING_DIMENSIONS: '2',
      ...extraEnv
    }
  });
  processHandle = launched.processHandle;
  port = launched.port;
  base = launched.base;
  token = launched.token;
};
const stop = async () => { await stopService(processHandle); };
beforeAll(launch, 30_000);
afterAll(async () => { await stop(); providerStub.stop(true); lemonadeStub.stop(true); rmSync(scratch, { recursive: true, force: true }); }, 30_000);

test('desktop bootstrap lets the native WebView load seeded methods through authenticated CORS', async () => {
  for (const origin of ['air-office://localhost']) {
    const preflight = await fetch(`${base}/api/v1/methods`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    const bootstrap = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin } });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get('access-control-allow-origin')).toBe(origin);
    expect(bootstrap.headers.get('cache-control')).toBe('no-store');
    const session: unknown = await bootstrap.json();
    if (!session || typeof session !== 'object' || !('token' in session) || typeof session.token !== 'string') throw new Error('Desktop bootstrap did not issue a session.');
    const methods = await fetch(`${base}/api/v1/methods`, { headers: { origin, authorization: `Bearer ${session.token}` } });
    expect(methods.status).toBe(200);
    expect(methods.headers.get('access-control-allow-origin')).toBe(origin);
    const catalog: unknown = await methods.json();
    if (!catalog || typeof catalog !== 'object' || !('definitions' in catalog) || !Array.isArray(catalog.definitions)) throw new Error('The method catalog was not returned.');
    const ids = catalog.definitions.flatMap((definition: unknown) => {
      if (!definition || typeof definition !== 'object' || !('value' in definition) || !definition.value || typeof definition.value !== 'object' || !('id' in definition.value)) return [];
      return typeof definition.value.id === 'string' ? [definition.value.id] : [];
    });
    expect(ids).toContain('lab-skill-the-human-mark');
  }
});

test('desktop bootstrap refuses lookalike origins even with a trusted Referer', async () => {
  for (const origin of ['air-office://localhost.evil.example', 'http://127.0.0.1:5173.evil.example', 'null', '']) {
    const response = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin, referer: 'air-office://localhost/' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.text()).toBe('Forbidden');
  }
  expect((await fetch(`${base}/bootstrap`, { method: 'POST' })).status).toBe(403);
  const nativeReferer = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { referer: 'air-office://localhost/' } });
  expect(nativeReferer.status).toBe(200);
  expect(nativeReferer.headers.get('access-control-allow-origin')).toBe('air-office://localhost');
});

test('remote OAuth management requires service authentication while only the exact state-protected callback is public', async () => {
  const prefix = `${base}/api/v1/tools/connections/unknown/oauth`;
  for (const [action, method] of [['start', 'POST'], ['status', 'GET'], ['cancel', 'POST'], ['disconnect', 'POST']] as const) {
    expect((await fetch(`${prefix}/${action}`, { method })).status).toBe(401);
  }
  expect((await fetch(`${base}/api/v1/tools/oauth/callback?state=unknown&code=private-code`)).status).toBe(400);
  expect((await fetch(`${base}/api/v1/tools/oauth/callback/extra?state=unknown`)).status).toBe(401);
  expect((await fetch(`${base}/api/v1/tools/oauth/callback`, { method: 'POST' })).status).toBe(401);
  const response = await fetch(`${prefix}/status`, { headers: headers() });
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain('private-code');
});

const submit = (runId: string, content = 'hello') => fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId, model: 'local-replay', messages: [{ role: 'user', content }] }) });
const replay = (runId: string, cursor?: number) => fetch(`${base}/api/v1/runs/${runId}/events`, { headers: { ...headers(), ...(cursor === undefined ? {} : { 'last-event-id': String(cursor) }) } });
const frames = (text: string) => text.trim().split('\n\n').map((frame) => ({ id: Number(frame.match(/^id: (\d+)$/m)?.[1]), data: JSON.parse(frame.match(/^data: (.+)$/m)?.[1] ?? 'null') as { sequence: number; type: string; payload: { code?: string; reason?: string } } }));

test('authenticated Lemonade status uses bounded named endpoints without returning its bearer secret', async () => {
  lemonadeScenario = 'ready';
  lemonadeAuthHeaders = [];
  expect((await fetch(`${base}/api/v1/local-ai/status`)).status).toBe(401);
  const response = await fetch(`${base}/api/v1/local-ai/status`, { headers: headers() });
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('2026.42.1');
  expect(text).toContain('ready');
  expect(text).not.toContain('runtime-secret-test');
  expect(lemonadeAuthHeaders).toEqual(['Bearer runtime-secret-test', 'Bearer runtime-secret-test']);
  lemonadeScenario = 'loading';
  const loading = await fetch(`${base}/api/v1/local-ai/status`, { headers: headers() });
  expect(loading.status).toBe(200);
  expect((await loading.json() as { state: string }).state).toBe('loading');
  lemonadeScenario = 'malformed';
  expect((await fetch(`${base}/api/v1/local-ai/status`, { headers: headers() })).status).toBe(502);
  lemonadeScenario = 'oversized';
  expect((await fetch(`${base}/api/v1/local-ai/status`, { headers: headers() })).status).toBe(502);
  lemonadeScenario = 'cancel';
  const controller = new AbortController();
  const pending = fetch(`${base}/api/v1/local-ai/status`, { headers: headers(), signal: controller.signal });
  await Bun.sleep(20);
  controller.abort();
  await expect(pending).rejects.toThrow();
  lemonadeScenario = 'ready';
});

test('authenticated canonical SSE and cursor replay survive process restart', async () => {
  expect((await submit('test-run')).status).toBe(202);
  const response = await replay('test-run');
  const text = await response.text();
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const events = frames(text);
  expect(events.length).toBeGreaterThan(1);
  expect(events.every((frame) => frame.id === frame.data.sequence)).toBe(true);
  expect(events.at(-1)?.data.type).toBe('completion');
  const oldToken = token;
  await stop();
  await launch();
  expect(token).not.toBe(oldToken);
  expect((await fetch(`${base}/api/v1/runs/test-run/events`, { headers: { authorization: `Bearer ${oldToken}` } })).status).toBe(401);
  expect(await (await replay('test-run')).text()).toBe(text);
  const replayText = await (await replay('test-run', events[0]!.id)).text();
  expect(replayText).not.toContain(`id: ${events[0]!.id}\n`);
  expect(replayText).toContain(`id: ${events[1]!.id}\n`);
  expect((await submit('test-run')).status).toBe(409);
}, 30_000);

test('a killed generation retains partial events and reports interruption, not success', async () => {
  expect((await submit('interrupted-run', 'word '.repeat(5000))).status).toBe(202);
  const response = await replay('interrupted-run');
  const reader = response.body!.getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('text-delta');
  await stop();
  await reader.cancel().catch(() => {});
  await launch();
  const events = frames(await (await replay('interrupted-run')).text());
  expect(events[0]!.data.type).toBe('text-delta');
  expect(events.at(-1)!.data.type).toBe('failure');
  expect(events.at(-1)!.data.payload.code).toBe('run-interrupted');
  expect(events.some((event) => event.data.type === 'completion')).toBe(false);
  expect(events.every((event, index) => event.id === index)).toBe(true);
});

test('DELETE cancellation is terminal and durable; routes remain authenticated and bounded', async () => {
  expect((await fetch(`${base}/api/v1/runs/missing/events`)).status).toBe(401);
  expect((await fetch(`${base}/api/v1/runs/missing`, { method: 'DELETE' })).status).toBe(401);
  expect((await submit('cancelled-run', 'word '.repeat(5000))).status).toBe(202);
  expect((await fetch(`${base}/api/v1/runs/cancelled-run`, { method: 'DELETE', headers: headers() })).status).toBe(204);
  const text = await (await replay('cancelled-run')).text();
  expect(frames(text).at(-1)!.data.payload.reason).toBe('cancelled');
  expect((await replay('cancelled-run', NaN)).status).toBe(400);
  expect((await replay('cancelled-run', -2)).status).toBe(400);
  expect((await fetch(`${base}/api/v1/runs/%ZZ`, { method: 'DELETE', headers: headers() })).status).toBe(400);
  expect((await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'invalid', model: 'local-replay', messages: [], context: { selection: 5 } }) })).status).toBe(400);
  await stop();
  await launch();
  expect(await (await replay('cancelled-run')).text()).toBe(text);
});

test('authenticated file routes read, save under a version guard, and reject traversal', async () => {
  expect((await fetch(`${base}/api/v1/files`)).status).toBe(401);
  const list = await fetch(`${base}/api/v1/files`, { headers: headers() });
  expect(list.status).toBe(200);
  const listed = await list.json() as { files: { id: string; name: string; version: string }[] };
  const fixture = listed.files.find((file) => file.name === 'fixture.md')!;
  expect(fixture).toBeDefined();
  expect(fixture.name).not.toContain('\\');

  const read = await fetch(`${base}/api/v1/files/fixture.md`, { headers: headers() });
  expect(read.status).toBe(200);
  const snapshot = (await read.json() as { file: { content: string; version: string } }).file;
  expect(snapshot.content).toBe('fixture content');

  const saved = await fetch(`${base}/api/v1/files/fixture.md`, { method: 'PUT', headers: headers(), body: JSON.stringify({ content: 'saved content', expectedVersion: snapshot.version }) });
  expect(saved.status).toBe(200);
  const nextVersion = (await saved.json() as { file: { version: string } }).file.version;

  const stale = await fetch(`${base}/api/v1/files/fixture.md`, { method: 'PUT', headers: headers(), body: JSON.stringify({ content: 'clobber', expectedVersion: snapshot.version }) });
  expect(stale.status).toBe(409);
  expect((await stale.json() as { error: { code: string } }).error.code).toBe('file-stale-version');
  expect((await fetch(`${base}/api/v1/files/fixture.md`, { headers: headers() }).then((response) => response.json()) as { file: { content: string } }).file.content).toBe('saved content');

  expect((await fetch(`${base}/api/v1/files/..%2Fescape.md`, { headers: headers() })).status).toBe(403);
  expect((await fetch(`${base}/api/v1/files/missing.md`, { headers: headers() })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/files/fixture.md`, { method: 'PUT', headers: headers(), body: JSON.stringify({ content: 'x' }) })).status).toBe(400);

  expect((await fetch(`${base}/api/v1/tools/files/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ tool: 'read-file', fileId: 'fixture.md' }) })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/files/fixture.md`, { headers: headers() }).then((response) => response.json()) as { file: { content: string; version: string } }).file).toMatchObject({ content: 'saved content', version: nextVersion });
});

test('provider routes list configured connections and discover live models without leaking credentials', async () => {
  const stub = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'llama3:latest' }, { name: 'qwen2' }] });
    return new Response('Not found', { status: 404 });
  } });
  try {
    await stop();
    await launch({ OFFICE_OLLAMA_BASE_URL: `http://127.0.0.1:${stub.port}` });
    expect((await fetch(`${base}/api/v1/providers`)).status).toBe(401);
    const listed = await fetch(`${base}/api/v1/providers`, { headers: headers() });
    expect(listed.status).toBe(200);
    const providers = (await listed.json() as { providers: { id: string; models: string[] }[] }).providers;
    expect(providers.map((provider) => provider.id)).toContain('ollama');
    expect(providers.every((provider) => !('credential' in provider))).toBe(true);
    const discovered = await fetch(`${base}/api/v1/providers/ollama/models`, { headers: headers() });
    expect(discovered.status).toBe(200);
    expect((await discovered.json() as { models: string[] }).models).toEqual(['llama3:latest', 'qwen2']);
    expect((await fetch(`${base}/api/v1/providers/ghost/models`, { headers: headers() })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'bad-provider', model: 'x', provider: 'ghost', messages: [{ role: 'user', content: 'hi' }] }) })).status).toBe(400);
  } finally {
    stub.stop(true);
  }
}, 30_000);

test('AIR-authenticated modality routes forward documented image, audio, and 3D requests with bounded results', async () => {
  lemonadeAuthHeaders = [];
  const power = await fetch(`${base}/api/v1/local-ai/power`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: true }) });
  expect(power.status).toBe(200);
  const unauthorized = await fetch(`${base}/api/v1/local-ai/audio/generations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'ace', prompt: 'music' }) });
  expect(unauthorized.status).toBe(401);
  const generated = await fetch(`${base}/api/v1/local-ai/audio/generations`, { method: 'POST', headers: headers(), body: JSON.stringify({ model: 'ace', prompt: 'music', duration: 5 }) });
  expect(generated.status).toBe(502);
  expect(lemonadeAuthHeaders.at(-1)).toBe('Bearer runtime-secret-test');
  const invalid = await fetch(`${base}/api/v1/local-ai/images/generations`, { method: 'POST', headers: headers(), body: JSON.stringify({ model: 'sd-turbo', prompt: 'a tree', n: 2 }) });
  expect(invalid.status).toBe(400);
});

test('the managed Lemonade provider lists local models and sends chat through only its private runtime credential', async () => {
  lemonadeAuthHeaders = []; lemonadeChatRequests = [];
  const listed = await (await fetch(`${base}/api/v1/providers`, { headers: headers() })).json() as { providers: { id: string; name: string; models: string[]; capabilities: unknown; credentialConfigured: boolean }[] };
  const managed = listed.providers.find((provider) => provider.id === 'managed-local');
  expect(managed).toMatchObject({ id: 'managed-local', name: 'Local', models: ['managed-chat'], capabilities: { streaming: true, tools: true, images: false, imageGeneration: false }, credentialConfigured: false });
  expect(JSON.stringify(listed)).not.toContain('runtime-secret-test');
  const discovered = await (await fetch(`${base}/api/v1/providers/managed-local/models`, { headers: headers() })).json() as { models: string[] };
  expect(discovered.models).toEqual(['managed-chat']);
  expect((await fetch(`${base}/api/v1/providers/managed-local/credential`, { method: 'PUT', headers: headers(), body: JSON.stringify({ secret: 'do-not-store' }) })).status).toBe(409);
  expect((await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify({ connection: { id: 'managed-local', name: 'Collision', kind: 'openai-compatible', baseUrl: 'https://example.test', models: [], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null } }) })).status).toBe(409);
  expect((await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'managed-lemonade', provider: 'managed-local', model: 'managed-chat', messages: [{ role: 'user', content: 'hello local runtime' }] }) })).status).toBe(202);
  const events = frames(await (await replay('managed-lemonade')).text());
  expect(events.some((event) => event.data.type === 'completion')).toBe(true);
  expect(lemonadeChatRequests).toMatchObject([{ model: 'managed-chat' }]);
  // Lean local may send several system turns (baseline, tool list, skills,
  // context). The user's request is still the final turn.
  const lemonadeRoles = lemonadeChatRequests[0]?.messages.map((message) => message.role) ?? [];
  expect(lemonadeRoles.at(-1)).toBe('user');
  expect(lemonadeRoles.slice(0, -1).every((role) => role === 'system')).toBe(true);
  expect(lemonadeChatRequests[0]?.messages.some((message) => message.role === 'system' && String(message.content).includes('You are AIR'))).toBe(true);
  expect(lemonadeChatRequests[0]?.messages.at(-1)?.content).toContain('hello local runtime');
  expect(lemonadeAuthHeaders.every((value) => value === 'Bearer runtime-secret-test')).toBe(true);
});

test('the conversation graph persists branches across restart and never leaks the credential value', async () => {
  expect((await fetch(`${base}/api/v1/conversations`)).status).toBe(401);
  const seeded = await fetch(`${base}/api/v1/conversations`, { method: 'POST', headers: headers(), body: JSON.stringify({ conversationId: 'conv-1' }) });
  expect(seeded.status).toBe(201);
  const append = (id: string, parentId: string | null, role: string, content: string) => fetch(`${base}/api/v1/conversations/conv-1/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id, parentId, role, content, complete: true }) });
  expect((await append('u1', null, 'user', 'first question')).status).toBe(201);
  expect((await append('a1', 'u1', 'assistant', 'first answer')).status).toBe(201);
  // Edit-and-branch: u2 is a sibling of u1, and the original answer stays reachable.
  expect((await append('u2', null, 'user', 'edited question')).status).toBe(201);
  expect((await append('a2', 'u2', 'assistant', 'edited answer')).status).toBe(201);
  await stop();
  await launch();
  const graph = await (await fetch(`${base}/api/v1/conversations/conv-1`, { headers: headers() })).json() as { conversation: { messages: { id: string; parentId: string | null }[] } };
  expect(graph.conversation.messages).toHaveLength(4);
  expect(graph.conversation.messages.find((message) => message.id === 'a1')?.parentId).toBe('u1');
  expect(graph.conversation.messages.find((message) => message.id === 'a2')?.parentId).toBe('u2');
  const history = await (await fetch(`${base}/api/v1/conversations/conv-1/history?limit=2`, { headers: headers() })).json() as { messages: { id: string }[] };
  expect(history.messages).toHaveLength(2);
  const summaries = await (await fetch(`${base}/api/v1/conversations`, { headers: headers() })).json() as { conversations: { id: string; messageCount: number }[] };
  expect(summaries.conversations.find((conversation) => conversation.id === 'conv-1')?.messageCount).toBe(4);
  const renamed = await fetch(`${base}/api/v1/conversations/conv-1`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ title: 'Renamed' }) });
  expect((await renamed.json() as { conversation: { conversation: { title: string } } }).conversation.conversation.title).toBe('Renamed');
  expect((await fetch(`${base}/api/v1/conversations/missing`, { headers: headers() })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/conversations/conv-1/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'bad', parentId: null, role: 'robot', content: 'x', complete: true }) })).status).toBe(400);
  expect((await fetch(`${base}/api/v1/conversations/conv-1`, { method: 'DELETE', headers: headers() })).status).toBe(204);
  expect((await fetch(`${base}/api/v1/conversations/conv-1`, { headers: headers() })).status).toBe(404);
}, 30_000);

test('a provider credential configured through the environment is reported as presence only', async () => {
  await stop();
  await launch({ OFFICE_OPENAI_BASE_URL: 'http://127.0.0.1:9', OFFICE_PROVIDER_OPENAI_TOKEN: 'sk-live-secret-value' });
  const listed = await (await fetch(`${base}/api/v1/providers`, { headers: headers() })).json() as { providers: { id: string; credentialConfigured?: boolean }[] };
  const openai = listed.providers.find((provider) => provider.id === 'openai');
  expect(openai?.credentialConfigured).toBe(true);
  // The secret value must never appear in the serialized status.
  expect(JSON.stringify(listed)).not.toContain('sk-live-secret-value');
  const replay = listed.providers.find((provider) => provider.id === 'local-replay');
  expect(replay?.credentialConfigured).toBe(false);
}, 30_000);

test('document ingestion, search and job listing are authenticated and bounded', async () => {
  expect((await fetch(`${base}/api/v1/collections`)).status).toBe(401);
  expect((await fetch(`${base}/api/v1/collections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'c1', name: 'Research' }) })).status).toBe(201);
  const ingest = await fetch(`${base}/api/v1/documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ documentId: 'd1', name: 'notes.txt', collectionId: 'c1', content: 'draft recovery keeps unsaved edits safe' }) });
  expect(ingest.status).toBe(201);
  const again = await fetch(`${base}/api/v1/documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ documentId: 'd1', name: 'notes.txt', collectionId: 'c1', content: 'draft recovery keeps unsaved edits safe' }) });
  expect(again.status).toBe(200);
  const versions = await (await fetch(`${base}/api/v1/documents/d1/versions`, { headers: headers() })).json() as { versions: { id: string }[] };
  expect(versions.versions).toHaveLength(1);
  expect((await fetch(`${base}/api/v1/versions/${encodeURIComponent(versions.versions[0]!.id)}/artifact`, { headers: headers() })).status).toBe(404);
  const search = await fetch(`${base}/api/v1/search`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionIds: ['c1'], query: 'recovery' }) });
  expect(search.status).toBe(200);
  expect((await fetch(`${base}/api/v1/search`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionIds: [], query: 'x' }) })).status).toBe(400);
  expect((await fetch(`${base}/api/v1/jobs`, { headers: headers() })).status).toBe(200);
  expect((await fetch(`${base}/api/v1/jobs/missing`, { headers: headers() })).status).toBe(404);
  const probe = await (await fetch(`${base}/api/v1/vector/probe`, { headers: headers() })).json() as { vector: { available: boolean; detail: string } };
  expect(typeof probe.vector.available).toBe('boolean');
});

test('an index job runs to success, exposes progress, and refuses a duplicate unit', async () => {
  const start = await fetch(`${base}/api/v1/index`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionId: 'c1', versionId: 'v-index', content: 'draft recovery keeps unsaved edits safe and searchable' }) });
  expect(start.status).toBe(202);
  const job = (await start.json() as { job: { id: string } }).job;
  let state = 'queued';
  for (let attempt = 0; attempt < 100 && state !== 'succeeded' && state !== 'failed'; attempt++) {
    await Bun.sleep(25);
    state = (await (await fetch(`${base}/api/v1/jobs/${encodeURIComponent(job.id)}`, { headers: headers() })).json() as { job: { state: string } }).job.state;
  }
  expect(state).toBe('succeeded');
  const search = await (await fetch(`${base}/api/v1/search`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionIds: ['c1'], query: 'searchable' }) })).json() as { results: { sourceVersionId: string }[] };
  expect(search.results.some((result) => result.sourceVersionId === 'v-index')).toBe(true);
  const selectedSearch = await (await fetch(`${base}/api/v1/search`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionIds: ['c1'], query: 'searchable', documentIds: ['missing-document'] }) })).json() as { results: unknown[] };
  expect(selectedSearch.results).toEqual([]);
  expect((await fetch(`${base}/api/v1/index`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionId: 'ghost', versionId: 'v', content: 'x' }) })).status).toBe(404);
  expect((await fetch(`${base}/api/v1/index`, { method: 'POST', headers: headers(), body: JSON.stringify({ collectionId: 'c1', content: 'x' }) })).status).toBe(400);
});

test('OpenAPI discovery stays disabled until enabled and invocation returns validated results', async () => {
  const remote = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/openapi.json') return Response.json({ openapi: '3.0.0', servers: [{ url: `${url.origin}/api/v2` }], paths: { '/read': { get: { operationId: 'read_status', summary: 'Read service status', parameters: [{ $ref: '#/components/parameters/label' }] } }, '/write': { post: { operationId: 'write_status', requestBody: { $ref: '#/components/requestBodies/writeStatus' } } } }, components: { parameters: { label: { name: 'label', in: 'query', required: true, schema: { type: 'string', minLength: 1 } } }, requestBodies: { writeStatus: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WriteStatus' } } } } }, schemas: { WriteStatus: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } } } });
      if (url.pathname === '/api/v2/read') return Response.json({ label: url.searchParams.get('label'), state: 'ready' });
      if (url.pathname === '/api/v2/write') return Response.json({ saved: true });
      return new Response('Not found', { status: 404 });
    }
  });
  try {
    const endpoint = `http://127.0.0.1:${remote.port}/`;
    const create = await fetch(`${base}/api/v1/tools/connections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api', name: 'Fixture API', kind: 'openapi', endpoint }) });
    expect(create.status).toBe(201);
    const discovered = await fetch(`${base}/api/v1/tools/connections/fixture-api/discover`, { method: 'POST', headers: headers() });
    expect(discovered.status).toBe(200);
    const items = (await discovered.json() as { definitions: { id: string; name: string; effect: string; enabled: boolean }[] }).definitions;
    expect(items.map(({ name, effect, enabled }) => ({ name, effect, enabled }))).toEqual([
      { name: 'read_status', effect: 'read', enabled: false },
      { name: 'write_status', effect: 'mutate', enabled: false }
    ]);
    expect((await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:read_status', input: { label: 'check' } }) })).status).toBe(404);
    await fetch(`${base}/api/v1/tools/connections/fixture-api`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: true }) });
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:read_status', enabled: true }) });
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:write_status', enabled: true }) });
    const read = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:read_status', input: { label: 'check' } }) });
    expect(read.status).toBe(200);
    expect((await read.json() as { invocation: { status: string; result: unknown } }).invocation).toMatchObject({ status: 'succeeded', result: { label: 'check', state: 'ready' } });
    const blocked = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:write_status', input: { body: { value: 'x' } } }) });
    expect(blocked.status).toBe(409);
    const confirmed = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:write_status', input: { body: { value: 'x' } }, confirmed: true }) });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json() as { invocation: { status: string; result: unknown } }).invocation).toMatchObject({ status: 'succeeded', result: { saved: true } });
    const now = new Date().toISOString();
    const schedule = { id: 'scheduled-write', name: 'Scheduled write', enabled: true, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.slice(0, 10) }, missedRunPolicy: 'skip', steps: [{ kind: 'tool', toolId: 'fixture-api:write_status', input: { body: { value: 'scheduled' } } }], createdAt: now, updatedAt: now };
    expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: schedule, confirmed: false }) })).status).toBe(409);
    expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: schedule, confirmed: true }) })).status).toBe(201);
    expect((await fetch(`${base}/api/v1/automations/${schedule.id}/run`, { method: 'POST', headers: headers(), body: JSON.stringify({ confirmed: false }) })).status).toBe(400);
    const invalidSchedule = { ...schedule, id: 'invalid-scheduled-write', steps: [{ kind: 'tool', toolId: 'fixture-api:write_status', input: { body: {} } }] };
    expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: invalidSchedule, confirmed: true }) })).status).toBe(400);
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:write_status', enabled: false }) });
    const paused = await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: { ...schedule, enabled: false }, confirmed: false }) });
    expect(paused.status).toBe(201);
    expect((await paused.json() as { automation: { enabled: boolean } }).automation.enabled).toBe(false);
    expect((await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: schedule, confirmed: true }) })).status).toBe(400);
    await stop();
    await launch();
    const restored = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-api:read_status', input: { label: 'restart' } }) });
    expect((await restored.json() as { invocation: { status: string; result: unknown } }).invocation).toMatchObject({ status: 'succeeded', result: { label: 'restart', state: 'ready' } });
  } finally { remote.stop(true); }
}, 30_000);

test('selected read tools run in the provider loop and return their result to the assistant', async () => {
  let slowStartedResolve: () => void = () => undefined;
  const slowStarted = new Promise<void>((resolve) => { slowStartedResolve = resolve; });
  const remote = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/openapi.json') return Response.json({ openapi: '3.0.0', paths: { '/read': { get: { operationId: 'read_status', parameters: [{ name: 'label', in: 'query', required: true, schema: { type: 'string' } }] } }, '/slow': { get: { operationId: 'slow_status' } } } });
    if (url.pathname === '/read') return Response.json({ label: url.searchParams.get('label'), state: 'ready' });
    if (url.pathname === '/slow') { slowStartedResolve(); return new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ state: 'late' })), 5000)); }
    return new Response('Not found', { status: 404 });
  } });
  let providerCalls = 0;
  const offeredToolNames: string[][] = [];
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { messages: { role: string; content: string }[]; tools?: { function?: { name?: string } }[] };
    offeredToolNames.push((body.tools ?? []).map((tool) => tool.function?.name ?? ''));
    providerCalls += 1;
    const toolReturned = body.messages.some((message) => message.role === 'tool');
    const slow = body.messages.some((message) => message.role === 'user' && message.content.includes('Slow check'));
    const chunks = toolReturned
      ? [{ choices: [{ delta: { content: 'The service is ready.' }, finish_reason: 'stop' }] }]
      : [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${providerCalls}`, type: 'function', function: { name: slow ? 'slow_status' : 'read_status', arguments: slow ? '{}' : '{"label":"chat"}' } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
        ];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const savedConnections = await (await fetch(`${base}/api/v1/model-connections`, { headers: headers() })).json() as { connections: { id: string; baseUrl: string; models: string[] }[] };
  const originalProvider = savedConnections.connections.find((item) => item.id === 'openai');
  expect(originalProvider).toBeDefined();
  try {
    // Environment settings seed a new database; they intentionally do not replace
    // saved connections on restart. Switch the fixture through the public API.
    const configured = await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify({ ...originalProvider, baseUrl: `http://127.0.0.1:${provider.port}/v1`, models: ['fixture-model'] }) });
    expect(configured.status).toBe(200);
    const connection = await fetch(`${base}/api/v1/tools/connections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'chat-fixture-api', name: 'Chat fixture', kind: 'openapi', endpoint: `http://127.0.0.1:${remote.port}/` }) });
    expect(connection.status).toBe(201);
    expect((await fetch(`${base}/api/v1/tools/connections/chat-fixture-api/discover`, { method: 'POST', headers: headers() })).status).toBe(200);
    await fetch(`${base}/api/v1/tools/connections/chat-fixture-api`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: true }) });
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'chat-fixture-api:read_status', enabled: true }) });
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'chat-fixture-api:slow_status', enabled: true }) });
    const toolCatalog = await (await fetch(`${base}/api/v1/tools`, { headers: headers() })).json() as { chatAvailableToolIds: string[]; definitions: { id: string; enabled: boolean }[] };
    expect(toolCatalog.definitions).toContainEqual(expect.objectContaining({ id: 'chat-fixture-api:read_status', enabled: true }));
    expect(toolCatalog.chatAvailableToolIds).toContain('chat-fixture-api:read_status');
    await fetch(`${base}/api/v1/conversations`, { method: 'POST', headers: headers(), body: JSON.stringify({ conversationId: 'tool-conversation' }) });
    await fetch(`${base}/api/v1/conversations/tool-conversation/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'tool-user', parentId: null, role: 'user', content: 'Check the service.', complete: true }) });
    await fetch(`${base}/api/v1/conversations/tool-conversation/messages`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'tool-assistant', parentId: 'tool-user', role: 'assistant', content: '', complete: false }) });
    const started = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'selected-tool-run', conversation: { id: 'tool-conversation', assistantMessageId: 'tool-assistant' }, provider: 'openai', model: 'fixture-model', toolIds: ['chat-fixture-api:read_status'], messages: [{ role: 'user', content: 'Check the service.' }] }) });
    expect(started.status).toBe(202);
    const events = frames(await (await replay('selected-tool-run')).text());
    const result = events.find((event) => event.data.type === 'tool-result');
    expect(offeredToolNames[0]).toContain('read_status');
    expect(events.map((event) => event.data.type)).toContain('tool-request');
    expect(result?.data.payload).toMatchObject({ status: 'ok', result: { label: 'chat', state: 'ready' } });
    expect(events.at(-1)?.data.payload).toMatchObject({ reason: 'stop' });
    expect(providerCalls).toBe(2);
    const saved = await (await fetch(`${base}/api/v1/conversations/tool-conversation`, { headers: headers() })).json() as { conversation: { messages: { id: string; content: string; output: unknown[]; statusHistory: { state: string }[] }[] } };
    const answer = saved.conversation.messages.find((message) => message.id === 'tool-assistant');
    expect(answer?.content).toBe('The service is ready.');
    expect(answer?.output).toContainEqual(expect.objectContaining({ kind: 'tool', status: 'ok', result: { label: 'chat', state: 'ready' } }));
    expect(answer?.statusHistory.map((entry) => entry.state)).toContain('running');
    expect(answer?.statusHistory.map((entry) => entry.state)).toContain('ok');

    const slowRun = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'cancel-slow-tool-run', provider: 'openai', model: 'fixture-model', toolIds: ['chat-fixture-api:slow_status'], messages: [{ role: 'user', content: 'Slow check' }] }) });
    expect(slowRun.status).toBe(202);
    await slowStarted;
    const cancellationStartedAt = Date.now();
    expect((await fetch(`${base}/api/v1/runs/cancel-slow-tool-run`, { method: 'DELETE', headers: headers() })).status).toBe(204);
    const cancelledEvents = frames(await (await replay('cancel-slow-tool-run')).text());
    expect(cancelledEvents.at(-1)?.data.payload).toMatchObject({ reason: 'cancelled' });
    expect(Date.now() - cancellationStartedAt).toBeLessThan(2000);
  } finally {
    if (originalProvider) expect((await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify(originalProvider) })).status).toBe(200);
    remote.stop(true); provider.stop(true);
  }
}, 30_000);

test('Action discovery returns concise searchable pages and complete details on request', async () => {
  const invoke = async (id: string, input: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id, input }) });
    expect(response.status).toBe(200);
    return (await response.json() as { invocation: { result: unknown } }).invocation.result;
  };
  const page = await invoke('builtin:glob', { pattern: '.air/pack/actions/*.md' }) as { matches: string[] };
  expect(page.matches.length).toBeGreaterThan(0);
  expect(page.matches.length).toBeLessThanOrEqual(50);
  const first = page.matches[0]!;
  expect(first.endsWith('.md')).toBe(true);
  const search = await invoke('builtin:grep', { pattern: 'name:', path: '.air/pack/actions', glob: '*.md', output_mode: 'files_with_matches' }) as { files?: string[]; matches?: string[] };
  const hits = search.files ?? search.matches ?? [];
  expect(hits.some((path) => path.replace(/\\/g, '/').endsWith(first.replace(/\\/g, '/')) || path.includes('pack/actions'))).toBe(true);
  const detail = await invoke('builtin:view', { path: first }) as { content: string };
  expect(detail.content.length).toBeGreaterThan(0);
  const missing = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'builtin:view', input: { path: 'actions/missing-action-does-not-exist.md' } }) });
  expect(missing.status).toBe(200);
  expect(await missing.json()).toMatchObject({ invocation: { status: 'failed', error: expect.stringContaining('File not found') } });
});

test('a chat Action runs with the chat provider and model', async () => {
  const nestedModels: string[] = [];
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { model: string; messages: { role: string; content: unknown }[] };
    const nested = body.messages.some((message) => message.role === 'user' && typeof message.content === 'string' && message.content.includes('SYNTHETIC_ACTION_FIXTURE'));
    if (nested) nestedModels.push(body.model);
    const returned = body.messages.some((message) => message.role === 'tool');
    const chunks = nested || returned
      ? [{ choices: [{ delta: { content: nested ? 'Fixture action result' : 'Action complete' }, finish_reason: 'stop' }] }]
      : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'action-call', type: 'function', function: { name: 'action_run', arguments: JSON.stringify({ path: '.air/pack/actions/policy-audit.md', source: 'SYNTHETIC_ACTION_FIXTURE' }) } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const saved = await (await fetch(`${base}/api/v1/model-connections`, { headers: headers() })).json() as { connections: { id: string; baseUrl: string; models: string[] }[] };
  const original = saved.connections.find((item) => item.id === 'openai');
  try {
    expect(original).toBeDefined();
    expect((await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify({ ...original, baseUrl: `http://127.0.0.1:${provider.port}/v1`, models: ['fixture-model'] }) })).status).toBe(200);
    const started = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'action-provider-run', provider: 'openai', model: 'fixture-model', toolIds: ['builtin:action-run'], messages: [{ role: 'user', content: 'Run the selected Action.' }] }) });
    expect(started.status).toBe(202);
    const events = frames(await (await replay('action-provider-run')).text());
    expect(events.find((event) => event.data.type === 'tool-result')?.data.payload).toMatchObject({ status: 'ok' });
    expect(nestedModels).toEqual(['fixture-model']);
  } finally {
    if (original) await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify(original) });
    provider.stop(true);
  }
}, 30_000);

test('schedule_run pauses for tool approval before invoking a saved schedule', async () => {
  let providerCalls = 0;
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json() as { messages: { role: string; content: string }[] };
    providerCalls += 1;
    const hasToolResult = body.messages.some((message) => message.role === 'tool');
    const chunks = hasToolResult
      ? [{ choices: [{ delta: { content: 'The schedule was not run.' }, finish_reason: 'stop' }] }]
      : [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'schedule-call-1', type: 'function', function: { name: 'schedule_run', arguments: '{"path":"automations/approval-schedule.automation.yaml"}' } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const savedConnections = await (await fetch(`${base}/api/v1/model-connections`, { headers: headers() })).json() as { connections: { id: string; baseUrl: string; models: string[] }[] };
  const originalProvider = savedConnections.connections.find((item) => item.id === 'openai');
  const now = new Date().toISOString();
  const schedule = { id: 'approval-schedule', path: 'automations/approval-schedule.automation.yaml', name: 'Approval schedule', enabled: true, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: now.slice(0, 10) }, missedRunPolicy: 'skip', steps: [{ kind: 'tool', toolId: 'builtin:memory-search', input: {} }], createdAt: now, updatedAt: now };
  try {
    expect(originalProvider).toBeDefined();
    const configured = await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify({ ...originalProvider, baseUrl: `http://127.0.0.1:${provider.port}/v1`, models: ['approval-fixture-model'] }) });
    expect(configured.status).toBe(200);
    const saved = await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: schedule, confirmed: false }) });
    expect(saved.status).toBe(201);
    const started = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'schedule-approval-run', provider: 'openai', model: 'approval-fixture-model', toolIds: ['builtin:schedule-run'], messages: [{ role: 'user', content: 'Run the schedule.' }] }) });
    expect(started.status).toBe(202);
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = await (await fetch(`${base}/api/v1/runs/schedule-approval-run/interactions`, { headers: headers() })).json() as { approvals: { toolCallId: string }[] };
      if (pending.approvals.some((item) => item.toolCallId === 'schedule-call-1')) break;
      await Bun.sleep(100);
    }
    const pendingApproval = await fetch(`${base}/api/v1/runs/schedule-approval-run/tool-approval`, { method: 'POST', headers: headers(), body: JSON.stringify({ toolCallId: 'schedule-call-1', approved: false }) });
    expect(pendingApproval.status).toBe(200);
    expect((await fetch(`${base}/api/v1/runs/schedule-approval-run/tool-approval`, { method: 'POST', headers: headers(), body: JSON.stringify({ toolCallId: 'schedule-call-1', approved: true }) })).status).toBe(409);
    const events = frames(await (await replay('schedule-approval-run')).text());
    expect(events.map((event) => event.data.type)).toContain('tool-request');
    expect(events.find((event) => event.data.type === 'tool-result')?.data.payload).toMatchObject({ status: 'error' });
    expect(events.at(-1)?.data.payload).toMatchObject({ reason: 'stop' });
    expect(providerCalls).toBe(2);
    const history = await (await fetch(`${base}/api/v1/automations/history?automationId=approval-schedule`, { headers: headers() })).json() as { history: { state: string }[] };
    expect(history.history.every((occurrence) => occurrence.state === 'pending')).toBe(true);

    const interrupted = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'schedule-restart-run', provider: 'openai', model: 'approval-fixture-model', toolIds: ['builtin:schedule-run'], messages: [{ role: 'user', content: 'Run the schedule.' }] }) });
    expect(interrupted.status).toBe(202);
    let sawApproval = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = await (await fetch(`${base}/api/v1/runs/schedule-restart-run/interactions`, { headers: headers() })).json() as { approvals: { toolCallId: string }[] };
      if (pending.approvals.some((item) => item.toolCallId === 'schedule-call-1')) { sawApproval = true; break; }
      await Bun.sleep(100);
    }
    expect(sawApproval).toBe(true);
    await stop();
    await launch();
    const recovered = await (await fetch(`${base}/api/v1/runs/schedule-restart-run/interactions`, { headers: headers() })).json() as { approvals: unknown[] };
    expect(recovered.approvals).toEqual([]);
    expect((await fetch(`${base}/api/v1/runs/schedule-restart-run/tool-approval`, { method: 'POST', headers: headers(), body: JSON.stringify({ toolCallId: 'schedule-call-1', approved: true }) })).status).toBe(409);
    const interruptedEvents = frames(await (await replay('schedule-restart-run')).text());
    expect(interruptedEvents.at(-1)?.data.payload).toMatchObject({ code: 'run-interrupted' });
  } finally {
    if (originalProvider) expect((await fetch(`${base}/api/v1/model-connections`, { method: 'PUT', headers: headers(), body: JSON.stringify(originalProvider) })).status).toBe(200);
    provider.stop(true);
  }
}, 30_000);

test('MCP tools are discovered disabled, then invoked through their declared read-only annotation', async () => {
  const mcp = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const body = await request.json() as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    const headers = { 'mcp-session-id': 'fixture-session' };
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers });
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'Fixture MCP', version: '1.0' }, capabilities: { tools: {} } }
      : body.method === 'tools/list'
        ? { tools: [{ name: 'read_status', description: 'Read service status', inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false }, annotations: { readOnlyHint: true } }] }
        : body.method === 'tools/call'
          ? { content: [{ type: 'text', text: JSON.stringify({ label: body.params?.arguments?.label, state: 'ready' }) }], structuredContent: { label: body.params?.arguments?.label, state: 'ready' }, isError: false }
          : null;
    return Response.json({ jsonrpc: '2.0', id: body.id, result }, { headers });
  } });
  try {
    const created = await fetch(`${base}/api/v1/tools/connections`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: 'fixture-mcp', name: 'Fixture MCP', kind: 'mcp', endpoint: `http://127.0.0.1:${mcp.port}/mcp` }) });
    expect(created.status).toBe(201);
    const discovery = await fetch(`${base}/api/v1/tools/connections/fixture-mcp/discover`, { method: 'POST', headers: headers() });
    expect(discovery.status).toBe(200);
    const tool = (await discovery.json() as { definitions: { id: string; effect: string; enabled: boolean }[] }).definitions[0];
    expect(tool).toMatchObject({ id: 'fixture-mcp:read_status', effect: 'read', enabled: false });
    await fetch(`${base}/api/v1/tools/connections/fixture-mcp`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ enabled: true }) });
    await fetch(`${base}/api/v1/tools/enable`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: tool.id, enabled: true }) });
    const invocation = await fetch(`${base}/api/v1/tools/invoke`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: tool.id, input: { label: 'mcp' } }) });
    expect(invocation.status).toBe(200);
    expect((await invocation.json() as { invocation: { status: string; result: unknown } }).invocation).toMatchObject({ status: 'succeeded', result: { structuredContent: { label: 'mcp', state: 'ready' } } });
  } finally { mcp.stop(true); }
}, 30_000);

test('extraction runs through the managed worker and stores an immutable artifact', async () => {
  const ingest = await fetch(`${base}/api/v1/documents`, { method: 'POST', headers: headers(), body: JSON.stringify({ documentId: 'dx', name: 'notes.txt', collectionId: 'c1', content: 'the quick brown fox' }) });
  const version = (await ingest.json() as { version: { id: string } }).version;
  expect((await fetch(`${base}/api/v1/versions/${encodeURIComponent(version.id)}/extract`, { method: 'POST', body: JSON.stringify({ content: 'the quick brown fox' }) })).status).toBe(401);
  const extracted = await fetch(`${base}/api/v1/versions/${encodeURIComponent(version.id)}/extract`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 'the quick brown fox' }) });
  expect(extracted.status).toBe(200);
  const artifact = (await extracted.json() as { artifact: { text: string; extractor: string; extractionVersion: string; contentHash: string } }).artifact;
  expect(artifact.text).toContain('quick brown fox');
  expect(artifact.extractor).toBe('office-documents');
  expect(artifact.extractionVersion).toBe('anchor-v1');
  expect(artifact.contentHash).toHaveLength(64);
  const stored = await (await fetch(`${base}/api/v1/versions/${encodeURIComponent(version.id)}/artifact`, { headers: headers() })).json() as { artifact: { text: string } };
  expect(stored.artifact.text).toBe(artifact.text);
  expect((await fetch(`${base}/api/v1/versions/${encodeURIComponent(version.id)}/extract`, { method: 'POST', headers: headers(), body: JSON.stringify({ content: 5 }) })).status).toBe(400);
});


test('conversation generation persists without a connected renderer and survives restart', async () => {
  await stop();
  await launch();
  providerRequests = [];
  const call = (path: string, body?: unknown, method?: string) => fetch(`${base}${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}) });
  expect((await call('/api/v1/conversations', { conversationId: 'linked-chat' })).status).toBe(201);
  expect((await call('/api/v1/conversations/linked-chat/messages', { id: 'linked-user', parentId: null, role: 'user', content: 'Keep this generation', complete: true })).status).toBe(201);
  expect((await call('/api/v1/conversations/linked-chat/messages', { id: 'linked-assistant', parentId: 'linked-user', role: 'assistant', content: '', complete: false })).status).toBe(201);
  const rootFolderResponse = await call('/api/v1/folders', { id: 'folder-parent', name: 'Research', instruction: 'Parent instruction applies.' });
  expect(rootFolderResponse.status).toBe(201);
  const rootFolder = await rootFolderResponse.json() as { folder: { id: string } };
  const childFolderResponse = await call('/api/v1/folders', { id: 'folder-child', name: 'Notes', parentId: rootFolder.folder.id, instruction: 'Child instruction applies.' });
  expect(childFolderResponse.status).toBe(201);
  const childFolder = await childFolderResponse.json() as { folder: { id: string } };
  expect((await call('/api/v1/conversations/linked-chat', { folderId: childFolder.folder.id }, 'PATCH')).status).toBe(200);
  const generationRequest = { runId: 'linked-run', model: 'gpt-test', provider: 'openai', conversation: { id: 'linked-chat', assistantMessageId: 'linked-assistant' }, messages: [{ role: 'user' as const, content: 'Keep this generation' }] };
  expect((await call('/api/v1/runs', generationRequest)).status).toBe(202);
  const events = frames(await (await replay('linked-run')).text());
  expect(events.map((event) => event.data.type)).toContain('completion');
  expect(providerRequests.length).toBe(1);
  // Lean local keeps baseline, tool list, and folder instructions as separate
  // system turns. The user's request is still the final turn, and the folder
  // instruction still reaches the model after the AIR baseline.
  const linkedRoles = providerRequests[0]?.messages.map((message) => message.role) ?? [];
  expect(linkedRoles.at(-1)).toBe('user');
  expect(linkedRoles.slice(0, -1).every((role) => role === 'system')).toBe(true);
  const systemContent = providerRequests[0]?.messages.filter((message) => message.role === 'system').map((message) => String(message.content ?? '')).join('\n');
  expect(systemContent).toContain('You are AIR');
  expect(systemContent).toContain('Folder instructions:\nParent instruction applies.\n\nChild instruction applies.');
  expect(providerRequests[0]?.messages.at(-1)?.content).toContain('Keep this generation');
  await stop();
  await launch();
  const saved = await (await call('/api/v1/conversations/linked-chat')).json() as { conversation: ConversationGraph };
  const answer = saved.conversation.messages.find((message) => message.id === 'linked-assistant');
  expect(answer).toMatchObject({ complete: true, runId: 'linked-run', modelId: 'gpt-test' });
  expect(answer?.content).toBe('captured');
  expect(answer?.output.length).toBeGreaterThan(0);
  const kept = await call('/api/v1/conversations', { conversationId: 'kept-chat' });
  expect(kept.status).toBe(201);
  expect((await call('/api/v1/conversations/kept-chat', { folderId: childFolder.folder.id }, 'PATCH')).status).toBe(200);
  const rootDelete = await fetch(`${base}/api/v1/folders/${encodeURIComponent(rootFolder.folder.id)}`, { method: 'DELETE', headers: headers(), body: JSON.stringify({ policy: 'keep-chats' }) });
  expect(rootDelete.status).toBe(204);
  const keptGraph = await (await call('/api/v1/conversations/kept-chat')).json() as { conversation: { conversation: { folderId: string | null } } };
  expect(keptGraph.conversation.conversation.folderId).toBeNull();
  const removeFolderResponse = await call('/api/v1/folders', { id: 'folder-remove', name: 'Remove' });
  expect(removeFolderResponse.status).toBe(201);
  const removeFolder = await removeFolderResponse.json() as { folder: { id: string } };
  expect((await call('/api/v1/conversations', { conversationId: 'removed-chat' })).status).toBe(201);
  expect((await call('/api/v1/conversations/removed-chat', { folderId: removeFolder.folder.id }, 'PATCH')).status).toBe(200);
  const removedFolder = await fetch(`${base}/api/v1/folders/${encodeURIComponent(removeFolder.folder.id)}`, { method: 'DELETE', headers: headers(), body: JSON.stringify({ policy: 'delete-chats' }) });
  expect(removedFolder.status).toBe(204);
  expect((await call('/api/v1/conversations/removed-chat')).status).toBe(404);
  expect((await fetch(`${base}/api/v1/folders/${encodeURIComponent(childFolder.folder.id)}`, { method: 'DELETE', headers: headers(), body: JSON.stringify({ policy: 'invalid' }) })).status).toBe(400);
  const duplicateRequest = { ...generationRequest, runId: 'linked-duplicate', messages: [{ role: 'user' as const, content: 'overwrite' }] };
  expect((await call('/api/v1/runs', duplicateRequest)).status).toBe(409);
}, 30_000);

test('conversation generation recovers partial text and interruption after service restart', async () => {
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  await post('/api/v1/conversations', { conversationId: 'interrupted-chat' });
  await post('/api/v1/conversations/interrupted-chat/messages', { id: 'interrupted-user', parentId: null, role: 'user', content: 'Long response', complete: true });
  await post('/api/v1/conversations/interrupted-chat/messages', { id: 'interrupted-assistant', parentId: 'interrupted-user', role: 'assistant', content: '', complete: false });
  expect((await post('/api/v1/runs', { runId: 'linked-interrupted-run', model: 'local-replay', conversation: { id: 'interrupted-chat', assistantMessageId: 'interrupted-assistant' }, messages: [{ role: 'user', content: 'word '.repeat(5000) }] })).status).toBe(202);
  const stream = await replay('linked-interrupted-run');
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('text-delta');
  await stop();
  await reader.cancel().catch(() => {});
  await launch();
  const saved = await (await fetch(`${base}/api/v1/conversations/interrupted-chat`, { headers: headers() })).json() as { conversation: { messages: { id: string; content: string; complete: boolean; error: { code: string } }[] } };
  const answer = saved.conversation.messages.find((message) => message.id === 'interrupted-assistant');
  expect(answer?.content.length).toBeGreaterThan(0);
  expect(answer).toMatchObject({ complete: false, error: { code: 'run-interrupted' } });
}, 30_000);

test('apply_markdown_note updates a vault note pair from Markdown', async () => {
  const document = { ...createRichDocument('Proposal fixture', 'proposal-fixture'), body: markdownToNativeBody('Original text') };
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  expect((await post('/api/v1/rich-documents', document)).status).toBe(201);
  const notePath = 'programs/general/notes/proposal-fixture.md';
  const viewed = await (await post('/api/v1/tools/invoke', { id: 'builtin:view', input: { path: notePath } })).json() as { invocation: { result: { content: string } } };
  expect(viewed.invocation.result.content).toContain('Original text');
  const applied = await post('/api/v1/tools/invoke', { id: 'builtin:apply-markdown-note', input: { path: notePath, markdown: 'Revised text' }, confirmed: true });
  expect(applied.status).toBe(200);
  const again = await (await post('/api/v1/tools/invoke', { id: 'builtin:view', input: { path: notePath } })).json() as { invocation: { result: { content: string } } };
  expect(again.invocation.result.content).toContain('Revised text');
});

test('note trash is authenticated and recoverable across service restart without stale saves resurrecting it', async () => {
  const document = createRichDocument('Recoverable note', 'recoverable-note');
  const post = (path: string, body?: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  expect((await post('/api/v1/rich-documents', document)).status).toBe(201);
  expect((await fetch(`${base}/api/v1/rich-documents/${document.id}`, { method: 'DELETE' })).status).toBe(401);
  expect((await fetch(`${base}/api/v1/rich-documents/${document.id}`, { method: 'DELETE', headers: headers() })).status).toBe(200);
  expect((await fetch(`${base}/api/v1/rich-documents/${document.id}`, { headers: headers() })).status).toBe(404);
  const staleSave = await post('/api/v1/rich-documents', document);
  expect(staleSave.status).toBe(409);
  expect(await staleSave.json()).toEqual({ error: 'Restore this note before saving it.' });
  await stop(); await launch();
  expect((await fetch(`${base}/api/v1/rich-documents/${document.id}`, { headers: headers() })).status).toBe(404);
  expect(await (await fetch(`${base}/api/v1/rich-documents/trash`, { headers: headers() })).json()).toMatchObject({ documents: expect.arrayContaining([expect.objectContaining({ id: document.id, title: document.title })]) });
  const restored = await post(`/api/v1/rich-documents/${document.id}/restore`);
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({ document: { id: document.id, title: document.title, body: document.body } });
  expect((await fetch(`${base}/api/v1/rich-documents/${document.id}`, { headers: headers() })).status).toBe(200);
}, 30_000);


test('managed references save and reopen agents without losing exact identity, and source context reaches inference', async () => {
  lemonadeScenario = 'ready';
  expect((await fetch(`${base}/api/v1/local-ai/power`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: true }) })).status).toBe(200);
  const definition = { kind: 'preset', value: { id: 'research-managed-agent', name: 'Research agent', provider: 'obsolete', model: 'obsolete', modelReference: { providerId: 'managed-local', modelId: 'managed-chat', role: 'chat' }, instructions: 'Use supplied sources.', settings: { temperature: 0.2 }, knowledgeCollectionIds: [], skillIds: [], toolIds: [], updatedAt: '2026-10-18T00:00:00Z' } };
  const saved = await fetch(`${base}/api/v1/methods`, { method: 'POST', headers: headers(), body: JSON.stringify(definition) });
  expect(saved.status).toBe(201);
  expect(await saved.json()).toMatchObject({ definition: { value: { provider: 'managed-local', model: 'managed-chat', modelReference: definition.value.modelReference } } });
  const source = { chunkId: 'chunk-research', sourceVersionId: 'version-research', collectionId: 'sources', text: 'Recorded research evidence.', score: 0.9, resolved: true, anchor: { sourceVersionId: 'version-research', extractionVersion: 'anchor-v1', kind: 'text-range', startByte: 0, endByte: 27 } };
  const submitted = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: headers(), body: JSON.stringify({ runId: 'research-sources-run', provider: 'managed-local', model: 'managed-chat', context: { sources: [source], selection: 'Selected passage.' }, messages: [{ role: 'user', content: 'Summarize the evidence.' }] }) });
  expect(submitted.status).toBe(202);
  await (await fetch(`${base}/api/v1/runs/research-sources-run/events`, { headers: headers() })).text();
  const captured = lemonadeChatRequests.at(-1)!;
  expect(captured.model).toBe('managed-chat');
  expect(JSON.stringify(captured.messages)).toContain('chunk-research');
  expect(JSON.stringify(captured.messages)).toContain('version-research');
  expect(JSON.stringify(captured.messages)).toContain('Selected passage.');
  const history = await fetch(`${base}/api/v1/local-ai/download-history`, { headers: headers() });
  expect(history.ok).toBe(false);
});


test('scheduled actions run their existing steps with the chosen source and model', async () => {
  const catalog = await (await fetch(`${base}/api/v1/lab/apps`, { headers: headers() })).json() as { apps: { id: string; runPrompts: string[] }[] };
  const action = catalog.apps.find((item) => item.runPrompts.length > 1);
  if (!action) throw new Error('Expected a multi-step action.');
  const now = new Date().toISOString();
  const definition = { id: 'scheduled-action-test', path: 'automations/scheduled-action-test.automation.yaml', name: 'Research action', enabled: false, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'UTC', startDate: now.slice(0, 10) }, missedRunPolicy: 'skip', steps: [{ kind: 'action', actionPath: `actions/${action.id}.md`, source: 'A source for this action.', instructions: 'Focus on evidence.', providerId: 'openai', modelId: 'gpt-test' }], createdAt: now, updatedAt: now };
  const saved = await fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition }) });
  expect(saved.status).toBe(201);
  providerRequests = [];
  const run = await fetch(`${base}/api/v1/automations/${definition.id}/run`, { method: 'POST', headers: headers(), body: '{}' });
  expect(run.status).toBe(202);
  let history: { state: string; error: string | null; completedSteps: { result: unknown }[] }[] = [];
  for (let attempt = 0; attempt < 300; attempt++) {
    history = (await (await fetch(`${base}/api/v1/automations/history?automationId=${definition.id}`, { headers: headers() })).json() as { history: typeof history }).history;
    if (history.some((item) => item.state === 'succeeded' || item.state === 'failed')) break;
    await Bun.sleep(100);
  }
  if (history[0]?.state !== 'succeeded') throw new Error(history[0]?.error ?? 'Action did not complete.');
  expect(providerRequests).toHaveLength(action.runPrompts.length);
  expect(JSON.stringify(providerRequests[0]?.messages)).toContain('A source for this action.');
  expect(JSON.stringify(providerRequests[0]?.messages)).toContain('Focus on evidence.');
  expect(JSON.stringify(providerRequests[1]?.messages)).toContain('captured');
  expect(String(history[0]?.completedSteps[0]?.result)).toContain('captured');
}, 60_000);

test('scheduled prompt validation includes managed models and rejects unavailable references without replacement', async () => {
  const now = '2026-10-18T00:00:00Z';
  const definition = { id: 'managed-research-schedule', name: 'Research schedule', enabled: false, recurrence: { frequency: 'daily', interval: 1, weekdays: [], localTime: '09:00', timezone: 'Europe/Athens', startDate: '2030-01-01' }, missedRunPolicy: 'skip', steps: [{ kind: 'prompt', prompt: 'Summarize my sources.', modelReference: { providerId: 'managed-local', modelId: 'managed-chat', role: 'chat' } }], createdAt: now, updatedAt: now };
  const post = (value: unknown) => fetch(`${base}/api/v1/automations`, { method: 'POST', headers: headers(), body: JSON.stringify({ definition: value }) });
  expect((await post(definition)).status).toBe(201);
  const unavailable = { ...definition, steps: [{ kind: 'prompt', prompt: 'Summarize my sources.', modelReference: { providerId: 'managed-local', modelId: 'missing:org/model', role: 'chat' } }] };
  expect((await post(unavailable)).status).toBe(400);
  const saved = await (await fetch(`${base}/api/v1/automations`, { headers: headers() })).json() as { automations: { id: string; steps: unknown[] }[] };
  expect(saved.automations.find((item) => item.id === definition.id)?.steps).toEqual(definition.steps);
});

test('workspace reset stays empty after repeated reads and service restart', async () => {
  const reset = await fetch(`${base}/api/v1/data/workspace`, { method: 'DELETE', headers: headers(), body: JSON.stringify({ confirmed: true }) });
  expect(reset.status).toBe(200);
  for (let index = 0; index < 2; index++) expect(await (await fetch(`${base}/api/v1/rich-documents`, { headers: headers() })).json()).toEqual({ documents: [] });
  await stop(); await launch();
  expect(await (await fetch(`${base}/api/v1/rich-documents`, { headers: headers() })).json()).toEqual({ documents: [] });
  expect(await (await fetch(`${base}/api/v1/rich-documents/trash`, { headers: headers() })).json()).toEqual({ documents: [] });
}, 30_000);
