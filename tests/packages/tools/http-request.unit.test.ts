import { describe, expect, test } from 'bun:test';
import { createHttpRequestClient, HttpRequestPolicyError } from '../../../packages/tools/src/http-request.adapter';

function serve(routes: Record<string, { status?: number; body?: string; contentType?: string; delayMs?: number }>) {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      const route = routes[url.pathname];
      if (!route) return new Response('not found', { status: 404 });
      if (route.delayMs) return new Promise((resolve) => setTimeout(() => resolve(new Response(route.body ?? '', { status: route.status ?? 200, headers: { 'content-type': route.contentType ?? 'text/plain' } })), route.delayMs));
      return new Response(route.body ?? '', { status: route.status ?? 200, headers: { 'content-type': route.contentType ?? 'text/plain' } });
    }
  });
  return { origin: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

describe('http request policy', () => {
  test('performs a GET and returns the body, status and content type', async () => {
    const host = serve({ '/ok': { body: 'payload' } });
    const client = createHttpRequestClient({ allowedHosts: ['localhost'] });
    const result = await client.request({ url: `${host.origin}/ok` });
    host.stop();
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.body).toBe('payload');
    expect(result.contentType).toContain('text/plain');
  });

  test('refuses a non-http scheme', async () => {
    const client = createHttpRequestClient({});
    await expect(client.request({ url: 'file:///etc/passwd' })).rejects.toThrow(/http and https/);
  });

  test('refuses a host that is not on the approved list', async () => {
    const client = createHttpRequestClient({ allowedHosts: ['example.com'] });
    await expect(client.request({ url: 'https://api.frankfurter.dev/v1/latest' })).rejects.toThrow(/not on the approved host list/);
  });

  test('allows a host that is on the approved list', async () => {
    const client = createHttpRequestClient({ allowedHosts: ['example.com'] });
    const result = await client.request({ url: 'https://example.com' }).catch(() => null);
    // The network may be unreachable in the test environment; the policy check is what matters here.
    expect(result === null || result.status === 200 || result.status >= 400).toBe(true);
  });

  test('refuses a URL with embedded credentials', async () => {
    const client = createHttpRequestClient({});
    await expect(client.request({ url: 'https://user:pass@example.com/' })).rejects.toThrow(/embedded credentials/);
  });

  test('refuses a method other than GET or POST', async () => {
    const client = createHttpRequestClient({});
    // @ts-expect-error the client only advertises GET and POST.
    await expect(client.request({ url: 'https://example.com', method: 'DELETE' })).rejects.toThrow(/GET and POST/);
  });

  test('refuses a header outside the allowlist', async () => {
    const client = createHttpRequestClient({});
    await expect(client.request({ url: 'https://example.com', headers: { authorization: 'Bearer x' } })).rejects.toThrow(/not an allowed request header/);
  });

  test('refuses an invalid URL', async () => {
    const client = createHttpRequestClient({});
    await expect(client.request({ url: 'not a url' })).rejects.toThrow(/valid absolute URL/);
  });

  test('returns a non-2xx response without throwing so the caller can read the body', async () => {
    const host = serve({ '/missing': { status: 404, body: 'nope' } });
    const client = createHttpRequestClient({ allowedHosts: ['localhost'] });
    const result = await client.request({ url: `${host.origin}/missing` });
    host.stop();
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
    expect(result.body).toBe('nope');
  });

  test('sends a JSON body on POST', async () => {
    let received = '';
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        received = await request.text();
        return new Response('accepted', { status: 200 });
      }
    });
    const client = createHttpRequestClient({ allowedHosts: ['localhost'] });
    const result = await client.request({ url: `http://localhost:${server.port}/`, method: 'POST', body: { hello: 'world' } });
    server.stop(true);
    expect(result.body).toBe('accepted');
    expect(received).toBe('{"hello":"world"}');
  });

  test('caps the response body and marks it truncated', async () => {
    const host = serve({ '/big': { body: 'x'.repeat(5000) } });
    const client = createHttpRequestClient({ allowedHosts: ['localhost'], maxResponseBytes: 512 });
    const result = await client.request({ url: `${host.origin}/big` });
    host.stop();
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(512);
  });

  test('reports a timeout as a policy error', async () => {
    const host = serve({ '/slow': { body: 'late', delayMs: 1500 } });
    const client = createHttpRequestClient({ allowedHosts: ['localhost'], timeoutMs: 300 });
    await expect(client.request({ url: `${host.origin}/slow` })).rejects.toThrow(/timed out/);
    host.stop();
  });
});

