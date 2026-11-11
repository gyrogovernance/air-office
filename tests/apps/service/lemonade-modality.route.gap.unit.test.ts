import { expect, spyOn, test } from 'bun:test';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import { createLemonadeModalityRoutes } from '../../../apps/service/src/lemonade-modality.route';

const descriptor: LemonadeRuntimeDescriptor = { instanceId: 'fixture', generation: 2, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:43192', resolveSecret: () => 'private-runtime-key' };
const base = 'http://air.test/api/v1/local-ai';

test('named classify and tokenize routes call their pinned runtime endpoints with private auth', async () => {
  const calls: Request[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init); calls.push(request);
    return Response.json(new URL(request.url).pathname.endsWith('classify') ? { object: 'classification', model: 'filter', labels: { safe: 0.9 } } : { tokens: [1, 2], count: 2 });
  }, { preconnect: fetch.preconnect }));
  try {
    const route = createLemonadeModalityRoutes(descriptor);
    for (const [path, body] of [['/classify', { input: 'hello', model: 'filter', top_k: 3 }], ['/tokenize', { content: 'hello', with_pieces: true }]] as const) {
      const url = new URL(`${base}${path}`);
      const response = await route(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), url);
      expect(response?.status).toBe(200);
      expect(response?.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls.map((request) => new URL(request.url).pathname)).toEqual(['/v1/classify', '/v1/tokenize']);
    expect(calls.every((request) => request.headers.get('authorization') === 'Bearer private-runtime-key')).toBe(true);
    expect(await calls[0]!.clone().text()).not.toContain('private-runtime-key');
  } finally { fetchMock.mockRestore(); }
});

test('slot cache operations use GET and documented action endpoint and enforce request limits', async () => {
  const calls: Request[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push(new Request(input, init)); return Response.json({ slots: [] }); }, { preconnect: fetch.preconnect }));
  try {
    const route = createLemonadeModalityRoutes(descriptor);
    const getUrl = new URL(`${base}/slots`);
    expect((await route(new Request(getUrl), getUrl))?.status).toBe(200);
    const postUrl = new URL(`${base}/slots`);
    expect((await route(new Request(postUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 0, action: 'save', input: { filename: 'cache.bin' } }) }), postUrl))?.status).toBe(200);
    expect(calls.map((request) => [request.method, new URL(request.url).pathname, new URL(request.url).search])).toEqual([['GET', '/v1/slots', ''], ['POST', '/v1/slots/0', '?action=save']]);
    const tooLarge = new Request(new URL(`${base}/tokenize`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'x'.repeat(600_000) }) });
    expect((await route(tooLarge, new URL(tooLarge.url)))?.status).toBe(400);
    expect(calls).toHaveLength(2);
  } finally { fetchMock.mockRestore(); }
});

test('slot route accepts GET and POST only', async () => {
  const url = new URL(`${base}/slots`);
  expect(await createLemonadeModalityRoutes(descriptor)(new Request(url, { method: 'DELETE' }), url)).toBeNull();
});
