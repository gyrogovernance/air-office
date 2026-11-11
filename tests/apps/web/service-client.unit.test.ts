import { expect, test } from 'bun:test';
import { createServiceClient, isAbortError } from '../../../apps/web/src/shared/service-client.hook';

test('cancelled fetches stay AbortError instead of service-unavailable', () => {
  expect(isAbortError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true);
  expect(isAbortError(new Error('signal is aborted without reason'))).toBe(true);
  expect(isAbortError(new Error('Failed to fetch'))).toBe(false);
});

test('an existing client refreshes its endpoint and session after native runtime activation', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const host = {
    __AIR_SERVICE_BASE__: 'http://127.0.0.1:45101',
    airDesktop: { invoke: async () => undefined, on: () => () => undefined, platform: 'win32', versions: { electron: '45', chrome: '156', node: '24' } },
    localStorage: { getItem: () => null, setItem() { /* test stub */ }, removeItem() { /* test stub */ } },
    location: { origin: 'air-office://localhost' }
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: host });
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, authorization: new Headers(init?.headers).get('authorization') });
    if (url.endsWith('/bootstrap')) return Response.json({ token: url.includes('45101') ? 'old-session' : 'new-session' });
    return Response.json({ ok: true });
  }, { preconnect: originalFetch.preconnect }) as typeof fetch;
  try {
    const client = createServiceClient();
    await client.json('/status');
    host.__AIR_SERVICE_BASE__ = 'http://127.0.0.1:45102';
    await client.json('/status');
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:45101/bootstrap', authorization: null },
      { url: 'http://127.0.0.1:45101/status', authorization: 'Bearer old-session' },
      { url: 'http://127.0.0.1:45102/bootstrap', authorization: null },
      { url: 'http://127.0.0.1:45102/status', authorization: 'Bearer new-session' }
    ]);
    expect(client.base).toBe(host.__AIR_SERVICE_BASE__);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow });
  }
});
