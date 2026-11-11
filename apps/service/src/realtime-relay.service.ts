import { LemonadeRealtimeAdapter, type LemonadeRuntimeDescriptor } from '@office/providers/service';
import type { ServerWebSocket, WebSocketHandler } from 'bun';

export interface RealtimeRelayData { realtimeId: string }
type Client = Pick<ServerWebSocket<RealtimeRelayData>, 'data' | 'send' | 'close'>;
type Ticket = { model: string; origin: string; expires: number };
type Session = { model: string; client?: Client; upstream?: WebSocket; controller: AbortController; closed: boolean; bytes: number; count: number; window: number; timer: ReturnType<typeof setTimeout>; connectTimer?: ReturnType<typeof setTimeout> };
const BASE = '/api/v1/local-ai/realtime';
const MESSAGE_BYTES = 256 * 1024;
const SESSION_BYTES = 64 * 1024 * 1024;
const error = (status: number, message: string) => Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });

/** AIR auth is checked here for ticket creation; the WS capability is origin-bound and single use. */
export function createRealtimeRelay(options: {
  getDescriptor: () => LemonadeRuntimeDescriptor | null;
  authorize: (request: Request) => boolean | Promise<boolean>;
  allowedOrigins: readonly string[];
  connect?: (model: string, signal: AbortSignal) => Promise<WebSocket>;
  ticketTtlMs?: number;
  connectTimeoutMs?: number;
  sessionMs?: number;
  maxSessions?: number;
  now?: () => number;
}) {
  const tickets = new Map<string, Ticket>();
  const sessions = new Map<string, Session>();
  const now = options.now ?? Date.now;
  const limit = options.maxSessions ?? 4;
  const encoder = new TextEncoder();
  let disposed = false;
  const connect = options.connect ?? ((model, signal) => new LemonadeRealtimeAdapter(options.getDescriptor()!).connect({ model }, { signal }));
  const prune = () => { for (const [id, ticket] of tickets) if (ticket.expires <= now()) tickets.delete(id); };
  function finish(id: string, code = 1000, reason = 'Session closed') {
    const session = sessions.get(id); if (!session || session.closed) return;
    session.closed = true; sessions.delete(id); clearTimeout(session.timer); clearTimeout(session.connectTimer); session.controller.abort();
    session.upstream?.close(1000, 'AIR session closed'); session.client?.close(code, reason);
  }
  function bounded(session: Session, value: string): boolean {
    const bytes = encoder.encode(value).byteLength; session.bytes += bytes;
    if (now() - session.window >= 1000) { session.window = now(); session.count = 0; }
    return bytes <= MESSAGE_BYTES && session.bytes <= SESSION_BYTES && ++session.count <= 100;
  }
  const websocket: WebSocketHandler<RealtimeRelayData> = {
    maxPayloadLength: MESSAGE_BYTES, backpressureLimit: MESSAGE_BYTES, closeOnBackpressureLimit: true, idleTimeout: 120,
    open(client) {
      const id = client.data.realtimeId; const session = sessions.get(id);
      if (!session) { client.close(1008, 'Session expired'); return; }
      session.client = client;
      const timeout = setTimeout(() => finish(id, 1011, 'Runtime connection timed out'), options.connectTimeoutMs ?? 10_000);
      session.connectTimer = timeout;
      void Promise.resolve().then(() => connect(session.model, session.controller.signal)).then((upstream) => {
        clearTimeout(timeout);
        if (session.closed) { upstream.close(); return; }
        session.upstream = upstream;
        upstream.addEventListener('message', (event) => {
          if (session.closed) return;
          if (typeof event.data !== 'string' || !bounded(session, event.data)) { finish(id, 1009, 'Session data limit exceeded'); return; }
          // Raw runtime errors can contain private request URLs or credentials.
          let value: Record<string, unknown>;
          try { value = JSON.parse(event.data) as Record<string, unknown>; } catch { finish(id, 1002, 'Invalid runtime event'); return; }
          const type = value?.type;
          if (type === 'error') client.send(JSON.stringify({ type: 'error', error: { message: 'Transcription failed. Check the model and reconnect.' } }));
          else if (type === 'conversation.item.input_audio_transcription.delta' || type === 'conversation.item.input_audio_transcription.completed') client.send(JSON.stringify({ type, ...(typeof value.delta === 'string' ? { delta: value.delta } : {}), ...(typeof value.transcript === 'string' ? { transcript: value.transcript } : {}) }));
          else if (typeof type === 'string' && ['session.created', 'session.updated', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'input_audio_buffer.committed', 'input_audio_buffer.cleared'].includes(type)) client.send(JSON.stringify({ type }));
        });
        upstream.addEventListener('close', () => finish(id, 1011, 'Runtime disconnected'));
        upstream.addEventListener('error', () => finish(id, 1011, 'Runtime connection failed'));
        client.send(JSON.stringify({ type: 'air.realtime.ready' }));
      }).catch(() => { clearTimeout(timeout); finish(id, 1011, 'Runtime connection failed'); });
    },
    message(client, data) {
      const id = client.data.realtimeId; const session = sessions.get(id); if (!session) return;
      if (typeof data !== 'string' || !bounded(session, data)) { finish(id, 1009, 'Session data limit exceeded'); return; }
      if (!session.upstream) { finish(id, 1008, 'Wait for realtime readiness'); return; }
      if (session.upstream.bufferedAmount > MESSAGE_BYTES) { finish(id, 1011, 'Runtime connection is too slow'); return; }
      try {
        const input = JSON.parse(data) as Record<string, unknown>;
        if (input.type === 'input_audio_buffer.append' && typeof input.audio === 'string' && input.audio.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audio)) session.upstream.send(JSON.stringify({ type: input.type, audio: input.audio }));
        else if (input.type === 'input_audio_buffer.commit' || input.type === 'input_audio_buffer.clear') session.upstream.send(JSON.stringify({ type: input.type }));
        else if (input.type === 'session.update' && input.session && typeof input.session === 'object') {
          const config = input.session as Record<string, unknown>;
          // Bind the model to the ticket; only manual or default upstream VAD is selectable.
          session.upstream.send(JSON.stringify({ type: 'session.update', session: { model: session.model, turn_detection: config.turn_detection === null ? null : { threshold: 0.01, silence_duration_ms: 800, prefix_padding_ms: 250 } } }));
        } else finish(id, 1008, 'Unsupported realtime message');
      } catch { finish(id, 1002, 'Invalid realtime message'); }
    },
    close(client) { finish(client.data.realtimeId); },
  };
  return {
    websocket,
    async ticketRoute(request: Request): Promise<Response | null> {
      if (new URL(request.url).pathname !== `${BASE}/ticket`) return null;
      if (request.method !== 'POST') return error(405, 'Use POST to create a session.');
      if (!await options.authorize(request)) return error(401, 'AIR authentication is required.');
      const origin = request.headers.get('origin') ?? '';
      if (!options.allowedOrigins.includes(origin) || !origin) return error(403, 'Origin is not allowed.');
      const descriptor = options.getDescriptor();
      if (disposed || !descriptor) return error(503, 'Local AI is unavailable.');
      try { descriptor.inference?.signal(); }
      catch { return error(503, 'Local AI is off. Turn it on in the sidebar.'); }
      prune(); if (tickets.size + sessions.size >= limit) return error(429, 'Realtime capacity is full. Try again shortly.');
      try {
        // Incremental read also bounds bodies without Content-Length.
        const reader = request.body?.getReader(); if (!reader) return error(400, 'A model is required.');
        let text = ''; let bytes = 0; const decoder = new TextDecoder();
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1024) { await reader.cancel(); return error(413, 'Request is too large.'); } text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
        const input = JSON.parse(text) as { model?: unknown };
        if (typeof input?.model !== 'string' || !input.model.trim() || input.model.length > 200) return error(400, 'Enter a transcription model.');
        // Recheck after the asynchronous body read.
        prune(); if (disposed || tickets.size + sessions.size >= limit) return error(429, 'Realtime capacity is full.');
        descriptor.inference?.signal(input.model.trim());
        const ticket = crypto.randomUUID(); const expires = now() + (options.ticketTtlMs ?? 30_000);
        tickets.set(ticket, { model: input.model.trim(), origin, expires });
        return Response.json({ ticket, expiresAt: expires }, { headers: { 'Cache-Control': 'no-store' } });
      } catch { return error(400, 'Invalid realtime request.'); }
    },
    upgrade(request: Request, server: { upgrade(request: Request, options: { data: RealtimeRelayData }): boolean }): Response | undefined {
      const url = new URL(request.url); if (url.pathname !== BASE) return error(404, 'Unknown realtime route.');
      const origin = request.headers.get('origin') ?? '';
      if (!origin || !options.allowedOrigins.includes(origin)) return error(403, 'Origin is not allowed.');
      if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return error(400, 'A WebSocket upgrade is required.');
      prune(); const key = url.searchParams.get('ticket') ?? ''; const ticket = tickets.get(key);
      if (disposed || !ticket || ticket.origin !== origin) return error(401, 'Session ticket is invalid or expired.');
      tickets.delete(key);
      try { options.descriptor?.inference?.signal(ticket.model); }
      catch { return error(503, 'Local AI is off. Turn it on in the sidebar.'); }
      if (sessions.size >= limit) return error(429, 'Realtime capacity is full.');
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(id, 1001, 'Session time limit reached'), options.sessionMs ?? 10 * 60_000);
      sessions.set(id, { model: ticket.model, controller: new AbortController(), closed: false, bytes: 0, count: 0, window: now(), timer });
      try { if (server.upgrade(request, { data: { realtimeId: id } })) return undefined; } catch { /* Release the reserved slot on failed upgrades. */ }
      finish(id); return error(400, 'WebSocket upgrade failed.');
    },
    stopSessions() { tickets.clear(); for (const id of sessions.keys()) finish(id, 1001, 'Local AI turned off'); },
    dispose() { disposed = true; tickets.clear(); for (const id of sessions.keys()) finish(id, 1001, 'Service stopping'); },
  };
}
