import { expect, test } from 'bun:test';
import { createEndpointSearchProvider } from '../../../packages/providers/src/web-search.adapter';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the endpoint provider sends the documented query contract and normalizes linked results', async () => {
  const seen: URL[] = [];
  const provider = createEndpointSearchProvider({
    endpoint: 'https://search.example/api?lang=en',
    fetchImpl: async (input) => {
      seen.push(new URL(String(input)));
      return jsonResponse({
        results: [
          { title: 'Example', url: 'https://example.com/a', content: 'Snippet one' },
          { title: 'Local file', url: 'file:///etc/passwd', content: 'not a web link' },
          { title: 'No link at all', content: 'dropped' },
          { url: 'https://example.com/b', content: 'Title falls back to the URL' }
        ]
      });
    }
  });
  const response = await provider.search('  air office  ', { limit: 10 });
  expect(seen[0]?.searchParams.get('q')).toBe('air office');
  expect(seen[0]?.searchParams.get('format')).toBe('json');
  expect(seen[0]?.searchParams.get('pageno')).toBe('1');
  expect(seen[0]?.searchParams.get('lang')).toBe('en');
  expect(response.provider).toBe('endpoint-search');
  expect(response.query).toBe('air office');
  expect(Date.parse(response.searchedAt)).not.toBeNaN();
  expect(response.results).toEqual([
    { title: 'Example', url: 'https://example.com/a', snippet: 'Snippet one' },
    { title: 'https://example.com/b', url: 'https://example.com/b', snippet: 'Title falls back to the URL' }
  ]);
});

test('news search requests recent articles from a compatible endpoint', async () => {
  let requested: URL | undefined;
  const provider = createEndpointSearchProvider({ endpoint: 'https://search.example/search', fetchImpl: async (input) => {
    requested = new URL(String(input));
    return jsonResponse({ results: [] });
  } });
  await provider.search('science', { category: 'news' });
  expect(requested?.searchParams.get('categories')).toBe('news');
  expect(requested?.searchParams.get('time_range')).toBe('day');
});

test('the result limit is clamped to a sane range', async () => {
  const results = Array.from({ length: 12 }, (_, index) => ({ title: `T${index}`, url: `https://example.com/${index}`, content: 'c' }));
  const provider = createEndpointSearchProvider({ endpoint: 'https://search.example/search', fetchImpl: async () => jsonResponse({ results }) });
  expect((await provider.search('q', { limit: 99 })).results).toHaveLength(10);
  expect((await provider.search('q', { limit: 0 })).results).toHaveLength(1);
  expect((await provider.search('q')).results).toHaveLength(5);
});

test('provider failures stay explicit instead of returning fabricated results', async () => {
  const failing = createEndpointSearchProvider({ endpoint: 'https://search.example/search', fetchImpl: async () => new Response('nope', { status: 503 }) });
  await expect(failing.search('q')).rejects.toThrow('HTTP 503');
  const unreadable = createEndpointSearchProvider({ endpoint: 'https://search.example/search', fetchImpl: async () => jsonResponse({ items: [] }) });
  await expect(unreadable.search('q')).rejects.toThrow('unreadable response');
  const provider = createEndpointSearchProvider({ endpoint: 'https://search.example/search', fetchImpl: async () => jsonResponse({ results: [] }) });
  await expect(provider.search('   ')).rejects.toThrow('search query is required');
  expect(() => createEndpointSearchProvider({ endpoint: 'ftp://search.example' })).toThrow('http(s) endpoint');
});

test('an aborted signal ends the provider call through the injected fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = createEndpointSearchProvider({
    endpoint: 'https://search.example/search',
    fetchImpl: async (_input, init) => {
      if (init?.signal?.aborted) throw new Error('The operation was aborted.');
      return jsonResponse({ results: [] });
    }
  });
  await expect(provider.search('q', {}, controller.signal)).rejects.toThrow('aborted');
});

test('the concurrent request limit keeps a local search service from being flooded', async () => {
  let active = 0;
  let peak = 0;
  const provider = createEndpointSearchProvider({
    endpoint: 'https://search.example/search',
    maxConcurrentRequests: 2,
    fetchImpl: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse({ results: [] });
    }
  });
  await Promise.all([provider.search('a'), provider.search('b'), provider.search('c'), provider.search('d')]);
  expect(peak).toBeLessThanOrEqual(2);
});
