import { expect, test } from 'bun:test';
import { createMarketDiscoveryRoutes, type MarketMcpEntry } from '../../../apps/service/src/market-discovery.route';

const manifest = { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'example.tools', description: 'Metadata preview', version: 'release candidate' };
async function invoke(route: ReturnType<typeof createMarketDiscoveryRoutes>, path = '/api/v1/market/mcp', body?: unknown) {
  const url = new URL(path, 'http://office');
  return (await route(new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), url))!;
}

test('MCP discovery fetches one bounded official latest-version page and preserves opaque cursor', async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const route = createMarketDiscoveryRoutes({ fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ servers: [
      { server: { name: 'org.example/remote', title: 'Remote', description: 'Remote tools', version: '1', remotes: [{ type: 'sse', url: 'https://remote.test/sse' }, { type: 'streamable-http', url: 'https://remote.test/mcp' }] } },
      { server: { name: 'org.example/local', description: 'Local only', version: '2', packages: [{ transport: { type: 'stdio' } }] } },
      { server: { name: 'org.example/legacy', version: '1', remotes: [{ type: 'sse', url: 'https://remote.test/sse' }] } },
      { server: { name: 'org.example/template', version: '1', remotes: [{ type: 'streamable-http', url: 'https://{tenant}.test/mcp' }] } },
      { server: { name: 'org.example/deleted', version: '1' }, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } } },
    ], metadata: { nextCursor: 'opaque/+ cursor=' } });
  } });
  const response = await invoke(route, '/api/v1/market/mcp?search=weather&cursor=old%2F%2B%20cursor%3D');
  const body = await response.json() as { entries: MarketMcpEntry[]; nextCursor: string };
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url.origin).toBe('https://registry.modelcontextprotocol.io');
  expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ limit: '30', version: 'latest', search: 'weather', cursor: 'old/+ cursor=' });
  expect(calls[0]!.init).toMatchObject({ redirect: 'error', credentials: 'omit' });
  expect(body.nextCursor).toBe('opaque/+ cursor=');
  expect(body.entries).toHaveLength(4);
  expect(body.entries[0]).toMatchObject({ id: 'org.example/remote', name: 'Remote', transport: 'streamable-http', endpoint: 'https://remote.test/mcp', supported: true });
  expect(body.entries[0]!.sourceUrl).toContain('org.example%2Fremote/versions/1');
  expect(body.entries.slice(1).every((entry) => !entry.supported && entry.endpoint === null)).toBe(true);
});

test('search bounds reject before fetching and unrelated routes are untouched', async () => {
  let calls = 0;
  const route = createMarketDiscoveryRoutes({ fetchImpl: async () => { calls++; return Response.json({}); } });
  expect((await invoke(route, `/api/v1/market/mcp?search=${'a'.repeat(201)}`)).status).toBe(400);
  expect((await invoke(route, `/api/v1/market/mcp?cursor=${'a'.repeat(2049)}`)).status).toBe(400);
  const other = new URL('http://office/api/v1/market/plugins');
  expect(await route(new Request(other), other)).toBeNull();
  expect(calls).toBe(0);
});

test('untrusted registry pages and upstream diagnostics are rejected safely', async () => {
  for (const upstream of [Response.json({ servers: Array.from({ length: 31 }, () => ({})) }), Response.json({ servers: [], metadata: { nextCursor: 4 } }), new Response('private upstream trace', { status: 500 }), new Response('{invalid')]) {
    const route = createMarketDiscoveryRoutes({ fetchImpl: async () => upstream });
    const response = await invoke(route);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private upstream trace');
  }
});

