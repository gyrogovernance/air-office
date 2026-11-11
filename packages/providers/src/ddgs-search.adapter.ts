import { spawn } from 'node:child_process';
import type { WebSearchProvider, WebSearchResult } from '@office/contracts/capability';

export interface DdgsSearchOptions {
  command: readonly [string, ...string[]];
  timeoutMs?: number;
  verifySsl?: boolean;
  trustProxyEnvironment?: boolean;
  /** Search region for the engine (e.g. 'wt-wt'); defaults to worldwide. */
  region?: string;
  /** How many built-in searches may run at once across the process. Defaults to 1. */
  maxConcurrentRequests?: number;
}

/** DuckDuckGo rate-limits parallel clients from one machine; keep one global lane. */
let activeSearches = 0;
const waitingSearches: (() => void)[] = [];

async function acquireSearchLane(limit: number, signal?: AbortSignal): Promise<() => void> {
  const max = Math.min(Math.max(Math.trunc(limit), 1), 8);
  if (activeSearches < max) {
    activeSearches += 1;
    return () => {
      activeSearches -= 1;
      waitingSearches.shift()?.();
    };
  }
  await new Promise<void>((resolve, reject) => {
    const resume = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      const at = waitingSearches.indexOf(resume);
      if (at >= 0) waitingSearches.splice(at, 1);
      reject(new Error(signal?.aborted ? 'Web search was cancelled.' : 'Web search took too long. Try again.'));
    };
    waitingSearches.push(resume);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  activeSearches += 1;
  return () => {
    activeSearches -= 1;
    waitingSearches.shift()?.();
  };
}

function readResults(value: unknown): WebSearchResult[] {
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || !('results' in value) || !Array.isArray(value.results)) {
    throw new Error('Web search could not complete. Try again shortly.');
  }
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const row of value.results) {
    if (!row || typeof row !== 'object' || !('url' in row) || typeof row.url !== 'string') continue;
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ url: url.href, title: 'title' in row && typeof row.title === 'string' && row.title.trim() ? row.title.trim() : url.href, snippet: 'snippet' in row && typeof row.snippet === 'string' ? row.snippet : '' });
  }
  return results;
}

function runWorker(options: DdgsSearchOptions, body: Record<string, unknown>, bounded: AbortSignal, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process -- the service wires a fixed packaged worker path; spawn receives no shell command.
    const child = spawn(options.command[0], options.command.slice(1), { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    let bytes = 0;
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      bounded.removeEventListener('abort', abort);
      child.kill();
      if (error) { reject(error); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Web search returned an unreadable response.')); }
    };
    const abort = () => finish(new Error(signal?.aborted ? 'Web search was cancelled.' : 'Web search took too long. Try again.'));
    bounded.addEventListener('abort', abort, { once: true });
    child.on('error', () => finish(new Error('The built-in search engine is unavailable. Repair the application runtime.')));
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 512 * 1024) { finish(new Error('Web search returned too much data.')); return; }
      output += chunk.toString('utf8');
    });
    child.stdin.on('error', () => finish(new Error('The built-in search engine stopped unexpectedly.')));
    child.on('close', () => finish(null));
    child.stdin.end(JSON.stringify(body));
    if (bounded.aborted) abort();
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Web search was cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Web search was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** The compiled worker contains Python and DDGS; installed users need neither. */
export function createDdgsSearchProvider(options: DdgsSearchOptions): WebSearchProvider {
  const laneLimit = options.maxConcurrentRequests ?? 1;
  return {
    id: 'ddgs',
    async search(query, searchOptions = {}, signal) {
      const trimmed = query.trim();
      if (!trimmed) throw new Error('A search query is required.');
      const limit = Math.min(10, Math.max(1, Math.trunc(searchOptions.limit ?? 5)));
      const timeoutMs = Math.min(120000, Math.max(1000, options.timeoutMs ?? 15000));
      // Wait for the shared lane without burning the search deadline, so a chat
      // tool queued behind Today or another turn still gets a full attempt budget.
      signal?.throwIfAborted();
      const release = await acquireSearchLane(laneLimit, signal);
      try {
        const bounded = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
        const body = {
          query: trimmed,
          limit,
          category: searchOptions.category,
          timeoutMs,
          verifySsl: options.verifySsl !== false,
          trustProxyEnvironment: options.trustProxyEnvironment !== false,
          region: options.region || 'wt-wt'
        };
        // DuckDuckGo often rejects parallel or back-to-back clients; one lane plus
        // a short retry turns those transient misses into a successful chat tool call.
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          bounded.throwIfAborted();
          try {
            const payload = await runWorker(options, body, bounded, signal);
            return { query: trimmed, provider: 'ddgs', searchedAt: new Date().toISOString(), results: readResults(payload).slice(0, limit) };
          } catch (reason) {
            lastError = reason instanceof Error ? reason : new Error('Web search could not complete. Try again shortly.');
            if (signal?.aborted || /cancel|unavailable|too much data/i.test(lastError.message)) throw lastError;
            if (attempt === 2) throw lastError;
            await delay(400 * (attempt + 1), bounded);
          }
        }
        throw lastError ?? new Error('Web search could not complete. Try again shortly.');
      } finally {
        release();
      }
    }
  };
}
