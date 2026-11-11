import { expect, test } from 'bun:test';
import { createRealtimeRelay, type RealtimeRelayData } from '../../../apps/service/src/realtime-relay.service';

// Bun supports request headers in its service-side WebSocket constructor.
const BunSocket = WebSocket as unknown as { new(url: string, options: { headers: Record<string, string> }): WebSocket };
const origin = 'http://127.0.0.1:5173';
const descriptor = { instanceId: 'fixture', generation: 1, release: '2026.42.1', baseOrigin: 'http://127.0.0.1:13305', resolveSecret: async () => 'runtime-private-key' };
class Upstream extends EventTarget {
  sent: string[] = []; closed = false; onClosed?: () => void; onSent?: () => void;
  send(value: string) { this.sent.push(value); this.onSent?.(); }
  close() { this.closed = true; this.onClosed?.(); }
  emit(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
function fixture(extra: Partial<Parameters<typeof createRealtimeRelay>[0]> = {}) {
  const upstream = new Upstream();
  const relay = createRealtimeRelay({ getDescriptor: () => descriptor, allowedOrigins: [origin], authorize: (request) => request.headers.get('authorization') === 'Bearer air-token', connect: async () => upstream as unknown as WebSocket, ...extra });
  const server = Bun.serve<RealtimeRelayData>({ hostname: '127.0.0.1', port: 0, websocket: relay.websocket, async fetch(request, server) {
    if (new URL(request.url).pathname.endsWith('/ticket')) return await relay.ticketRoute(request) ?? new Response(null, { status: 404 });
    return relay.upgrade(request, server);
  } });
  const base = `http://127.0.0.1:${server.port}/api/v1/local-ai/realtime`;
  const ticket = (headers: Record<string, string> = {}, body = JSON.stringify({ model: 'Whisper-Tiny' })) => fetch(`${base}/ticket`, { method: 'POST', headers: { origin, authorization: 'Bearer air-token', ...headers }, body });
  return { upstream, relay, server, base, ticket, dispose() { relay.dispose(); server.stop(true); } };
}
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Message timed out')), 1500); ws.addEventListener('message', (event) => { clearTimeout(timer); resolve(JSON.parse(String(event.data)) as Record<string, unknown>); }, { once: true }); });
}
async function open(f: ReturnType<typeof fixture>): Promise<WebSocket> {
  const { ticket } = await (await f.ticket()).json() as { ticket: string };
  const ws = new BunSocket(f.base.replace('http:', 'ws:') + `?ticket=${ticket}`, { headers: { origin } });
  expect(await nextMessage(ws)).toEqual({ type: 'air.realtime.ready' }); return ws;
}
const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code), { once: true }));

