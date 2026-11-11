import type { ServiceClient } from '../shared/service-client.hook';

export type TodaySource = { title: string; url: string; snippet: string };

const text = (value: unknown): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  : [];

function excerpt(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const shortened = value.slice(0, limit + 1);
  const sentenceEnd = Math.max(shortened.lastIndexOf('. '), shortened.lastIndexOf('? '), shortened.lastIndexOf('! '));
  if (sentenceEnd >= limit * .55) return shortened.slice(0, sentenceEnd + 1);
  return `${shortened.slice(0, limit).replace(/\s+\S*$/, '').trimEnd()}…`;
}

function searchResults(value: unknown): TodaySource[] {
  if (!value || typeof value !== 'object') return [];
  return records(Reflect.get(value, 'results')).flatMap((result) => {
    const title = text(result.title);
    const url = text(result.url);
    const snippet = text(result.snippet);
    return title && /^https?:\/\//.test(url) && snippet ? [{ title, url, snippet }] : [];
  }).slice(0, 3);
}

function featuredDatePath(date = new Date()): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

/** Uses AIR Office's built-in news search for the interests chosen in Today settings. */
export async function gatherTodaySources(client: ServiceClient, query: string, signal: AbortSignal): Promise<TodaySource[]> {
  const response = await client.json<unknown>('/api/v1/web-search/query', {
    method: 'POST',
    body: JSON.stringify({ query, limit: 3, category: 'news' }),
    signal
  });
  return searchResults(response);
}

/**
 * Wikimedia's human-edited "In the news" feed is the quiet default. Fetched
 * through the local service so the desktop CSP (loopback-only connect-src) does
 * not block it — the same reason web search already worked while curated failed.
 */
export async function gatherCuratedSources(client: ServiceClient, signal: AbortSignal): Promise<TodaySource[]> {
  let feed: unknown;
  try {
    feed = await client.json<unknown>(`/api/v1/today/wikipedia-featured?date=${encodeURIComponent(featuredDatePath())}`, { signal });
  } catch (reason) {
    if (signal.aborted) throw reason;
    throw new Error('Wikipedia’s curated digest could not be loaded. Try again, or switch Today to My interests (news search) in Settings → Apps.');
  }
  if (!feed || typeof feed !== 'object') return [];
  const news = records(Reflect.get(feed, 'news'));
  const sources: TodaySource[] = [];

  for (const item of news) {
    const document = typeof item.story === 'string' ? new DOMParser().parseFromString(item.story, 'text/html') : null;
    const leadTitle = text(document?.querySelector('b a')?.getAttribute('title'));
    const links = records(item.links);
    const article = links.find((link) => text(link.title) === leadTitle) ?? links[0];
    if (!article) continue;
    const title = text(article.normalizedtitle) || text(article.title).replace(/_/g, ' ');
    const contentUrls = article.content_urls && typeof article.content_urls === 'object' ? article.content_urls : null;
    const desktop = contentUrls && Reflect.get(contentUrls, 'desktop');
    const url = desktop && typeof desktop === 'object' ? text(Reflect.get(desktop, 'page')) : '';
    const story = text(document?.body.textContent);
    const snippet = excerpt([story, text(article.extract)].filter(Boolean).join(' '), 600);
    if (title && /^https:\/\//.test(url) && snippet && !sources.some((source) => source.url === url)) sources.push({ title, url, snippet });
    if (sources.length === 3) break;
  }
  return sources;
}

/** Raw featured feed for Picture of the day (same service proxy as curated news). */
export async function fetchWikipediaFeaturedFeed(client: ServiceClient, signal?: AbortSignal): Promise<unknown> {
  return client.json<unknown>(`/api/v1/today/wikipedia-featured?date=${encodeURIComponent(featuredDatePath())}`, signal ? { signal } : undefined);
}
