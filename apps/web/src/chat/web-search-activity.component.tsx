import { useState } from 'react';
import { Button, Chip, Disclosure, Link, Surface } from '@heroui/react';
import { toolCallRunning, type ChatToolCallProps } from './chat-tool-call.component';

interface PageLink { url: string; title: string; snippet: string }

function looksLikeMarkup(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<') || /<!doctype|<\/?[a-z][\s\S]*>/i.test(trimmed.slice(0, 240));
}

function readableText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || looksLikeMarkup(trimmed)) return '';
  return trimmed;
}

function pageLink(value: unknown, options?: { allowSnippet?: boolean }): PageLink | null {
  if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string') return null;
  let url: URL;
  try { url = new URL(value.url); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, '');
  const rawTitle = 'title' in value && typeof value.title === 'string' ? value.title.trim() : '';
  const titleLooksLikeHost = !rawTitle || rawTitle === url.href || rawTitle === url.hostname || rawTitle === host || looksLikeMarkup(rawTitle);
  const title = titleLooksLikeHost ? host : rawTitle;
  const snippet = options?.allowSnippet
    ? readableText('snippet' in value ? value.snippet : 'content' in value ? value.content : '')
    : '';
  return { url: url.href, title, snippet: snippet.length > 120 ? `${snippet.slice(0, 117).trimEnd()}…` : snippet };
}

function ToolRow(props: { status: string; children: React.ReactNode }) {
  return <Surface className="chat-tool-call chat-search-activity flex flex-col gap-1 rounded-xl px-2.5 py-1.5" variant="secondary" data-status={props.status}>
    {props.children}
  </Surface>;
}

/** One quiet row for search and page opens. Nested cards and error alerts stay out. */
export function WebSearchActivity(props: ChatToolCallProps) {
  const [showResults, setShowResults] = useState(false);
  const running = toolCallRunning(props);
  const searching = props.toolName === 'web_search';
  const result = props.result;
  const pages: PageLink[] = [];
  if (!props.isError && result && typeof result === 'object') {
    if (searching && 'results' in result && Array.isArray(result.results)) {
      for (const row of result.results) {
        const page = pageLink(row, { allowSnippet: true });
        if (page && !pages.some((existing) => existing.url === page.url)) pages.push(page);
      }
    } else if (props.toolName === 'web_fetch' || props.toolName === 'fetch_url') {
      const page = pageLink(result, { allowSnippet: false });
      if (page) pages.push(page);
    }
  }
  const query = props.args && typeof props.args === 'object' && 'query' in props.args && typeof props.args.query === 'string'
    ? props.args.query.trim()
    : '';
  const opened = !searching ? pages[0] : undefined;
  const status = props.isError ? 'error' : running ? 'running' : 'success';
  const label = searching ? 'Search' : 'Opened';
  const detail = searching
    ? query
    : opened
      ? null
      : props.isError
        ? 'Couldn’t load'
        : running
          ? 'Reading…'
          : '';

  const summary = <>
    <span className="chat-tool-name shrink-0 text-xs font-medium text-muted">{label}</span>
    {opened ? <Link className="chat-tool-preview min-w-0 truncate text-xs" href={opened.url} rel="noopener noreferrer" target="_blank">
      {opened.title}
      <Link.Icon className="size-3" aria-hidden="true" />
    </Link> : detail ? <span className="chat-tool-preview min-w-0 truncate text-xs text-muted">{detail}</span> : null}
    {running ? <Chip className="chat-tool-status ms-auto" size="sm" color="accent" variant="soft">Working…</Chip> : null}
    {props.isError ? <Chip className="chat-tool-status ms-auto" size="sm" color="danger" variant="soft">Failed</Chip> : null}
  </>;

  if (searching && pages.length > 0) {
    return <ToolRow status={status}>
      <Disclosure className="chat-search-disclosure w-full" isExpanded={showResults} onExpandedChange={setShowResults}>
        <div className="chat-tool-summary flex min-h-7 items-center gap-2">
          {summary}
          <Disclosure.Heading className="ms-auto">
            <Button className="chat-search-toggle h-7 rounded-lg px-2 text-xs" size="sm" slot="trigger" variant="ghost">
              {showResults ? 'Hide' : `${pages.length}`}
              <Disclosure.Indicator />
            </Button>
          </Disclosure.Heading>
        </div>
        <Disclosure.Content>
          <Disclosure.Body className="chat-search-results mt-1 flex flex-col gap-0.5 p-0">
            {showResults ? pages.map((page) => (
              <Link key={page.url} className="chat-search-card truncate rounded-lg px-1.5 py-1 text-xs" href={page.url} rel="noopener noreferrer" target="_blank">
                {page.title}
                <Link.Icon className="size-3" aria-hidden="true" />
              </Link>
            )) : null}
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </ToolRow>;
  }

  return <ToolRow status={status}>
    <div className="chat-tool-summary flex min-h-7 items-center gap-2" aria-label={searching ? 'Web search' : 'Opened page'}>
      {summary}
    </div>
  </ToolRow>;
}
