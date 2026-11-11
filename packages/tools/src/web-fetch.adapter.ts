import { createHttpRequestClient, type HttpRequestClient } from './http-request.adapter';

export type WebFetchInput = {
  url: string;
  max_chars?: number;
};

export type WebFetchResult = {
  kind: 'web-page';
  url: string;
  title: string;
  content: string;
  text: string;
  fetchedAt: string;
  truncated: boolean;
};

function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = (titleMatch?.[1] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const text = withoutScripts
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { title, text };
}

export function createWebFetchClient(client: HttpRequestClient = createHttpRequestClient({ timeoutMs: 20_000, maxResponseBytes: 1_500_000 })) {
  return {
    async fetch(input: WebFetchInput, signal?: AbortSignal): Promise<WebFetchResult> {
      const url = String(input.url ?? '').trim();
      if (!url) throw new Error('A URL is required.');
      const maxChars = Number.isFinite(Number(input.max_chars))
        ? Math.min(Math.max(Math.trunc(Number(input.max_chars)), 500), 100_000)
        : 20_000;
      const response = await client.request({ method: 'GET', url, timeoutMs: 20_000 }, signal);
      if (!response.ok) throw new Error(`The page returned HTTP ${response.status}.`);
      const contentType = response.contentType.toLowerCase();
      let title = '';
      let text = response.body;
      if (contentType.includes('html') || /<html[\s>]/i.test(response.body.slice(0, 500))) {
        const stripped = stripHtml(response.body);
        title = stripped.title;
        text = stripped.text;
      }
      if (!title) {
        try { title = new URL(url).hostname; } catch { title = url; }
      }
      const truncated = response.truncated || text.length > maxChars;
      const content = truncated ? text.slice(0, maxChars) : text;
      return {
        kind: 'web-page',
        url,
        title,
        content,
        text: content,
        fetchedAt: new Date().toISOString(),
        truncated,
      };
    },
  };
}

export type WebFetchClient = ReturnType<typeof createWebFetchClient>;
