import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { LocalAiModality } from '../../../../apps/web/src/models/local-ai/local-ai-modality.component';
import { createServiceClient } from '../../../../apps/web/src/shared/service-client.hook';
import '../../../support/web-dom.adapter';


const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

async function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const previousFetch = globalThis.fetch;
  const calls: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/bootstrap')) return Response.json({ token: 'test-session' });
    const path = new URL(String(url)).pathname; calls.push({ path, init: init ?? {} });
    return respond(path, init ?? {});
  }) as typeof fetch;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(LocalAiModality, { client: createServiceClient('http://127.0.0.1:4477') })));
  const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === text)!;
  const input = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const select = async (value: string) => act(async () => { const element = host.querySelector('select')!; element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
  return { host, calls, button, input, select, run: async () => act(async () => button('Run modality request').click()), cleanup: async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = previousFetch; } };
}

test('all remaining JSON families send exact authenticated service requests including slot controls', async () => {
  const ui = await setup(() => Response.json({ results: [{ index: 0, relevance_score: 0.8 }] }));
  try {
    await ui.input(ui.host.querySelector('input')!, 'fixture-model');
    for (const [action, route, value] of [
      ['rerank', 'rerank', { query: 'q', documents: ['d'] }],
      ['classify', 'classify', { input: 'text', top_k: 2 }],
      ['tokenize', 'tokenize', { content: 'text', with_pieces: true }],
      ['embeddings', 'embeddings', { input: ['text'] }],
    ] as const) {
      await ui.select(action); await ui.input(ui.host.querySelector('textarea')!, JSON.stringify(value)); await ui.run();
      const call = ui.calls.at(-1)!; expect(call.path).toBe(`/api/v1/local-ai/${route}`);
      expect(JSON.parse(String(call.init.body))).toEqual({ ...value, ...(action === 'tokenize' ? {} : { model: 'fixture-model' }) });
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer test-session');
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
    await ui.select('slots'); await act(async () => ui.button('List slots').click());
    expect(ui.calls.at(-1)!.init.method).toBe('GET'); expect(ui.calls.at(-1)!.init.body).toBeUndefined();
    for (const action of ['save', 'restore', 'erase']) {
      const value = { id: 0, action, ...(action === 'erase' ? {} : { input: { filename: 'slot.bin' } }) };
      await ui.input(ui.host.querySelector('textarea')!, JSON.stringify(value)); await ui.run();
      expect(JSON.parse(String(ui.calls.at(-1)!.init.body))).toEqual(value);
    }
    const count = ui.calls.length;
    await ui.input(ui.host.querySelector('textarea')!, '{"id":-1,"action":"erase"}'); await ui.run();
    expect(ui.calls).toHaveLength(count); expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain('nonnegative');
    await ui.input(ui.host.querySelector('textarea')!, '{"id":0,"action":"save","input":{"filename":"../unsafe"}}'); await ui.run(); expect(ui.calls).toHaveLength(count);
  } finally { await ui.cleanup(); }
});

test('transcription uploads multipart audio and selected language and subtitle format', async () => {
  const ui = await setup(() => Response.json({ text: 'Recognized speech' }));
  try {
    await ui.select('transcription'); await ui.input(ui.host.querySelector('input')!, 'whisper');
    await ui.input(ui.host.querySelector('textarea')!, '{"language":"en","response_format":"srt"}');
    await ui.run(); expect(ui.calls).toHaveLength(0); expect(ui.host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { const file = ui.host.querySelector('input[type="file"]')!; Object.defineProperty(file, 'files', { configurable: true, value: [new File(['audio'], 'sample.wav', { type: 'audio/wav' })] }); file.dispatchEvent(new Event('change', { bubbles: true })); });
    await ui.run(); const call = ui.calls[0]!; const body = call.init.body as FormData;
    expect(call.path).toBe('/api/v1/local-ai/audio/transcriptions'); expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(File); expect(body.get('language')).toBe('en'); expect(body.get('response_format')).toBe('srt'); expect(body.get('model')).toBe('whisper');
    expect(new Headers(call.init.headers).has('content-type')).toBe(false); expect(ui.host.textContent).toContain('Recognized speech');
  } finally { await ui.cleanup(); }
});

test('speech supports playback and a generated image is offered for download with URL replacement cleanup', async () => {
  const previousCreate = URL.createObjectURL; const previousRevoke = URL.revokeObjectURL; const revoked: string[] = []; let next = 0;
  URL.createObjectURL = () => `blob:test-${++next}`; URL.revokeObjectURL = (url) => { revoked.push(url); };
  const ui = await setup((path) => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': path.includes('/images/') ? 'image/png' : 'audio/wav' } }));
  try {
    await ui.input(ui.host.querySelector('input')!, 'speech-model'); await ui.select('speech'); await ui.run();
    expect(ui.calls[0]!.path).toBe('/api/v1/local-ai/audio/speech'); expect(ui.host.querySelector('audio')?.getAttribute('src')).toBe('blob:test-1');
    expect(ui.host.querySelector('a[download]')?.getAttribute('download')).toEndWith('.wav');
    await ui.select('image-generation'); expect(revoked).toContain('blob:test-1');
    await ui.input(ui.host.querySelector('textarea')!, '{"prompt":"a tree"}'); await ui.run();
    expect(ui.host.querySelector('a[download]')?.getAttribute('download')).toEndWith('.png'); expect(ui.host.querySelector('[aria-label="Generated media"]')).not.toBeNull();
    expect(ui.host.querySelector('iframe, object, embed')).toBeNull();
  } finally { await ui.cleanup(); expect(revoked).toContain('blob:test-2'); URL.createObjectURL = previousCreate; URL.revokeObjectURL = previousRevoke; }
});

test('oversized streaming responses are cancelled before preview creation and unmount aborts pending requests', async () => {
  let cancelled = false;
  const ui = await setup(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'audio/wav' } }));
  try {
    await ui.input(ui.host.querySelector('input')!, 'model'); await ui.select('speech'); await ui.run();
    expect(cancelled).toBe(true); expect(ui.host.querySelector('[role="alert"]')).not.toBeNull(); expect(ui.host.querySelector('a[download]')).toBeNull();
  } finally { await ui.cleanup(); }
  const captured: { signal?: AbortSignal } = {};
  const pending = await setup((_path, init) => { captured.signal = init.signal as AbortSignal; return new Promise<Response>((_resolve, reject) => captured.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })); });
  try { await pending.input(pending.host.querySelector('input')!, 'model'); await pending.run(); expect(captured.signal?.aborted).toBe(false); }
  finally { await pending.cleanup(); }
  expect(captured.signal?.aborted).toBe(true);
});
