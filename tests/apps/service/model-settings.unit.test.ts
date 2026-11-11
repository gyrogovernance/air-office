import { expect, test, spyOn } from 'bun:test';
import { createModelSettingsRoutes } from '../../../apps/service/src/model-settings.route';
import { createModelConnectionSettings, type ModelConnectionSettingsOptions } from '@office/providers/service';
const routesFor = (options: ModelConnectionSettingsOptions) => createModelSettingsRoutes(createModelConnectionSettings(options));
import type { ModelConnection } from '@office/providers/domain';

const empty = (overrides: Partial<ModelConnection> = {}): ModelConnection => ({ id: 'cloud', name: 'Cloud', kind: 'openai-compatible', baseUrl: 'https://provider.example/v1', models: [], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null, ...overrides });

/** A credential store that reports one secret present and counts forget calls. */
function credentialStub(outcome: 'removed' | 'absent' | 'failed' = 'removed') {
  const state = { forgets: 0 };
  return { configured: async () => true, store: async () => {}, forget: async () => { state.forgets++; return outcome; }, forgetAll: async () => ({ removed: 0, failed: [] as string[] }), count: () => state.forgets };
}

test('saved setup discovers models with service credentials and reloads active connections', async () => {
  const connections = new Map<string, ModelConnection>();
  let reloads = 0;
  const credentialStore = credentialStub();
  const routes = routesFor({ store: { list: () => [...connections.values()], put: (item) => connections.set(item.id, item), remove: (id) => connections.delete(id), clearPersonalData: () => connections.clear() }, credentials: { resolve: async () => 'private-key' }, credentialStore, reload: () => { reloads++; } });
  const base = 'http://127.0.0.1/api/v1/model-connections';
  const call = (path: string, init?: RequestInit) => routes(new Request(path, init), new URL(path));
  const saved = await call(base, { method: 'PUT', body: JSON.stringify({ connection: empty({ models: ['manual-id'] }), secret: 'private-key' }) });
  expect(saved?.status).toBe(200); expect(reloads).toBe(2);
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => { expect(String(input)).toBe('https://provider.example/v1/models'); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-key'); return Response.json({ data: [{ id: 'model-b' }] }); }, { preconnect: fetch.preconnect }));
  try {
    const result = await call(`${base}/cloud/discover`, { method: 'POST' });
    const body = await result?.json() as { discovered: number; empty: boolean; connection: ModelConnection };
    expect(body.discovered).toBe(1); expect(body.empty).toBe(false);
    // Discovery records observation and keeps the manual ID as intent.
    expect(body.connection.models).toEqual(['manual-id']);
    expect(body.connection.observedModels).toEqual(['model-b']);
    expect(body.connection.discovery).toBe('success');
    expect(typeof body.connection.observedAt).toBe('string');
    expect(reloads).toBe(3);
    const listed = await call(base); const text = await listed?.text(); expect(text).toContain('credentialConfigured'); expect(text).not.toContain('private-key');
    const removed = await call(`${base}/cloud`, { method: 'DELETE' }); expect(removed?.status).toBe(200); expect(connections.size).toBe(0);
    expect(credentialStore.count()).toBe(1);
  } finally { fetchMock.mockRestore(); }
});

test('editing a saved connection keeps its observation and does not claim a listing it never ran', async () => {
  const existing = empty({ id: 'cloud', models: ['manual'], observedModels: ['live'], observedAt: '2026-01-01T00:00:00.000Z', discovery: 'success' });
  let stored: ModelConnection = existing;
  const routes = routesFor({ store: { list: () => [stored], put: (value) => { stored = value; }, remove: () => {}, clearPersonalData: () => { stored = existing; } }, credentials: { resolve: async () => null }, credentialStore: { configured: async () => false, store: async () => {}, forget: async () => 'removed', forgetAll: async () => ({ removed: 0, failed: [] }) }, reload: () => {} });
  const url = new URL('http://127.0.0.1/api/v1/model-connections');
  const response = await routes(new Request(url, { method: 'PUT', body: JSON.stringify({ ...existing, name: 'Renamed', models: ['manual', 'typed'] }) }), url);
  const body = await response?.json() as { connection: ModelConnection };
  expect(body.connection.name).toBe('Renamed');
  expect(body.connection.models).toEqual(['manual', 'typed']);
  expect(body.connection.observedModels).toEqual(['live']);
  expect(body.connection.discovery).toBe('success');
});

test('failed discovery records the outcome without replacing manual IDs or exposing upstream bodies', async () => {
  const connection = empty({ models: ['saved'] });
  let stored: ModelConnection = connection;
  const routes = routesFor({ store: { list: () => [stored], put: (value) => { stored = value; }, remove: () => {}, clearPersonalData: () => { stored = connection; } }, credentials: { resolve: async () => null }, credentialStore: { configured: async () => false, store: async () => {}, forget: async () => 'removed', forgetAll: async () => ({ removed: 0, failed: [] }) }, reload: () => {} });
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response('private upstream contents', { status: 401 }), { preconnect: fetch.preconnect }));
  try {
    const url = new URL('http://127.0.0.1/api/v1/model-connections/cloud/discover');
    const response = await routes(new Request(url, { method: 'POST' }), url);
    expect(response?.status).toBe(502);
    const text = await response?.text() ?? '';
    expect(text).not.toContain('private upstream contents');
    expect(stored.models).toEqual(['saved']);
    expect(stored.observedModels).toEqual([]);
    expect(stored.discovery).toBe('failed');
    expect(stored.discoveryError).toBeTruthy();
  } finally { fetchMock.mockRestore(); }
});

