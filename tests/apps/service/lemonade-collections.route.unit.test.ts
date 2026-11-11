import { expect, test } from 'bun:test';
import { createLemonadeCollectionRoutes } from '../../../apps/service/src/lemonade-collections.route';
const descriptor = { instanceId: 'test', generation: 1, release: 'v2026.42.1', baseOrigin: 'http://127.0.0.1:13305', resolveSecret: () => 'private' };
const url = new URL('http://localhost/api/v1/local-ai/collections/operations');
const request = (value: unknown) => new Request(url, { method: 'POST', body: JSON.stringify(value) });
test('collection route dispatches named operations, keeps errors safe, and avoids caching', async () => {
  const route = createLemonadeCollectionRoutes(descriptor, { request: async () => Response.json({ status: 'success' }) });
  const response = await route(request({ operation: 'save-collection', definition: { model_name: 'user.Kit', recipe: 'collection.omni', components: ['Small'] } }), url);
  expect(response?.status).toBe(200); expect(await response?.json()).toEqual({ result: { status: 'success' } }); expect(response?.headers.get('cache-control')).toBe('no-store');
  expect((await route(request({ operation: 'anything' }), url))?.status).toBe(400);
  expect((await route(new Request(url, { method: 'POST', body: '{' }), url))?.status).toBe(400);
  expect((await route(new Request(url, { method: 'POST', body: 'x'.repeat(512 * 1024 + 1) }), url))?.status).toBe(400);
  expect(await route(new Request(url), url)).toBeNull();
  expect((await createLemonadeCollectionRoutes(null)(request({ operation: 'routing-defaults' }), url))?.status).toBe(503);
  const failed = createLemonadeCollectionRoutes(descriptor, { request: async () => new Response('secret upstream detail', { status: 409 }) });
  const rejected = await failed(request({ operation: 'save-collection', definition: { model_name: 'user.Kit', recipe: 'collection.omni', components: ['Small'] } }), url);
  expect(rejected?.status).toBe(502); const body = await rejected?.text(); expect(body).toContain('409'); expect(body).not.toContain('secret upstream detail');
});
