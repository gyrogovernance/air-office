import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { FetchedWebPage } from '@office/contracts/capability';

function ipv4IsNonGlobal(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a = 0, b = 0, c = 0] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 ||
    a === 192 && b === 0 && (c === 0 || c === 2) || a === 192 && b === 88 && c === 99 ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113;
}

function nonGlobalAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  const family = isIP(normalized);
  if (family === 4) return ipv4IsNonGlobal(normalized);
  if (family !== 6) return true;
  const [first = '', second = ''] = normalized.split(':');
  const firstWord = first ? Number.parseInt(first, 16) : 0;
  const secondWord = second ? Number.parseInt(second, 16) : 0;
  if (firstWord < 0x2000 || firstWord > 0x3fff) return true;
  return firstWord === 0x2002 || firstWord === 0x3fff && secondWord <= 0x0fff || firstWord === 0x2001 && (secondWord <= 0x01ff || secondWord === 0x0db8);
}

interface PublicTarget {
  url: URL;
  addresses: ResolvedAddress[];
}

interface ResolvedAddress {
  address: string;
  family: number;
}

type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

async function publicUrl(raw: string, signal: AbortSignal, resolveAddresses: AddressResolver): Promise<PublicTarget> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Open a public http or https page without embedded credentials.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await withAbort(resolveAddresses(hostname), signal);
  if (!addresses.length || addresses.length > 16 || addresses.some(({ address }) => nonGlobalAddress(address))) throw new Error('Web page tools cannot access private or local network addresses.');
  return { url, addresses };
}

async function fetchPinned(target: PublicTarget, options: { trustProxyEnvironment?: boolean }, signal: AbortSignal, request: typeof fetch): Promise<Response> {
  let lastError: unknown;
  for (const address of target.addresses) {
    const pinnedUrl = new URL(target.url.href);
    pinnedUrl.hostname = address.family === 6 ? `[${address.address}]` : address.address;
    try {
      return await request(pinnedUrl, {
        headers: { accept: 'text/html,text/plain;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', host: target.url.host },
        ...(target.url.protocol === 'https:' ? { tls: { serverName: target.url.hostname.replace(/^\[|\]$/g, '') } } : {}),
        ...(options.trustProxyEnvironment === false ? { proxy: false } : {}),
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('This public page could not be reached.');
}

export function createWebPageLoader(options: {
  timeoutMs?: number;
  maxCharacters?: number;
  trustProxyEnvironment?: boolean;
  resolveAddresses?: AddressResolver;
  request?: typeof fetch;
} = {}) {
  const resolveAddresses = options.resolveAddresses ?? ((hostname) => lookup(hostname, { all: true }));
  const request = options.request ?? fetch;
  return {
    async fetch(raw: string, signal?: AbortSignal): Promise<FetchedWebPage> {
      const bounded = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 15000), ...(signal ? [signal] : [])]);
      let target = await publicUrl(raw, bounded, resolveAddresses);
      for (let redirects = 0; redirects < 5; redirects++) {
        const response = await fetchPinned(target, options, bounded, request);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('This page redirected without a destination.');
          target = await publicUrl(new URL(location, target.url).href, bounded, resolveAddresses);
          continue;
        }
        if (!response.ok) throw new Error(`This page could not be opened (HTTP ${response.status}).`);
        const type = response.headers.get('content-type') ?? '';
        if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) {
          await response.body?.cancel();
          throw new Error('This page is not readable web text. Attach the document to read this file.');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('This page has no readable content.');
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('This page is too large to read safely.'); }
          chunks.push(next.value);
        }
        const html = new TextDecoder().decode(Buffer.concat(chunks));
        let title = '';
        let content = html;
        const images: string[] = [];
        const seenImages = new Set<string>();
        const addImage = (raw: string | null) => {
          if (!raw || images.length >= 3) return;
          let resolved: string;
          try { resolved = new URL(raw, target.url).href; } catch { return; }
          if (!/^https?:/.test(resolved) || seenImages.has(resolved)) return;
          seenImages.add(resolved);
          images.push(resolved);
        };
        if (/html/i.test(type)) {
          // Lead images are read before the text pass, so a page yields a picture
          // as well as words: the social card first, then the first content photo.
          new HTMLRewriter()
            .on('meta[property="og:image"],meta[name="twitter:image"]', { element(element) { addImage(element.getAttribute('content')); } })
            .on('img', { element(element) { addImage(element.getAttribute('src')); } })
            .transform(html);
          const cleaned = new HTMLRewriter().on('script,style,noscript,nav,footer,form,svg,iframe', { element(element) { element.remove(); } }).transform(html);
          content = '';
          new HTMLRewriter()
            .on('title', { text(chunk) { title += chunk.text; } })
            .on('body', { text(chunk) { content += chunk.text; } })
            .transform(cleaned);
        }
        content = content.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
        if (!content) throw new Error('This page has no readable text. It may require JavaScript or a sign-in.');
        const limit = options.maxCharacters ?? 40000;
        return {
          kind: 'web-page', url: target.url.href, title: title.trim() || target.url.hostname,
          content: content.slice(0, limit), truncated: content.length > limit,
          fetchedAt: new Date().toISOString(), ...(images.length ? { images } : {})
        };
      }
      throw new Error('This page redirected too many times.');
    }
  };
}
