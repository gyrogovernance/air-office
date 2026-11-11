import { expect, test } from 'bun:test';
import { createWebPageLoader } from '../../../packages/providers/src/web-page.adapter';

test('web page requests use the checked address while retaining the public host', async () => {
  const requests: { url: URL; headers: Headers }[] = [];
  const loader = createWebPageLoader({
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (input, init) => {
      requests.push({ url: new URL(input instanceof Request ? input.url : String(input)), headers: new Headers(init?.headers) });
      return new Response('public page', { headers: { 'content-type': 'text/plain' } });
    }
  });

  const page = await loader.fetch('https://news.example/story');

  expect(requests[0]?.url.href).toBe('https://93.184.216.34/story');
  expect(requests[0]?.headers.get('host')).toBe('news.example');
  expect(page.url).toBe('https://news.example/story');
  expect(page.content).toBe('public page');
});

test('a redirect is resolved and rejected before connecting to a private address', async () => {
  let requests = 0;
  const loader = createWebPageLoader({
    resolveAddresses: async (hostname) => hostname === 'news.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }],
    request: async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: 'http://internal.example/admin' } });
    }
  });

  await expect(loader.fetch('https://news.example/')).rejects.toThrow('private or local network');
  expect(requests).toBe(1);
});

test('literal loopback and documentation IPv6 addresses are rejected', async () => {
  let requests = 0;
  const loader = createWebPageLoader({ request: async () => {
    requests += 1;
    return new Response('should not be requested');
  } });

  await expect(loader.fetch('http://[::1]/')).rejects.toThrow('private or local network');
  await expect(loader.fetch('https://[2001:db8::1]/')).rejects.toThrow('private or local network');
  await expect(loader.fetch('https://[3fff::1]/')).rejects.toThrow('private or local network');
  expect(requests).toBe(0);
});
