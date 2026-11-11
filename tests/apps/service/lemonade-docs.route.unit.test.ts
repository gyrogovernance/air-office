import { expect, test, spyOn } from 'bun:test';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import { createLemonadeStatusRoutes } from '../../../apps/service/src/lemonade-status.route';

const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'docs-fixture', generation: 1, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:43191', resolveSecret: () => 'server-only-docs-key' };
const url = new URL('http://air.test/api/v1/local-ai/docs');

test('runtime docs route retrieves installed /v1/docs with server credential and bounded offline response', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('http://127.0.0.1:43191/v1/docs');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-only-docs-key');
    return new Response('<!doctype html><title>Runtime API</title>', { headers: { 'content-type': 'text/html' } });
  }, { preconnect: fetch.preconnect }));
  try {
    const response = await createLemonadeStatusRoutes({ ...descriptor, resolveSecret: async () => 'server-only-docs-key' })(new Request(url), url);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await response?.text()).toContain('Runtime API');
  } finally { fetchMock.mockRestore(); }
});

test('runtime docs route rejects an oversized page and reports unavailable runtime', async () => {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } }), { preconnect: fetch.preconnect }));
  try {
    const oversized = await createLemonadeStatusRoutes(descriptor)(new Request(url), url);
    expect(oversized?.status).toBe(502);
    expect((await oversized?.json() as { error: { code: string } }).error.code).toBe('local-ai-docs-too-large');
    expect((await createLemonadeStatusRoutes(null)(new Request(url), url))?.status).toBe(503);
  } finally { fetchMock.mockRestore(); }
});
