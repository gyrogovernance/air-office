import { expect, spyOn, test } from 'bun:test';
import type { LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import { createLemonadeModalityRoutes } from '../../../apps/service/src/lemonade-modality.route';

const descriptor: LemonadeRuntimeDescriptor = {
  instanceId: 'modality-fixture', generation: 1, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:43192',
  resolveSecret: () => 'server-only-modality-secret'
};
const base = 'http://air.test/api/v1/local-ai';

test('JSON modality endpoints map to their upstream paths and keep the runtime bearer secret upstream-only', async () => {
  const calls: Request[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } });
  }, { preconnect: fetch.preconnect }));
  try {
    const route = createLemonadeModalityRoutes(descriptor);
    const cases = [
      ['/images/generations', '/v1/images/generations', { model: 'sd-turbo', prompt: 'a tree' }],
      ['/audio/generations', '/v1/audio/generations', { model: 'ace', prompt: 'soft piano' }]
    ] as const;
    for (const [path, upstreamPath, body] of cases) {
      const response = await route(new Request(`${base}${path}`, { method: 'POST', headers: { authorization: 'Bearer air-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }), new URL(`${base}${path}`));
      expect(response?.status).toBe(200);
      expect(response?.headers.get('cache-control')).toBe('no-store');
      expect(new Uint8Array(await response!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      const upstream = calls.at(-1)!;
      expect(new URL(upstream.url).pathname).toBe(upstreamPath);
      expect(upstream.headers.get('authorization')).toBe('Bearer server-only-modality-secret');
      expect(await upstream.text()).not.toContain('server-only-modality-secret');
      expect(new TextDecoder().decode(new Uint8Array([1, 2, 3]))).not.toContain('server-only-modality-secret');
    }
    expect(calls).toHaveLength(2);
  } finally { fetchMock.mockRestore(); }
});

test('multipart image edit, variation, and transcription preserve their fields and map upstream', async () => {
  const calls: Request[] = [];
  const upstreamBodies: string[] = [];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    upstreamBodies.push(await request.clone().text());
    return new URL(request.url).pathname === '/v1/audio/transcriptions'
      ? Response.json({ text: 'recognized speech' })
      : new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'image/png' } });
  }, { preconnect: fetch.preconnect }));
  try {
    const route = createLemonadeModalityRoutes(descriptor);
    const image = new File(['image-data'], 'photo.png', { type: 'image/png' });
    const editForm = new FormData(); editForm.set('model', 'edit-model'); editForm.set('image', image); editForm.set('prompt', 'change the sky'); editForm.set('mask', new File(['mask'], 'mask.png')); 
    const editUrl = new URL(`${base}/images/edits`);
    expect((await route(new Request(editUrl, { method: 'POST', body: editForm }), editUrl))?.status).toBe(200);
    const variationForm = new FormData(); variationForm.set('model', 'variation-model'); variationForm.set('image', image);
    const variationUrl = new URL(`${base}/images/variations`);
    expect((await route(new Request(variationUrl, { method: 'POST', body: variationForm }), variationUrl))?.status).toBe(200);
    const audioForm = new FormData(); audioForm.set('model', 'whisper'); audioForm.set('file', new File(['audio-data'], 'clip.wav')); audioForm.set('language', 'en'); audioForm.set('response_format', 'json');
    const audioUrl = new URL(`${base}/audio/transcriptions`);
    const transcription = await route(new Request(audioUrl, { method: 'POST', body: audioForm }), audioUrl);
    expect(await transcription?.json()).toMatchObject({ text: 'recognized speech' });

    expect(calls.map((request) => new URL(request.url).pathname)).toEqual(['/v1/images/edits', '/v1/images/variations', '/v1/audio/transcriptions']);
    const edit = await calls[0]!.formData();
    expect(edit.get('model')).toBe('edit-model'); expect(edit.get('prompt')).toBe('change the sky'); expect(edit.get('image')).toBeInstanceOf(File); expect(edit.get('mask')).toBeInstanceOf(File);
    const variation = await calls[1]!.formData();
    expect(variation.get('model')).toBe('variation-model'); expect(variation.get('image')).toBeInstanceOf(File); expect(variation.has('prompt')).toBe(false);
    const audio = await calls[2]!.formData();
    expect(audio.get('model')).toBe('whisper'); expect(audio.get('language')).toBe('en'); expect(audio.get('response_format')).toBe('json'); expect(audio.get('file')).toBeInstanceOf(File);
    expect(calls.every((request) => request.headers.get('authorization') === 'Bearer server-only-modality-secret')).toBe(true);
    expect(upstreamBodies.join('')).not.toContain('server-only-modality-secret');
  } finally { fetchMock.mockRestore(); }
});

test('raw modality response bytes are bounded and unavailable runtime is reported', async () => {
  const oversized = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/octet-stream', 'content-length': String(16 * 1024 * 1024 + 1) } }), { preconnect: fetch.preconnect }));
  try {
    const path = `${base}/images/generations`; const url = new URL(path);
    const response = await createLemonadeModalityRoutes(descriptor)(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'sd-turbo', prompt: 'a tree' }) }), url);
    expect(response?.status).toBe(502);
    expect((await response?.json()) as { error: { code: string } }).toMatchObject({ error: { code: 'local-ai-protocol' } });
    expect((await createLemonadeModalityRoutes(null)(new Request(url, { method: 'POST' }), url))?.status).toBe(503);
  } finally { oversized.mockRestore(); }
});

test('AIR bearer authorization is enforced before modality route dispatch by application integration', async () => {
  const source = await Bun.file(new URL('../../../apps/service/src/application.entry.ts', import.meta.url)).text();
  const authCheck = source.indexOf("if (!authorization.startsWith('Bearer ') || !tokenEqual(authorization.slice(7)))");
  const modalityDispatch = source.indexOf('const lemonadeModalityResponse = await lemonadeModalityRoutes(request, url)');
  expect(authCheck).toBeGreaterThanOrEqual(0);
  expect(modalityDispatch).toBeGreaterThan(authCheck);
  expect(source).toContain("return new Response('Unauthorized', { status: 401 })");
});
