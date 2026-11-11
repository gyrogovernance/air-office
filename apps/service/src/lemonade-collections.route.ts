import { LemonadeCollectionsAdapter, runCollectionOperation, COLLECTION_MAX_BYTES } from '@office/providers/lemonade-collections';
import { LemonadeStatusError, type LemonadeRuntimeDescriptor, type LemonadeRequestOptions } from '@office/providers/lemonade-status';

const statuses: Record<LemonadeStatusError['code'], number> = { timeout: 504, cancelled: 499, upstream: 502, protocol: 502, unavailable: 503, 'invalid-request': 400 };
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new LemonadeStatusError('invalid-request');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > COLLECTION_MAX_BYTES) { await reader.cancel(); throw new LemonadeStatusError('invalid-request'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { throw new LemonadeStatusError('invalid-request'); }
}
/** Mount inside the existing authenticated AIR API handler. No arbitrary runtime paths are accepted. */
type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLemonadeCollectionRoutes(getDescriptor: DescriptorArg, options: LemonadeRequestOptions = {}) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/local-ai/collections/operations' || request.method !== 'POST') return null;
    const headers = { 'Cache-Control': 'no-store' };
    const descriptor = resolveDescriptor(getDescriptor);
    if (!descriptor) return Response.json({ error: { code: 'local-ai-unavailable', message: 'The local AI runtime is not configured.' } }, { status: 503, headers });
    try {
      const result = await runCollectionOperation(new LemonadeCollectionsAdapter(descriptor, options), await readBody(request), { signal: request.signal });
      return Response.json({ result }, { headers });
    } catch (error) {
      const code = error instanceof LemonadeStatusError ? error.code : 'invalid-request';
      return Response.json({ error: { code: `local-ai-${code}`, message: code === 'invalid-request' ? 'Check the collection definition, selected candidates, and default model.' : 'The collection operation could not be completed.', ...(error instanceof LemonadeStatusError && error.status !== null ? { upstreamStatus: error.status } : {}) } }, { status: statuses[code], headers });
    }
  };
}