test('ticket creation requires AIR authentication, exact allowed origin and a bounded valid model body', async () => {
  const f = fixture();
  try {
    expect((await f.ticket({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await f.ticket({ origin: `${origin}.evil.example` })).status).toBe(403);
    expect((await f.ticket({ origin: '' })).status).toBe(403);
    expect((await f.ticket({}, '{}')).status).toBe(400);
    expect((await f.ticket({}, 'x'.repeat(1025))).status).toBe(413);
    const response = await f.ticket(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('runtime-private-key');
  } finally { f.dispose(); }
});

test('tickets expire, bind to origin, consume once, and release failed upgrade reservations', async () => {
  let now = 0; const f = fixture({ now: () => now, allowedOrigins: [origin, 'http://localhost:5173'] });
  try {
    const { ticket } = await (await f.ticket()).json() as { ticket: string };
    const request = (originValue = origin) => new Request(`${f.base}?ticket=${ticket}`, { headers: { origin: originValue, upgrade: 'websocket' } });
    expect(f.relay.upgrade(request('http://evil.test'), { upgrade: () => true })?.status).toBe(403);
    expect(f.relay.upgrade(request('http://localhost:5173'), { upgrade: () => true })?.status).toBe(401);
    expect(f.relay.upgrade(request(), { upgrade: () => false })?.status).toBe(400);
    expect(f.relay.upgrade(request(), { upgrade: () => true })?.status).toBe(401);
    const expired = await (await f.ticket()).json() as { ticket: string }; now = 30_001;
    expect(f.relay.upgrade(new Request(`${f.base}?ticket=${expired.ticket}`, { headers: { origin, upgrade: 'websocket' } }), { upgrade: () => true })?.status).toBe(401);
    expect((await f.ticket()).status).toBe(200);
  } finally { f.dispose(); }
});

test('real Bun upgrade relays PCM events, binds session model, sanitizes errors, and cleans both ends', async () => {
  const f = fixture(); let ws: WebSocket | undefined;
  try {
    ws = await open(f);
    const received = new Promise<void>((resolve) => { f.upstream.onSent = () => { if (f.upstream.sent.length === 2) resolve(); }; });
    ws.send(JSON.stringify({ type: 'session.update', session: { model: 'untrusted-model', turn_detection: null } }));
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' })); await received;
    const final = nextMessage(ws); f.upstream.emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello' });
    expect(await final).toEqual({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello' });
    expect(f.upstream.sent.map((value) => JSON.parse(value))).toEqual([{ type: 'session.update', session: { model: 'Whisper-Tiny', turn_detection: null } }, { type: 'input_audio_buffer.append', audio: 'AAAA' }]);
    const failed = nextMessage(ws); f.upstream.emit({ type: 'error', error: { message: 'runtime-private-key' } }); expect(JSON.stringify(await failed)).not.toContain('runtime-private-key');
    const created = nextMessage(ws); f.upstream.emit({ type: 'session.created', session: { secret: 'runtime-private-key' } }); expect(await created).toEqual({ type: 'session.created' });
    const upstreamClosed = new Promise<void>((resolve) => { f.upstream.onClosed = resolve; }); ws.close(); await upstreamClosed; expect(f.upstream.closed).toBe(true);
  } finally { ws?.close(); f.dispose(); }
});

test('ticket pool and active sessions share a bounded capacity; dispose invalidates tickets', async () => {
  const f = fixture({ maxSessions: 1 });
  try {
    const { ticket } = await (await f.ticket()).json() as { ticket: string }; expect((await f.ticket()).status).toBe(429);
    f.relay.dispose();
    expect(f.relay.upgrade(new Request(`${f.base}?ticket=${ticket}`, { headers: { origin, upgrade: 'websocket' } }), { upgrade: () => true })?.status).toBe(401);
    expect((await f.ticket()).status).toBe(503);
  } finally { f.dispose(); }
});

test('runtime connect timeout closes the browser and aborts pending work', async () => {
  let signal: AbortSignal | undefined; let resolve: ((value: WebSocket) => void) | undefined;
  const f = fixture({ connectTimeoutMs: 15, connect: async (_model, value) => { signal = value; return new Promise<WebSocket>((complete) => { resolve = complete; }); } });
  try {
    const { ticket } = await (await f.ticket()).json() as { ticket: string };
    const ws = new BunSocket(f.base.replace('http:', 'ws:') + `?ticket=${ticket}`, { headers: { origin } });
    expect(await closed(ws)).toBe(1011); expect(signal?.aborted).toBe(true);
    const lateClosed = new Promise<void>((complete) => { f.upstream.onClosed = complete; }); resolve?.(f.upstream as unknown as WebSocket); await lateClosed; expect(f.upstream.closed).toBe(true);
  } finally { f.dispose(); }
});

test('binary messages and unsupported operations close the session without forwarding', async () => {
  for (const payload of [new Uint8Array([1, 2]), JSON.stringify({ type: 'admin.command' }), JSON.stringify({ type: 'input_audio_buffer.append', audio: 'invalid!' })]) {
    const f = fixture();
    try { const ws = await open(f); const result = closed(ws); ws.send(payload); expect([1008, 1009]).toContain(await result); expect(f.upstream.sent).toHaveLength(0); expect(f.upstream.closed).toBe(true); }
    finally { f.dispose(); }
  }
});

test('message size, message rate, upstream malformed events and session lifetime are bounded', async () => {
  for (const action of ['size', 'rate', 'malformed', 'lifetime'] as const) {
    const f = fixture(action === 'lifetime' ? { sessionMs: 25 } : {});
    try {
      const ws = await open(f); const result = closed(ws);
      if (action === 'size') ws.send('x'.repeat(256 * 1024 + 1));
      if (action === 'rate') for (let index = 0; index < 101; index++) ws.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
      if (action === 'malformed') f.upstream.dispatchEvent(new MessageEvent('message', { data: 'invalid json' }));
      expect(action === 'size' ? [1006, 1009] : [1001, 1002, 1009]).toContain(await result);
      // Max-payload rejection is handled by Bun, with module cleanup in the close callback.
      f.relay.dispose(); expect(f.upstream.closed).toBe(true);
    } finally { f.dispose(); }
  }
});
