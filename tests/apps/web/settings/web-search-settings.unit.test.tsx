import { expect, spyOn, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { WebSearchSettings } = await import('../../../../apps/web/src/settings/web-search-settings.component');

test('free search can save loader settings without requiring a self-hosted address', async () => {
  const writes: unknown[] = [];
  const state = { configured: true, enabled: true, builtIn: true, provider: 'duckduckgo', endpoint: null, reachable: null, timeoutMs: 15000, maxConcurrentRequests: 1, verifySsl: true, bypassWebLoader: false, trustProxyEnvironment: true, region: 'wt-wt' };
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === '/bootstrap') return Response.json({ token: 'test-token' });
    if (path === '/api/v1/bootstrap') return Response.json({ authenticated: true, protocol: 1 });
    if (path === '/api/v1/web-search') {
      if (init?.method === 'PUT') writes.push(JSON.parse(String(init.body)));
      return Response.json(state);
    }
    throw new Error(`Unexpected path ${path}`);
  }, { preconnect: globalThis.fetch.preconnect }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<WebSearchSettings/>); });
    const save = [...host.querySelectorAll('button')].find((button) => /save settings/i.test(button.textContent ?? ''));
    if (!save) throw new Error('Missing settings save action');
    expect(save.disabled).toBe(false);
    await act(async () => { save.click(); });
    expect(writes).toEqual([{ endpoint: null, timeoutMs: 15000, maxConcurrentRequests: 1, verifySsl: true, bypassWebLoader: false, trustProxyEnvironment: true, region: 'wt-wt' }]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    mock.mockRestore();
  }
});
