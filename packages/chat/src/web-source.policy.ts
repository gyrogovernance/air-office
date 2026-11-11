import type { FetchedWebPage } from '@office/contracts/capability';
import type { OutputBlock } from './conversation-graph.entity';

const FETCH_TOOL_NAMES = new Set(['web_fetch', 'fetch_url']);

function asWebPage(value: unknown, fallbackUrl?: string): FetchedWebPage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  const url = typeof page.url === 'string' ? page.url : fallbackUrl;
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  } catch { return null; }
  const content = typeof page.content === 'string' && page.content
    ? page.content
    : typeof page.text === 'string' && page.text
      ? page.text
      : '';
  if (!content) return null;
  const title = typeof page.title === 'string' && page.title.trim()
    ? page.title.trim()
    : (() => { try { return new URL(url).hostname; } catch { return url; } })();
  const fetchedAt = typeof page.fetchedAt === 'string' && page.fetchedAt
    ? page.fetchedAt
    : new Date().toISOString();
  const truncated = typeof page.truncated === 'boolean' ? page.truncated : false;
  const images = Array.isArray(page.images)
    ? page.images.filter((image): image is string => typeof image === 'string' && /^https?:/.test(image)).slice(0, 3)
    : [];
  return {
    kind: 'web-page',
    url,
    title,
    content,
    fetchedAt,
    truncated,
    ...(images.length ? { images } : {}),
  };
}

/** Successful web_fetch / fetch_url outputs are citeable sources; search hits remain leads. */
export function fetchedWebPages(output: readonly OutputBlock[]): FetchedWebPage[] {
  const pages: FetchedWebPage[] = [];
  const seen = new Set<string>();
  for (const block of output) {
    if (block.kind !== 'tool' || !block.name || !FETCH_TOOL_NAMES.has(block.name) || block.status !== 'ok') continue;
    const argsUrl = block.arguments && typeof block.arguments === 'object' && typeof (block.arguments as { url?: unknown }).url === 'string'
      ? (block.arguments as { url: string }).url
      : undefined;
    const page = asWebPage(block.result, argsUrl);
    if (!page || seen.has(page.url)) continue;
    seen.add(page.url);
    pages.push(page);
  }
  return pages;
}
