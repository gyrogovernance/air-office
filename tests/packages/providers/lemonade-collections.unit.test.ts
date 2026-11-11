import { expect, test } from 'bun:test';
import { LemonadeCollectionsAdapter, parseCollectionDefinition, runCollectionOperation } from '../../../packages/providers/src/lemonade-collections.adapter';
import type { LemonadeRuntimeDescriptor } from '../../../packages/providers/src/lemonade-status.adapter';
const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'test', generation: 1, release: 'v2026.42.1', baseOrigin: 'http://127.0.0.1:13305', resolveSecret: () => 'private' };
const omni = { model_name: 'user.Kit', recipe: 'collection.omni', components: ['builtin.Small', 'user.Voice'] };
const policy = { version: '1' as const, model_name: 'user.Router', recipe: 'collection.router' as const, components: ['builtin.Small', 'user.Big'], routing: { candidates: ['builtin.Small', 'user.Big'], default_model: 'builtin.Small', rules: [{ id: 'code', match: { any: [{ keywords_any: ['function'] }, { min_chars: 4000 }] }, route_to: 'user.Big', outputs: { reason: 'code' } }] } };
test('collection schema retains stable references, recursive matches, and outputs', () => {
  expect(parseCollectionDefinition(policy)).toEqual(policy);
  expect(parseCollectionDefinition(omni).components).toEqual(['builtin.Small', 'user.Voice']);
  expect(() => parseCollectionDefinition({ ...omni, system_prompt: 'missing placeholders' })).toThrow();
  expect(() => parseCollectionDefinition({ ...policy, routing: { ...policy.routing, default_model: 'missing' } })).toThrow();
  expect(() => parseCollectionDefinition({ ...omni, model_name: 'user.builtin.X' })).toThrow();
  expect(() => parseCollectionDefinition({ ...omni, models: [{ model_name: 'builtin.Small', recipe: 'llamacpp', checkpoint: 'C:/private/model.gguf' }] })).toThrow();
  expect(() => parseCollectionDefinition({ ...policy, routing: { ...policy.routing, router: { type: 'llm', model: 'user.Big', prompt: 'Choose' } } })).toThrow();
});
test('save registers definition, import uses pull with embedded definitions and no identity rewriting', async () => {
  const calls: { path: string; body: unknown; authorization: string | null }[] = [];
  const adapter = new LemonadeCollectionsAdapter(descriptor, { request: async (url, init) => { calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get('authorization') }); return Response.json({ status: 'success' }); } });
  await adapter.saveCollection(policy);
  const imported = { ...omni, models: [{ model_name: 'builtin.Small', recipe: 'llamacpp', checkpoints: { main: 'org/repo:Q4_K_M' } }] };
  await adapter.importCollection(imported);
  expect(calls[0].path).toBe('/v1/models/register'); expect(calls[0].body).toEqual(policy); expect(calls[0].authorization).toBe('Bearer private');
  expect(calls[1].path).toBe('/v1/pull'); expect(calls[1].body).toEqual({ ...imported, stream: false, subscribe: false });
  await expect(adapter.saveCollection(imported)).rejects.toMatchObject({ code: 'invalid-request' });
});
test('export fetches component definitions and removes runtime metadata', async () => {
  const paths: string[] = [];
  const adapter = new LemonadeCollectionsAdapter(descriptor, { request: async (url) => { const path = new URL(String(url)).pathname; paths.push(path); return Response.json(path.endsWith('user.Kit') ? { ...omni, downloaded: true, suggested: true, created: 7 } : { id: 'ignored-display-id', recipe: 'llamacpp', checkpoints: { main: 'org/repo:Q4_K_M' }, downloaded: true, suggested: false }); } });
  const exported = await adapter.exportCollection('user.Kit');
  expect(exported.model_name).toBe('user.Kit'); expect(exported.models?.map((model) => model.model_name)).toEqual(omni.components);
  expect(JSON.stringify(exported)).not.toContain('downloaded'); expect(JSON.stringify(exported)).not.toContain('suggested');
  expect(paths).toHaveLength(3); expect(parseCollectionDefinition(exported)).toEqual(exported);
});
test('named operations reject unknown fields, expose defaults, and preserve routing test flags', async () => {
  let body: unknown;
  const adapter = new LemonadeCollectionsAdapter(descriptor, { request: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ decision: { model: 'user.Big' } }); } });
  expect(await runCollectionOperation(adapter, { operation: 'routing-defaults' })).toMatchObject({ mode: 'llm', systemPrompt: null });
  await runCollectionOperation(adapter, { operation: 'test-collection-routing', definition: policy, prompt: 'function test', has_images: true });
  expect(body).toMatchObject({ policy, prompt: 'function test', has_images: true });
  await expect(runCollectionOperation(adapter, { operation: 'import-collection', definition: omni, path: '/internal/shutdown' })).rejects.toMatchObject({ code: 'invalid-request' });
});
test('transport classifies errors, bounds streaming bytes, and stops before network when cancelled', async () => {
  const upstream = new LemonadeCollectionsAdapter(descriptor, { request: async () => new Response('private content', { status: 409 }) });
  await expect(upstream.saveCollection(omni)).rejects.toMatchObject({ code: 'upstream', status: 409 });
  const oversized = new LemonadeCollectionsAdapter(descriptor, { maxResponseBytes: 4, request: async () => Response.json({ data: 'too big' }) });
  await expect(oversized.saveCollection(omni)).rejects.toMatchObject({ code: 'protocol' });
  let called = false; const cancelled = new LemonadeCollectionsAdapter(descriptor, { request: async () => { called = true; return Response.json({}); } });
  await expect(cancelled.saveCollection(omni, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'cancelled' }); expect(called).toBe(false);
});
