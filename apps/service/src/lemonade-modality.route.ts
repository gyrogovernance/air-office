import { LemonadeModalityAdapter, LemonadeStatusError, type LemonadeRuntimeDescriptor } from '@office/providers/service';
import { LemonadeManagementAdapter } from '@office/providers/lemonade-status';

const statuses: Record<LemonadeStatusError['code'], number> = { timeout: 504, cancelled: 499, upstream: 502, protocol: 502, unavailable: 503, 'invalid-request': 400 };
async function raw(response: Response): Promise<Response> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 16 * 1024 * 1024) throw new LemonadeStatusError('protocol', response.status);
  return new Response(bytes, { headers: { 'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
}
const routes = new Map([
  ['/api/v1/local-ai/embeddings', 'embeddings'], ['/api/v1/local-ai/rerank', 'rerank'],
  ['/api/v1/local-ai/audio/transcriptions', 'transcribe'], ['/api/v1/local-ai/audio/speech', 'speech'],
  ['/api/v1/local-ai/images/generations', 'image-generation'], ['/api/v1/local-ai/images/edits', 'image-edit'],
  ['/api/v1/local-ai/images/variations', 'image-variation'],
  ['/api/v1/local-ai/audio/generations', 'audio-generation'],
  ['/api/v1/local-ai/classify', 'classify'], ['/api/v1/local-ai/tokenize', 'tokenize'], ['/api/v1/local-ai/slots', 'slots']
]);
type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLemonadeModalityRoutes(getDescriptor: DescriptorArg) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    const descriptor = resolveDescriptor(getDescriptor);
    const action = routes.get(url.pathname);
    if (!action || (action === 'slots' ? !['GET', 'POST'].includes(request.method) : request.method !== 'POST')) return null;
    if (!descriptor) return Response.json({ error: { code: 'local-ai-unavailable', message: 'The local AI runtime is not configured.' } }, { status: 503 });
    try {
      const management = new LemonadeManagementAdapter(descriptor);
      if (action === 'slots') {
        if (request.method === 'GET') return Response.json(await management.listSlots({ signal: request.signal }), { headers: { 'Cache-Control': 'no-store' } });
        const body = await request.json() as { id?: unknown; action?: unknown; input?: { filename?: unknown } };
        if (!Number.isSafeInteger(body.id) || typeof body.action !== 'string' || !['save', 'restore', 'erase'].includes(body.action)) throw new LemonadeStatusError('invalid-request');
        const result = await management.controlSlot(body.id as number, body.action as 'save' | 'restore' | 'erase', body.input as { filename: string } | undefined, { signal: request.signal });
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (action === 'classify' || action === 'tokenize') {
        const body = await request.json() as Record<string, unknown>;
        if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 512_000) throw new LemonadeStatusError('invalid-request');
        const result = action === 'classify' ? await management.classify(body as never, { signal: request.signal }) : await management.tokenize(body as never, { signal: request.signal });
        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      const adapter = new LemonadeModalityAdapter(descriptor);
      if (action === 'transcribe' || action === 'image-edit' || action === 'image-variation') {
        const form = await request.formData();
        const file = form.get(action === 'transcribe' ? 'file' : 'image'); const model = form.get('model');
        if (!(file instanceof File) || typeof model !== 'string' || file.size > 12 * 1024 * 1024) throw new LemonadeStatusError('invalid-request');
        if (action === 'transcribe') {
          const result = await adapter.transcribe({ model, audio: file, fileName: file.name, language: typeof form.get('language') === 'string' ? String(form.get('language')) : undefined, response_format: form.get('response_format') as 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt' | undefined }, { signal: request.signal });
          return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
        }
        const input = { model, image: file, fileName: file.name, prompt: typeof form.get('prompt') === 'string' ? String(form.get('prompt')) : undefined, size: typeof form.get('size') === 'string' ? String(form.get('size')) : undefined, n: typeof form.get('n') === 'string' ? Number(form.get('n')) : undefined, response_format: form.get('response_format') === 'b64_json' ? 'b64_json' as const : undefined };
        if (action === 'image-edit') { const mask = form.get('mask'); return raw(await adapter.imageEdit({ ...input, mask: mask instanceof File ? mask : undefined }, { signal: request.signal })); }
        return raw(await adapter.imageVariation(input, { signal: request.signal }));
      }
      const body = await request.json() as Record<string, unknown>;
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 16 * 1024 * 1024) throw new LemonadeStatusError('invalid-request');
      if (action === 'embeddings') return Response.json(await adapter.embeddings(body as never, { signal: request.signal }), { headers: { 'Cache-Control': 'no-store' } });
      if (action === 'rerank') return Response.json(await adapter.rerank(body as never, { signal: request.signal }), { headers: { 'Cache-Control': 'no-store' } });
      if (action === 'speech') { const blob = await adapter.speech(body as never, { signal: request.signal }); return new Response(blob, { headers: { 'Content-Type': blob.type, 'Cache-Control': 'no-store' } }); }
      if (action === 'image-generation') return raw(await adapter.imageGeneration(body as never, { signal: request.signal }));
      if (action === 'audio-generation') return raw(await adapter.audioGeneration(body as never, { signal: request.signal }));
      throw new LemonadeStatusError('invalid-request');
    } catch (error) {
      const status = error instanceof LemonadeStatusError ? statuses[error.code] : 400;
      const code = error instanceof LemonadeStatusError ? `local-ai-${error.code}` : 'local-ai-invalid-request';
      const detail = error instanceof LemonadeStatusError ? error.detail : null;
      const message = detail ?? (error instanceof LemonadeStatusError && error.code === 'timeout'
        ? 'The local model is still working. A picture or a track can take a while on this computer; try again, or use a smaller model.'
        : 'The local AI modality request could not be completed.');
      return Response.json({ error: { code, message } }, { status });
    }
  };
}
