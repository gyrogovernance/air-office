import { expect, test } from 'bun:test';
import { createLemonadeStatusRoutes } from '../../../apps/service/src/lemonade-status.route';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

const descriptor: LemonadeRuntimeDescriptor = {
  instanceId: 'route-instance', generation: 9, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:8000',
  resolveSecret: () => 'server-only-secret'
};
const url = new URL('http://service.test/api/v1/local-ai/status');

test('Lemonade status route responds only for its GET endpoint', async () => {
  const route = createLemonadeStatusRoutes(descriptor);
  expect(await route(new Request(url, { method: 'POST' }), url)).toBeNull();
  expect(await route(new Request('http://service.test/other'), new URL('http://service.test/other'))).toBeNull();
});

test('Lemonade status route returns no-store status and safe mapped failures', async () => {
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    return new URL(request.url).pathname === '/v1/health'
      ? Response.json({ status: 'ready', ready: true })
      : Response.json({ platform: 'fixture' });
  } });
  const healthyDescriptor: LemonadeRuntimeDescriptor = {
    ...descriptor,
    baseOrigin: `http://127.0.0.1:${upstream.port}`,
    resolveSecret: async () => 'server-only-secret'
  };
  try {
    const response = await createLemonadeStatusRoutes(healthyDescriptor)(new Request(url), url);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    const payload = await response!.text();
    expect(payload).toContain('ready');
    expect(payload).not.toContain('server-only-secret');
  } finally {
    upstream.stop(true);
  }

  const failureDescriptor: LemonadeRuntimeDescriptor = { ...descriptor, baseOrigin: 'file:///invalid' };
  const failed = await createLemonadeStatusRoutes(failureDescriptor)(new Request(url), url);
  expect(failed?.status).toBe(503);
  expect(await failed!.json()).toMatchObject({ error: { code: 'local-ai-protocol' } });
});

test('AIR service integration requires its bearer token before routing Lemonade status', async () => {
  const source = await Bun.file(new URL('../../../apps/service/src/application.entry.ts', import.meta.url)).text();
  expect(source).toContain("if (!authorization.startsWith('Bearer ') || !tokenEqual(authorization.slice(7)))");
  expect(source).toContain('const lemonadeStatusResponse = await lemonadeStatusRoutes(request, url)');
  expect(source.indexOf("if (!authorization.startsWith('Bearer ')")).toBeLessThan(source.indexOf('const lemonadeStatusResponse = await lemonadeStatusRoutes(request, url)'));
});
