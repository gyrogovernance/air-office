import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ServiceClient } from '../../../../apps/web/src/shared/service-client.hook';
import { RealtimeSpeech, createPcm16Encoder } from '../../../../apps/web/src/models/local-ai/realtime-speech.component';
import '../../../support/web-dom.adapter';

const { act } = await import('react'); const { createRoot } = await import('react-dom/client');
class Socket {
  readyState = 1; bufferedAmount = 0; closed = false; sent: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  event(value: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
function service(json: ServiceClient['json']): ServiceClient { return { base: 'http://127.0.0.1:9999', token: async () => 'AIR-token', request: async () => new Response(), json }; }

test('speech controls have readable labels, status, transcript and deliberate microphone start', () => {
  const html = renderToStaticMarkup(createElement(RealtimeSpeech, { model: '', client: service(async <T,>() => ({} as T)) }));
  for (const label of ['Start listening', 'Stop listening', 'Transcribe now', 'Discard buffered audio', 'Transcript', 'Microphone off.']) expect(html).toContain(label);
  expect(html).toContain('disabled'); expect(html).not.toContain('<pre>');
});

test('PCM conversion uses little endian 16 kHz signed samples and continuous fractional sampling', () => {
  const encode = createPcm16Encoder(48000); const raw = atob(encode(new Float32Array([-1, 0, 0, 1, 0, 0])));
  expect([...raw].map((value) => value.charCodeAt(0))).toEqual([0, 128, 255, 127]);
  const fractional = createPcm16Encoder(44100); let samples = 0;
  for (let index = 0; index < 100; index++) samples += atob(fractional(new Float32Array(441))).length / 2;
  expect(samples).toBe(16000); expect(() => createPcm16Encoder(8000)).toThrow();
});

test('authenticated ticket transport waits for readiness, replaces interim text, commits, clears and releases microphone', async () => {
  const calls: { path: string; init?: RequestInit }[] = []; const socket = new Socket(); let endpoint = ''; let captures = 0; let stops = 0; let sendAudio: ((audio: string) => void) | undefined;
  const client = service(async <T,>(path: string, init?: RequestInit) => { calls.push({ path, init }); return { ticket: 'single-use-ticket' } as T; });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll('button')].find((value) => value.textContent === text)!;
  try {
    await act(async () => root.render(createElement(RealtimeSpeech, { client, model: 'Whisper-Tiny', openSocket: (url) => { endpoint = url; return socket as unknown as WebSocket; }, capture: async (send) => { captures++; sendAudio = send; return { stop() { stops++; } }; } })));
    await act(async () => button('Start listening').click());
    expect(calls[0]?.path).toBe('/api/v1/local-ai/realtime/ticket'); expect(calls[0]?.init?.body).toBe(JSON.stringify({ model: 'Whisper-Tiny' }));
    expect(endpoint).toBe('ws://127.0.0.1:9999/api/v1/local-ai/realtime?ticket=single-use-ticket'); expect(endpoint).not.toContain('AIR-token'); expect(captures).toBe(0);
    await act(async () => socket.event({ type: 'air.realtime.ready' })); expect(captures).toBe(1);
    sendAudio?.('AAAA'); expect(socket.sent).toContainEqual({ type: 'input_audio_buffer.append', audio: 'AAAA' });
    await act(async () => { socket.event({ type: 'conversation.item.input_audio_transcription.delta', delta: 'first guess' }); socket.event({ type: 'conversation.item.input_audio_transcription.delta', delta: 'second guess' }); });
    expect(host.querySelector('textarea')!.value).toBe('second guess');
    await act(async () => socket.event({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Final words' })); expect(host.querySelector('textarea')!.value).toBe('Final words');
    await act(async () => { button('Transcribe now').click(); button('Discard buffered audio').click(); });
    expect(socket.sent).toContainEqual({ type: 'input_audio_buffer.commit' }); expect(socket.sent).toContainEqual({ type: 'input_audio_buffer.clear' });
    await act(async () => button('Stop listening').click()); expect(stops).toBe(1); expect(socket.closed).toBe(true); expect(host.querySelector('textarea')!.value).toBe('Final words');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('stop during permission request releases a late microphone and preserves existing transcript', async () => {
  const socket = new Socket(); let resolveCapture: ((value: { stop(): void }) => void) | undefined; let stops = 0;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(RealtimeSpeech, { client: service(async <T,>() => ({ ticket: 'ticket' } as T)), model: 'Whisper-Tiny', openSocket: () => socket as unknown as WebSocket, capture: () => new Promise<{ stop(): void }>((resolve) => { resolveCapture = resolve; }) })));
    await act(async () => host.querySelectorAll('button')[0]!.click()); await act(async () => socket.event({ type: 'air.realtime.ready' }));
    await act(async () => host.querySelectorAll('button')[1]!.click()); await act(async () => resolveCapture?.({ stop() { stops++; } }));
    expect(stops).toBe(1); expect(socket.closed).toBe(true); expect(host.textContent).toContain('Microphone off.');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test('runtime errors are readable, do not expose raw details, and permit reconnect', async () => {
  const socket = new Socket(); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(RealtimeSpeech, { client: service(async <T,>() => ({ ticket: 'ticket' } as T)), model: 'Whisper-Tiny', openSocket: () => socket as unknown as WebSocket })));
    await act(async () => host.querySelector('button')!.click()); await act(async () => socket.event({ type: 'error', error: { message: 'secret-key' } }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Check the model'); expect(host.textContent).not.toContain('secret-key'); expect(host.querySelector('button')!.disabled).toBe(false); expect(socket.closed).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
