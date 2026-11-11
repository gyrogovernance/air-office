import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelConnectionStore } from '../../../packages/providers/src/model-connections.adapter';
import { parseModelConnection, selectableModels, discoverySummary } from '../../../packages/providers/src/providers.domain.public';
import { listConnectionModels } from '../../../packages/providers/src/model-discovery.adapter';
import { OpenAiCompatibleConnection } from '../../../packages/providers/src/copilot-provider.adapter';
import type { ModelConnection } from '../../../packages/providers/src/providers.domain.public';

const empty = (overrides: Partial<ModelConnection> = {}): ModelConnection => ({ id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://provider.example/v1/', models: [], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null, ...overrides });

test('connections survive reopening and reject credentials in endpoints', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-models-'));
  try {
    const path = join(root, 'models.sqlite');
    const store = createModelConnectionStore(path);
    store.put(parseModelConnection({ ...empty({ models: ['model-a'] }), secret: 'must-not-persist' })); store.close();
    const reopened = createModelConnectionStore(path);
    expect(reopened.list()).toEqual([empty({ baseUrl: 'https://provider.example/v1', models: ['model-a'] })]);
    expect(JSON.stringify(reopened.list())).not.toContain('must-not-persist');
    reopened.remove('cloud'); expect(reopened.list()).toEqual([]); reopened.close();
    expect(() => parseModelConnection({ ...empty(), baseUrl: 'https://user:secret@example.com/v1' })).toThrow();
    expect(() => parseModelConnection({ ...empty(), baseUrl: 'file:///tmp' })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stored connection from before identity was split reopens with its models as manual intent', () => {
  const root = mkdtempSync(join(tmpdir(), 'office-models-'));
  try {
    const path = join(root, 'models.sqlite');
    const db = new Database(path);
    db.exec('CREATE TABLE provider_connections (id TEXT PRIMARY KEY, configuration TEXT NOT NULL)');
    db.query('INSERT INTO provider_connections VALUES (?, ?)').run('cloud', JSON.stringify({ id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', models: ['legacy-model'], imageModels: [] })); db.close();
    const reopened = createModelConnectionStore(path);
    const [connection] = reopened.list();
    expect(connection?.models).toEqual(['legacy-model']); expect(connection?.observedModels).toEqual([]);
    expect(connection?.observedAt).toBeNull(); expect(connection?.discovery).toBe('unknown'); reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cloud discovery preserves the configured API path', async () => {
  let endpoint = '';
  const fetchImpl = Object.assign(async (input: RequestInfo | URL) => { endpoint = String(input); return Response.json({ data: [{ id: 'real-model' }] }); }, { preconnect: fetch.preconnect });
  const provider = new OpenAiCompatibleConnection({ id: 'cloud', baseUrl: 'https://provider.example/v1', fetchImpl });
  expect(await provider.listModels()).toEqual({ ok: true, models: ['real-model'], empty: false });
  expect(endpoint).toBe('https://provider.example/v1/models');
});

test('ChatGPT discovery uses visible model slugs rather than internal IDs', async () => {
  const result = await listConnectionModels({ kind: 'chatgpt-signin', baseUrl: 'https://api.openai.com/v1', fetchImpl: Object.assign(async () => Response.json({ models: [{ slug: 'gpt-visible', visibility: 'list', id: 'internal-1', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'ultra' }] }, { slug: 'gpt-hidden', visibility: 'hidden', id: 'internal-2' }] }), { preconnect: fetch.preconnect }) });
  expect(result).toEqual({ ok: true, models: ['gpt-visible'], empty: false, reasoningByModel: { 'gpt-visible': { levels: ['low', 'medium', 'high'], defaultLevel: 'medium' } } });
});

test('a reachable but empty listing is reported as success with no models', async () => {
  const result = await listConnectionModels({ kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', fetchImpl: Object.assign(async () => Response.json({ data: [] }), { preconnect: fetch.preconnect }) });
  expect(result).toEqual({ ok: true, models: [], empty: true });
});

test('a failed listing is classified instead of silently falling back to configured IDs', async () => {
  expect(await listConnectionModels({ kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', fetchImpl: Object.assign(async () => new Response('private', { status: 401 }), { preconnect: fetch.preconnect }) })).toMatchObject({ ok: false, reason: 'auth', status: 401 });
  expect(await listConnectionModels({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', fetchImpl: Object.assign(async () => Response.json({ unexpected: true }), { preconnect: fetch.preconnect }) })).toMatchObject({ ok: false, reason: 'parse' });
});

test('malformed rows and oversized responses fail without erasing a listing as an empty success', async () => {
  for (const payload of [{ data: [{ missing: 'id' }] }, { data: [{ id: ' ' }] }, { data: Array.from({ length: 1001 }, () => ({ id: 'id' })) }, { data: [], padding: 'x'.repeat(1024 * 1024) }]) {
    expect(await listConnectionModels({ kind: 'openai-compatible', baseUrl: 'https://example.com', fetchImpl: async () => Response.json(payload) })).toMatchObject({ ok: false, reason: 'parse' });
  }
});

test('a caller signal does not disable the deadline while the response body stalls', async () => {
  let cancelled = false; const controller = new AbortController();
  expect(await listConnectionModels({ kind: 'openai-compatible', baseUrl: 'https://example.com', signal: controller.signal, timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) })).toMatchObject({ ok: false, reason: 'timeout' });
  expect(cancelled).toBe(true);
});

test('credential read errors and caller cancellation stay explicit without exposing details', async () => {
  const failed = await listConnectionModels({ kind: 'openai-compatible', baseUrl: 'https://example.com', credential: async () => { throw new Error('private credential store detail'); } });
  expect(failed).toMatchObject({ ok: false, reason: 'auth' }); expect(JSON.stringify(failed)).not.toContain('private credential');
  const controller = new AbortController(); controller.abort();
  expect(await listConnectionModels({ kind: 'ollama', baseUrl: 'https://example.com', signal: controller.signal, fetchImpl: async (_input, options) => { options?.signal?.throwIfAborted(); return Response.json({ models: [] }); } })).toMatchObject({ ok: false, reason: 'network', message: 'The listing was cancelled.' });
});

test('selectable models keep observed and manual IDs without duplicates and never merge into one stored list', () => {
  const connection = empty({ models: ['manual', 'shared'], observedModels: ['shared', 'live'] });
  expect(selectableModels(connection)).toEqual(['shared', 'live', 'manual']);
  expect(discoverySummary({ ...connection, discovery: 'success', observedAt: new Date().toISOString(), observedModels: ['shared', 'live'] })).toContain('2 models');
  expect(discoverySummary({ ...connection, discovery: 'failed', discoveryError: 'The endpoint rejected the credential.' })).toBe('The endpoint rejected the credential.');
  expect(discoverySummary(empty())).toBe('Not discovered yet.');
});

test('native discovery uses protocol authentication and keeps nonsecret routing headers', async () => {
  for (const kind of ['anthropic', 'gemini'] as const) {
    let calls = 0;
    const result = await listConnectionModels({ kind, baseUrl: 'https://provider.example/native', credential: async () => 'protected-key', headers: { 'x-organization': 'team' }, fetchImpl: async (input, init) => {
      calls++; expect(new URL(String(input)).pathname).toBe('/native/models');
      const headers = new Headers(init?.headers);
      expect(headers.get(kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key')).toBe('protected-key');
      expect(headers.get('authorization')).toBeNull(); expect(headers.get('x-organization')).toBe('team');
      return Response.json(kind === 'anthropic' ? { data: [{ id: 'claude' }] } : { models: [{ name: 'models/gemini' }] });
    } });
    expect(result).toEqual({ ok: true, models: [kind === 'anthropic' ? 'claude' : 'models/gemini'], empty: false }); expect(calls).toBe(1);
  }
  expect(await listConnectionModels({ kind: 'azure-openai', baseUrl: 'https://azure.example', fetchImpl: async () => { throw new Error('must not invent discovery'); } })).toMatchObject({ ok: false, reason: 'not-found' });
});

test('nonsecret settings reject authentication headers, malformed metadata and invalid capability claims', () => {
  for (const headers of [{ Authorization: 'protected' }, { 'x-api-key': 'protected' }, { Cookie: 'protected' }, { 'x-meta': 'line\r\nbreak' }, { Host: 'other.example' }]) expect(() => parseModelConnection({ ...empty(), headers })).toThrow();
  for (const modelCapabilities of [{ model: { tools: 'yes' } }, { model: { contextWindow: -1 } }, { model: { contextWindow: 0.5 } }, { model: { unexpected: {} } }]) expect(() => parseModelConnection({ ...empty(), modelCapabilities })).toThrow();
  expect(parseModelConnection({ ...empty(), headers: { 'X-Organization': 'team' }, modelCapabilities: { model: { tools: 'supported', contextWindow: 8192 } } })).toMatchObject({ headers: { 'x-organization': 'team' }, modelCapabilities: { model: { tools: 'supported', contextWindow: 8192 } } });
});

test('native catalogue pagination keeps auth and rejects repeated cursors instead of returning a partial list', async () => {
  for (const kind of ['anthropic', 'gemini'] as const) {
    let calls = 0;
    const result = await listConnectionModels({ kind, baseUrl: 'https://provider.example/v1', credential: async () => 'key', fetchImpl: async (input, init) => {
      const url = new URL(String(input)); calls++;
      expect(new Headers(init?.headers).get(kind === 'anthropic' ? 'x-api-key' : 'x-goog-api-key')).toBe('key');
      if (calls === 2) expect(url.searchParams.get(kind === 'anthropic' ? 'after_id' : 'pageToken')).toBe('next');
      return Response.json(kind === 'anthropic' ? { data: [{ id: 'model-' + calls }], has_more: calls === 1, last_id: 'next' } : { models: [{ name: 'models/model-' + calls }], ...(calls === 1 ? { nextPageToken: 'next' } : {}) });
    } });
    expect(result).toMatchObject({ ok: true, models: kind === 'anthropic' ? ['model-1', 'model-2'] : ['models/model-1', 'models/model-2'] });
  }
  expect(await listConnectionModels({ kind: 'gemini', baseUrl: 'https://provider.example/v1', fetchImpl: async () => Response.json({ models: [{ name: 'models/model' }], nextPageToken: 'same' }) })).toMatchObject({ ok: false, reason: 'parse' });
});
