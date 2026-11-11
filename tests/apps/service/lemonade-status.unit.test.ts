import { expect, spyOn, test } from 'bun:test';
import { createLemonadeStatusRoutes } from '../../../apps/service/src/lemonade-status.route';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

test('operation route rejects unknown proxy operations and forwards only named operations', async () => {
  const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'route-fixture', generation: 1, release: '2026.42.1', baseOrigin: 'http://lemonade.test', resolveSecret: () => 'private' };
  const route = createLemonadeStatusRoutes(descriptor);
  const url = new URL('http://air.test/api/v1/local-ai/operations');
  const invalid = await route(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'proxy', path: '/internal/config' }) }), url);
  expect(invalid?.status).toBe(400);
  const missing = await createLemonadeStatusRoutes(null)(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'health' }) }), url);
  expect(missing?.status).toBe(503);
  const unknown = await route(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'unknown', path: '/internal/config' }) }), url);
  expect(unknown?.status).toBe(400);
});

test('browser operations reject privileged config and malformed controls without upstream calls', async () => {
  const route = createLemonadeStatusRoutes({ instanceId: 'safety', generation: 1, release: '2026.42.1', baseOrigin: 'http://lemonade.test', resolveSecret: () => 'private' });
  const url = new URL('http://air.test/api/v1/local-ai/operations');
  const transport = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => Response.json({ ok: true }), { preconnect: globalThis.fetch.preconnect }));
  try {
    for (const operation of [
      { operation: 'set-config', input: { key: 'extra_models_dir', value: '/browser/path' } },
      { operation: 'set-config', input: { key: 'models_dir', value: '/browser/path' } },
      { operation: 'set-config', input: { key: 'host', value: '0.0.0.0' } },
      { operation: 'set-config', input: { key: 'cloud', value: { enabled: true } } },
      { operation: 'set-config', input: { key: 'telemetry', value: { enabled: true } } },
      { operation: 'set-config', input: { key: 'max_loaded_models', value: 0 } },
      { operation: 'set-config' },
      { operation: 'job-control', id: 'job-1', action: '../resume' },
      { operation: 'slot-control', id: 0, action: 'erase?other=true' },
      { operation: 'slot-control', id: 0, action: 'save', input: { filename: '../secret' } },
    ]) {
      const response = await route(new Request(url, { method: 'POST', body: JSON.stringify(operation) }), url);
      expect(response?.status).toBe(400);
      expect(await response?.json()).toMatchObject({ error: { code: 'local-ai-invalid-request' } });
    }
    expect(transport).not.toHaveBeenCalled();
    const valid = await route(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'set-config', input: { key: 'ctx_size', value: -1 } }) }), url);
    expect(valid?.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({ ctx_size: -1 });
  } finally { transport.mockRestore(); }
});

test('route accepts typed named operation bodies only', async () => {
  const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'route-fixture', generation: 1, release: '2026.42.1', baseOrigin: 'http://lemonade.test', resolveSecret: () => 'private' };
  const route = createLemonadeStatusRoutes(descriptor);
  const url = new URL('http://air.test/api/v1/local-ai/operations');
  const unavailable = await createLemonadeStatusRoutes(null)(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'install-dry-run', input: { recipe: 'llamacpp', backend: 'cpu' } }) }), url);
  expect(unavailable?.status).toBe(503);
  const invalid = await route(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'install', input: { name: 'anything' } }) }), url);
  expect(invalid?.status).toBe(400);
});

test('safe operation errors use Local AI wording without dependency names', async () => {
  const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'copy', generation: 1, release: '2026.42.1', baseOrigin: 'http://lemonade.test', resolveSecret: () => 'private' };
  const route = createLemonadeStatusRoutes(descriptor);
  const url = new URL('http://air.test/api/v1/local-ai/operations');
  const transport = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response('upstream rejected', { status: 502 }), { preconnect: globalThis.fetch.preconnect }));
  try {
    const response = await route(new Request(url, { method: 'POST', body: JSON.stringify({ operation: 'health' }) }), url);
    const body = await response?.json() as { error?: { message?: string } };
    expect(response?.status).toBeGreaterThanOrEqual(400);
    expect(body.error?.message ?? '').toContain('Local AI');
    expect(JSON.stringify(body)).not.toMatch(/Lemonade|lemond|React Aria|TanStack/i);
  } finally { transport.mockRestore(); }
});
