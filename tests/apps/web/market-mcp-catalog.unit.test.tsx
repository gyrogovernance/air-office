import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
import '../../support/web-dom.adapter';

const { act, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MarketMcpCatalog } = await import('../../../apps/web/src/market/market-mcp-catalog.component');
const { createServiceClient } = await import('../../../apps/web/src/shared/service-client.hook');
const requests: { path: string; body: unknown }[] = [];
const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/bootstrap') return Response.json({ token: 'test' });
  if (url.pathname === '/api/v1/market/mcp') return Response.json({ entries: [
    { id: 'remote', name: 'Remote search', description: 'Search public sources.', version: '1', sourceUrl: 'https://example.com', endpoint: 'https://example.com/mcp', transport: 'streamable-http', supported: true },
    { id: 'local', name: 'Local server', description: 'Local process.', version: '1', sourceUrl: 'https://example.com/local', endpoint: null, transport: 'stdio', supported: false },
  ], nextCursor: null });
  if (url.pathname === '/api/v1/tools/connections' && init?.method === 'POST') { requests.push({ path: url.pathname, body: JSON.parse(String(init.body)) }); return Response.json({}); }
  throw new Error('Unexpected request');
}, { preconnect: globalThis.fetch.preconnect }));
let host: HTMLElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = null; host = null; requests.length = 0; });
afterAll(() => { fetchMock.mockRestore(); });

test('MCP listing allows supported remote connections while disabling local-command entries', async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(MarketMcpCatalog, { client: createServiceClient(), onInstalled: () => undefined })); });
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('.market-row button')];
  expect(buttons.map((button) => button.disabled)).toEqual([false, true]);
  await act(async () => { buttons[0]!.click(); });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body).toMatchObject({ name: 'Remote search', kind: 'mcp', endpoint: 'https://example.com/mcp' });
  expect(host.textContent).toContain('disabled connection');
  expect(host.textContent).toContain('Settings → Tools');
});
