import { expect, test } from 'bun:test';
import { fetchedWebPages } from '../../../packages/chat/src/web-source.policy';
import type { OutputBlock } from '../../../packages/chat/src/conversation-graph.entity';

test('fetchedWebPages accepts successful web_fetch and fetch_url results', () => {
  const output: OutputBlock[] = [
    {
      kind: 'tool',
      toolCallId: '1',
      name: 'web_search',
      status: 'ok',
      result: { results: [{ url: 'https://example.com', title: 'Lead', snippet: 'x' }] },
    },
    {
      kind: 'tool',
      toolCallId: '2',
      name: 'web_fetch',
      status: 'ok',
      arguments: { url: 'https://example.com/page' },
      result: {
        kind: 'web-page',
        url: 'https://example.com/page',
        title: 'Example',
        text: 'Hello from the page',
        content: 'Hello from the page',
        fetchedAt: '2026-11-07T00:00:00.000Z',
        truncated: false,
      },
    },
    {
      kind: 'tool',
      toolCallId: '3',
      name: 'fetch_url',
      status: 'ok',
      result: {
        kind: 'web-page',
        url: 'https://example.org/legacy',
        title: 'Legacy',
        content: 'Legacy body',
        fetchedAt: '2026-11-07T00:00:00.000Z',
        truncated: false,
      },
    },
  ];
  const pages = fetchedWebPages(output);
  expect(pages).toHaveLength(2);
  expect(pages.map((page) => page.url)).toEqual(['https://example.com/page', 'https://example.org/legacy']);
  expect(pages[0]?.content).toContain('Hello from the page');
});

test('fetchedWebPages ignores failed or empty fetches', () => {
  expect(fetchedWebPages([
    { kind: 'tool', toolCallId: '1', name: 'web_fetch', status: 'error', message: 'fail' },
    { kind: 'tool', toolCallId: '2', name: 'web_fetch', status: 'ok', result: { url: 'https://example.com', title: 'Empty' } },
  ])).toEqual([]);
});
