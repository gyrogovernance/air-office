import { describe, expect, test } from 'bun:test';
import { LemonadeModalityAdapter, LemonadeRealtimeAdapter } from '../../../packages/providers/src/lemonade-modality.adapter';
import { LemonadeStatusError } from '../../../packages/providers/src/lemonade-status.adapter';

const descriptor = { instanceId: 'test', generation: 1, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:13305', resolveSecret: () => 'runtime-secret' };
function response(body: string | Uint8Array, headers?: HeadersInit) { return new Response(typeof body === 'string' ? body : body.slice().buffer as ArrayBuffer, { status: 200, headers }); }

describe('Lemonade modality transport', () => {
  test('sends typed embeddings with bearer auth and parses vectors', async () => {
    let received: RequestInit | undefined;
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async (_url, init) => { received = init; return response(JSON.stringify({ object: 'list', model: 'embed-1', data: [{ object: 'embedding', index: 0, embedding: [0.2, 0.8] }] })); } });
    await expect(adapter.embeddings({ model: 'embed-1', input: ['hello'] })).resolves.toMatchObject({ data: [{ embedding: [0.2, 0.8] }] });
    expect(new Headers(received?.headers).get('authorization')).toBe('Bearer runtime-secret');
  });
  test('posts rerank and retains relevance scores', async () => {
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async () => response(JSON.stringify({ object: 'list', model: 'rank-1', results: [{ index: 0, relevance_score: 2.5 }] })) });
    await expect(adapter.rerank({ model: 'rank-1', query: 'q', documents: ['d'] })).resolves.toMatchObject({ results: [{ relevance_score: 2.5 }] });
  });
  test('sends wav transcription as multipart and returns speech bytes', async () => {
    const calls: Request[] = [];
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async (url, init) => { calls.push(new Request(url, init)); return calls.length === 1 ? response(JSON.stringify({ text: 'recognized' })) : response(new Uint8Array([1, 2, 3]), { 'content-type': 'audio/wav' }); } });
    await expect(adapter.transcribe({ model: 'whisper', audio: new Blob(['wav']), fileName: 'clip.wav' })).resolves.toEqual({ text: 'recognized' });
    expect(calls[0]!.headers.get('content-type')).toContain('multipart/form-data');
    const audio = await adapter.speech({ model: 'kokoro-v1', input: 'hello', response_format: 'wav' });
    expect(audio.type).toBe('audio/wav');
    expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  test('posts image and audio generation to pinned provider-owned endpoints with private bearer auth', async () => {
    const calls: Request[] = [];
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async (url, init) => { calls.push(new Request(url, init)); return response(new Uint8Array([1, 2]), { 'content-type': 'image/png' }); } });
    await adapter.imageGeneration({ model: 'sd-turbo', prompt: 'a tree', n: 1 });
    await adapter.audioGeneration({ model: 'ace', prompt: 'soft piano', duration: 5 });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/v1/images/generations', '/v1/audio/generations']);
    expect(calls.every((call) => call.headers.get('authorization') === 'Bearer runtime-secret')).toBe(true);
    await expect(adapter.imageGeneration({ model: 'sd-turbo', prompt: 'a tree', n: 2 })).rejects.toMatchObject({ code: 'invalid-request' });
  });
  test('sends image edits and variations as multipart without inventing variation prompt support', async () => {
    const calls: Request[] = [];
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async (url, init) => { calls.push(new Request(url, init)); return response(new Uint8Array([1])); } });
    const image = new Blob(['png']);
    await adapter.imageEdit({ model: 'edit', prompt: 'change sky', image });
    await adapter.imageVariation({ model: 'variation', image });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(['/v1/images/edits', '/v1/images/variations']);
    expect(await calls[0]!.formData()).toHaveProperty('get');
    expect((await calls[1]!.formData()).has('prompt')).toBe(false);
  });
  test('rejects an oversized image payload before transport', async () => {
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async () => { throw new Error('transport should not run'); } });
    await expect(adapter.imageGeneration({ model: 'sd-turbo', prompt: 'x'.repeat(12 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: 'invalid-request' });
  });
  test('connects to documented realtime websocket with server-held API key and model query', async () => {
    const seen: URL[] = [];
    class Socket extends EventTarget {
      static instances: Socket[] = [];
      constructor(readonly url: URL) { super(); Socket.instances.push(this); }
      close() {}
    }
    const adapter = new LemonadeRealtimeAdapter(descriptor);
    const pending = adapter.connect({ model: 'moonshine' }, { webSocket: Socket as unknown as typeof WebSocket });
    await Promise.resolve();
    const socket = Socket.instances[0]!;
    seen.push(socket.url);
    socket.dispatchEvent(new Event('open'));
    expect(await pending).toBe(socket as unknown as WebSocket);
    expect(seen[0]!.pathname).toBe('/realtime');
    expect(seen[0]!.searchParams.get('model')).toBe('moonshine');
    expect(seen[0]!.searchParams.get('api_key')).toBe('runtime-secret');
  });
  test('realtime connection times out and closes its pending socket', async () => {
    let closed = false;
    class PendingSocket extends EventTarget { close() { closed = true; } }
    const adapter = new LemonadeRealtimeAdapter(descriptor);
    await expect(adapter.connect({ model: 'moonshine' }, { timeoutMs: 5, webSocket: PendingSocket as unknown as typeof WebSocket })).rejects.toMatchObject({ code: 'timeout' });
    expect(closed).toBe(true);
  });
  test('cancellation during secret resolution never opens a socket', async () => {
    const controller = new AbortController();
    let opened = false;
    class PendingSocket extends EventTarget { constructor() { super(); opened = true; } }
    const adapter = new LemonadeRealtimeAdapter({ ...descriptor, resolveSecret: async () => { controller.abort(); return 'secret'; } });
    await expect(adapter.connect({ model: 'moonshine' }, { signal: controller.signal, webSocket: PendingSocket as unknown as typeof WebSocket })).rejects.toMatchObject({ code: 'cancelled' });
    expect(opened).toBe(false);
  });
  test('rejects invalid realtime model before opening a socket', async () => {
    const adapter = new LemonadeRealtimeAdapter(descriptor);
    await expect(adapter.connect({ model: '' })).rejects.toMatchObject({ code: 'invalid-request' });
  });
  test('classifies malformed vectors and rejects invalid requests before transport', async () => {
    const adapter = new LemonadeModalityAdapter(descriptor, { request: async () => response('{"object":"list","data":[]}') });
    await expect(adapter.embeddings({ model: '', input: ['x'] })).rejects.toBeInstanceOf(LemonadeStatusError);
    await expect(adapter.rerank({ model: 'x', query: '', documents: [] })).rejects.toMatchObject({ code: 'invalid-request' });
  });
});
