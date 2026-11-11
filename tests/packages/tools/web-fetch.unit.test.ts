import { describe, expect, test } from 'bun:test';
import { createHttpRequestClient } from '../../../packages/tools/src/http-request.adapter';
import { createWebFetchClient } from '../../../packages/tools/src/web-fetch.adapter';

function serve(routes: Record<string, { status?: number; body?: string; contentType?: string }>) {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      const route = routes[url.pathname];
      if (!route) return new Response('not found', { status: 404 });
      return new Response(route.body ?? '', {
        status: route.status ?? 200,
        headers: { 'content-type': route.contentType ?? 'text/html; charset=utf-8' },
      });
    },
  });
  return { origin: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

describe('web_fetch', () => {
  test('returns title and plain text from HTML', async () => {
    const host = serve({
      '/page': {
        body: '<html><head><title>Hello World</title></head><body><p>Alpha</p><script>evil()</script><p>Beta</p></body></html>',
      },
    });
    const client = createWebFetchClient(createHttpRequestClient({ allowedHosts: ['localhost'] }));
    const page = await client.fetch({ url: `${host.origin}/page` });
    host.stop();
    expect(page.kind).toBe('web-page');
    expect(page.title).toBe('Hello World');
    expect(page.text).toContain('Alpha');
    expect(page.text).toContain('Beta');
    expect(page.text).not.toContain('evil');
    expect(page.content).toBe(page.text);
    expect(page.truncated).toBe(false);
  });

  test('truncates long bodies by max_chars', async () => {
    const host = serve({
      '/long': { body: `<html><body>${'word '.repeat(5000)}</body></html>` },
    });
    const client = createWebFetchClient(createHttpRequestClient({ allowedHosts: ['localhost'] }));
    const page = await client.fetch({ url: `${host.origin}/long`, max_chars: 500 });
    host.stop();
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(500);
  });

  test('fails loud on bad URLs and non-OK responses', async () => {
    const client = createWebFetchClient(createHttpRequestClient({}));
    await expect(client.fetch({ url: 'not-a-url' })).rejects.toThrow();
    const host = serve({ '/missing': { status: 404, body: 'gone' } });
    await expect(client.fetch({ url: `${host.origin}/missing` })).rejects.toThrow(/404/);
    host.stop();
  });
});
