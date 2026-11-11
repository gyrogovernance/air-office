/**
 * Outbound HTTP requests for tool skills. Every request goes through this
 * adapter so the URL scheme, the response type, the size and the timeout are
 * checked in one place instead of inside each skill.
 */

export type HttpRequestInput = {
  method?: 'GET' | 'POST';
  url: string;
  /** JSON body for POST requests. */
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type HttpResponse = {
  status: number;
  ok: boolean;
  /** Response body as text, capped by the caller's limit. */
  body: string;
  truncated: boolean;
  contentType: string;
  durationMs: number;
};

export type HttpRequestOptions = {
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Only these hosts are reachable. An empty list allows every host. */
  allowedHosts?: readonly string[];
};

export class HttpRequestPolicyError extends Error {}

const ALLOWED_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent']);

export function createHttpRequestClient(options: HttpRequestOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024;
  const allowedHosts = new Set((options.allowedHosts ?? []).map((host) => host.toLowerCase()));

  function checkUrl(raw: string): URL {
    let url: URL;
    try { url = new URL(raw); } catch { throw new HttpRequestPolicyError('Provide a valid absolute URL.'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpRequestPolicyError('Only http and https URLs are supported.');
    if (url.username || url.password) throw new HttpRequestPolicyError('URLs with embedded credentials are not supported.');
    if (allowedHosts.size && !allowedHosts.has(url.hostname.toLowerCase())) throw new HttpRequestPolicyError(`${url.hostname} is not on the approved host list for this workspace.`);    return url;
  }

  return {
    allowedHosts: (): readonly string[] => options.allowedHosts ?? [],
    async request(input: HttpRequestInput, signal?: AbortSignal): Promise<HttpResponse> {
      const method = input.method ?? 'GET';
      if (method !== 'GET' && method !== 'POST') throw new HttpRequestPolicyError('Only GET and POST requests are supported.');
      const url = checkUrl(input.url);
      const headers = new Headers();
      for (const [key, value] of Object.entries(input.headers ?? {})) {
        if (!ALLOWED_HEADERS.has(key.toLowerCase())) throw new HttpRequestPolicyError(`${key} is not an allowed request header.`);
        if (key.toLowerCase() === 'content-type') continue;
        headers.set(key, String(value));
      }
      let payload: string | undefined;
      if (method === 'POST') {
        if (typeof input.body === 'string') { payload = input.body; headers.set('content-type', 'application/json'); }
        else if (input.body !== undefined) { payload = JSON.stringify(input.body); headers.set('content-type', 'application/json'); }
        else { payload = '{}'; headers.set('content-type', 'application/json'); }
      }
      const started = Date.now();
      const controller = new AbortController();
      const bounded = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(Math.min(Math.max(Math.trunc(input.timeoutMs ?? timeoutMs), 1000), 120_000))]);
      const abort = () => controller.abort();
      bounded.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetch(url, { method, headers, ...(payload !== undefined ? { body: payload } : {}), redirect: 'follow', signal: bounded });
        const contentType = response.headers.get('content-type') ?? '';
        const length = Number(response.headers.get('content-length'));
        let truncated = Number.isFinite(length) && length > maxResponseBytes;
        let body = '';
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let bytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = maxResponseBytes - bytes;
            if (remaining <= 0) { truncated = true; break; }
            const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            bytes += slice.byteLength;
            body += decoder.decode(slice, { stream: true });
            if (slice.byteLength < value.byteLength) { truncated = true; break; }
          }
          body += decoder.decode();
        } else { body = await response.text().catch(() => ''); }
        return { status: response.status, ok: response.ok, body: body.slice(0, maxResponseBytes), truncated, contentType, durationMs: Date.now() - started };
      } catch (error) {
        if (signal?.aborted) throw new HttpRequestPolicyError('The request was cancelled.');
        if (bounded.aborted) throw new HttpRequestPolicyError('The request timed out.');
        throw error instanceof HttpRequestPolicyError ? error : new HttpRequestPolicyError(`The request failed: ${error instanceof Error ? error.message : 'unknown reason'}`);
      } finally { bounded.removeEventListener('abort', abort); }
    }
  };
}

export type HttpRequestClient = ReturnType<typeof createHttpRequestClient>;