test('plugin inspection validates metadata without fetching schemas, packages, archives or scripts', async () => {
  const calls: string[] = [];
  const route = createMarketDiscoveryRoutes({ fetchImpl: async (url) => {
    calls.push(url.href);
    return Response.json({ ...manifest, unknown: { command: 'never execute' }, extensions: { 'org.example.client': { scripts: ['run.sh'] } } });
  } });
  const response = await invoke(route, '/api/v1/market/plugins/inspect', { url: 'https://plugins.example/tools/plugin.json' });
  const preview = await response.json();
  expect(response.status).toBe(200);
  expect(calls).toEqual(['https://plugins.example/tools/plugin.json']);
  expect(preview).toMatchObject({ name: 'example.tools', mode: 'metadata-preview', installable: false, validation: 'manifest-only', version: 'release candidate' });
  expect(preview.warnings).toEqual(['Ignored unknown manifest field: unknown.', 'Ignored unsupported client extension namespaces.']);
  expect(preview.unsupportedComponents.map((item: { component: string }) => item.component)).toEqual(['skills', 'mcp', 'extensions']);
  expect(preview.manifest.unknown).toBeUndefined();
  expect(preview.manifest.extensions).toBeUndefined();
});

test('plugin metadata follows required types and name rules while optional URL and version values remain strings', async () => {
  for (const invalid of [{ ...manifest, name: 'Uppercase' }, { ...manifest, name: 'double--dash' }, { ...manifest, name: 'double..dot' }, { ...manifest, name: '-start' }, { ...manifest, $schema: 'https://untrusted/schema' }, { ...manifest, version: 2 }, { ...manifest, author: { script: 'run' } }, { ...manifest, keywords: [1] }]) {
    const response = await invoke(createMarketDiscoveryRoutes({ fetchImpl: async () => Response.json(invalid) }), '/api/v1/market/plugins/inspect', { url: 'https://plugins.example/plugin.json' });
    expect(response.status).toBe(422);
  }
  const route = createMarketDiscoveryRoutes({ fetchImpl: async () => Response.json({ ...manifest, homepage: 'opaque string', extensions: 'ignored' }) });
  const response = await invoke(route, '/api/v1/market/plugins/inspect', { url: 'http://localhost:8080/plugin.json' });
  expect(response.status).toBe(200);
  expect((await response.json()).warnings).toContain('Ignored non-object extensions field.');
  const ignored = createMarketDiscoveryRoutes({ fetchImpl: async () => Response.json({ ...manifest, extensions: { 'org.example': 'client-owned opaque value' } }) });
  expect((await invoke(ignored, '/api/v1/market/plugins/inspect', { url: 'https://plugins.example/plugin.json' })).status).toBe(200);
});

test('plugin source rejects archives, non-HTTPS remote URLs, redirects and embedded credentials', async () => {
  let calls = 0;
  const route = createMarketDiscoveryRoutes({ fetchImpl: async () => { calls++; return Response.json(manifest); } });
  for (const url of ['https://plugins.example/plugin.zip', 'file:///plugin.json', 'http://remote.example/plugin.json', 'https://user:pass@remote.example/plugin.json', 'https://remote.example/plugin.json?token=secret', 'https://remote.example/plugin.json#fragment']) {
    expect((await invoke(route, '/api/v1/market/plugins/inspect', { url })).status).toBe(400);
  }
  expect(calls).toBe(0);
  const redirect = createMarketDiscoveryRoutes({ fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://another.example/plugin.json' } }) });
  expect((await invoke(redirect, '/api/v1/market/plugins/inspect', { url: 'https://remote.example/plugin.json' })).status).toBe(502);
});

test('metadata reading enforces declared and streamed body size limits and cancels oversized streams', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(128_001)); }, cancel() { cancelled = true; } });
  const route = createMarketDiscoveryRoutes({ fetchImpl: async () => new Response(stream) });
  expect((await invoke(route, '/api/v1/market/plugins/inspect', { url: 'https://remote.example/plugin.json' })).status).toBe(502);
  expect(cancelled).toBe(true);
  const declared = createMarketDiscoveryRoutes({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '1000001' } }) });
  expect((await invoke(declared)).status).toBe(502);
});

test('stalled streaming bodies terminate under the discovery deadline', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const route = createMarketDiscoveryRoutes({ timeoutMs: 10, fetchImpl: async () => new Response(stream) });
  expect((await invoke(route)).status).toBe(504);
  expect(cancelled).toBe(true);
});
