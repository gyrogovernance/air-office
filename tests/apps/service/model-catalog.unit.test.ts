import { expect, test } from 'bun:test';
import { createModelCatalogRoutes } from '../../../apps/service/src/model-catalog.route';

test('Market has an offline catalog without claiming installed models or hardware compatibility', async () => {
  const route = createModelCatalogRoutes(null);
  const response = await route(new Request('http://office/api/v1/model-catalog'), new URL('http://office/api/v1/model-catalog'));
  const catalog = await response!.json();
  expect(catalog.source).toBe('bundled');
  expect(catalog.models.length).toBeGreaterThan(100);
  expect(catalog.models.find((model: { id: string }) => model.id === 'Qwen3-0.6B-GGUF')).toMatchObject({ downloaded: null, recipe: 'llamacpp' });
  expect(catalog.models.every((model: { downloaded: unknown }) => model.downloaded === null)).toBe(true);
});

test('the removed processor-only shortcut cannot report partial hardware as compatibility', async () => {
  const route = createModelCatalogRoutes(null);
  const url = new URL('http://office/api/v1/model-catalog/computer');
  expect(await route(new Request(url), url)).toBeNull();
});

test('Market uses the runtime catalog and falls back safely if its host fails', async () => {
  let unavailable = false;
  const seen: string[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    seen.push(new URL(request.url).search);
    if (unavailable) return new Response('private upstream diagnostic', { status: 503 });
    return Response.json({ data: [{ id: 'test-chat', recipe: 'llamacpp', labels: ['chat'], downloaded: true, size: 1.5 }, { id: 'cloud.test', recipe: 'cloud' }] });
  } });
  try {
    const route = createModelCatalogRoutes({ instanceId: 'catalog-test', generation: 1, release: '2026.42.1', baseOrigin: server.url.origin, resolveSecret: () => 'fixture-key' });
    const url = new URL('http://office/api/v1/model-catalog');
    const response = await route(new Request(url), url);
    const catalog = await response!.json();
    expect(seen).toEqual(['?show_all=true']);
    expect(catalog.source).toBe('runtime');
    expect(catalog.models).toEqual([{ id: 'test-chat', recipe: 'llamacpp', labels: ['chat'], downloaded: true, sizeGB: 1.5, suggested: false }]);
    unavailable = true;
    const fallback = await route(new Request(url), url);
    const text = await fallback!.text();
    expect(JSON.parse(text).source).toBe('bundled');
    expect(text).not.toContain('private upstream diagnostic');
    expect(text).not.toContain('fixture-key');
  } finally { server.stop(true); }
});