test('a reachable endpoint that returns no models is recorded as an empty success', async () => {
  const connection = empty({ models: ['saved'] });
  let stored: ModelConnection = connection;
  const routes = routesFor({ store: { list: () => [stored], put: (value) => { stored = value; }, remove: () => {}, clearPersonalData: () => { stored = connection; } }, credentials: { resolve: async () => null }, credentialStore: { configured: async () => false, store: async () => {}, forget: async () => 'removed', forgetAll: async () => ({ removed: 0, failed: [] }) }, reload: () => {} });
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ data: [] }), { preconnect: fetch.preconnect }));
  try {
    const url = new URL('http://127.0.0.1/api/v1/model-connections/cloud/discover');
    const body = await (await routes(new Request(url, { method: 'POST' }), url))?.json() as { discovered: number; empty: boolean; connection: ModelConnection };
    expect(body.discovered).toBe(0); expect(body.empty).toBe(true);
    expect(body.connection.discovery).toBe('empty');
    expect(body.connection.models).toEqual(['saved']);
  } finally { fetchMock.mockRestore(); }
});

test('connection settings and replacement key use one save request and report partial success when key storage fails', async () => {
  let stored: ModelConnection | null = null;
  let keyWrites = 0;
  const routes = routesFor({ store: { list: () => stored ? [stored] : [], put: (value) => { stored = value; }, remove: () => {}, clearPersonalData: () => { stored = null; } }, credentials: { resolve: async () => null }, credentialStore: { configured: async () => false, store: async () => { keyWrites++; throw new Error('do not echo secret'); }, forget: async () => 'removed', forgetAll: async () => ({ removed: 0, failed: [] }) }, reload: () => {} });
  const url = new URL('http://127.0.0.1/api/v1/model-connections');
  const secret = 'never-echo-this-key';
  const response = await routes(new Request(url, { method: 'PUT', body: JSON.stringify({ connection: empty({ models: ['manual'] }), secret }) }), url);
  expect(response?.status).toBe(503);
  const text = await response?.text() ?? '';
  expect(text).toContain('replacement key could not be stored');
  expect(text).not.toContain(secret);
  expect((stored as ModelConnection | null)?.models).toEqual(['manual']);
  expect(keyWrites).toBe(1);
});

test('a connection whose key cannot be removed is kept and the failure is reported', async () => {
  const connections = new Map<string, ModelConnection>([['cloud', empty()]]);
  let reloads = 0;
  const routes = routesFor({ store: { list: () => [...connections.values()], put: () => {}, remove: (id) => connections.delete(id), clearPersonalData: () => connections.clear() }, credentials: { resolve: async () => null }, credentialStore: { configured: async () => true, store: async () => {}, forget: async () => 'failed', forgetAll: async () => ({ removed: 0, failed: [] }) }, reload: () => { reloads++; } });
  const url = new URL('http://127.0.0.1/api/v1/model-connections/cloud');
  const response = await routes(new Request(url, { method: 'DELETE' }), url);
  expect(response?.status).toBe(502);
  expect(connections.size).toBe(1);
  expect(reloads).toBe(1);
});

test('AIR no longer starts model downloads on external Ollama servers', async () => {
  const routes = routesFor({ store: { list: () => [], put: () => {}, remove: () => {}, clearPersonalData: () => {} }, credentials: { resolve: async () => null }, credentialStore: credentialStub(), reload: () => {} });
  const url = new URL('http://127.0.0.1/api/v1/model-connections/ollama/pull');
  const response = await routes(new Request(url, { method: 'POST', body: JSON.stringify({ model: 'llama3.2' }) }), url);
  expect(response).toBeNull();
});

test('connection checking uses authenticated discovery without inventing a health endpoint or model readiness', async () => {
  const connection = empty();
  const routes = routesFor({ store: { list: () => [connection], put: () => { throw new Error('Checks must not publish discovery.'); }, remove: () => {}, clearPersonalData: () => {} }, credentials: { resolve: async () => 'protected-key' }, credentialStore: credentialStub(), reload: () => {} });
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('https://provider.example/v1/models'); expect(new Headers(init?.headers).get('authorization')).toBe('Bearer protected-key');
    return Response.json({ data: [{ id: 'model' }] });
  }, { preconnect: fetch.preconnect }));
  try {
    const url = new URL('http://127.0.0.1/api/v1/model-connections/cloud/health');
    const result = await (await routes(new Request(url), url))!.json() as { state: string; message: string };
    expect(result.state).toBe('reachable'); expect(result.message).toContain('Connection successful');
    expect(connection.discovery).toBe('unknown');
  } finally { fetchMock.mockRestore(); }
});
