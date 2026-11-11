import { LemonadeStatusError, type LemonadeRequestOptions, type LemonadeRuntimeDescriptor } from './lemonade-status.adapter';

export interface EmbeddingRequest { model: string; input: string | readonly string[]; encoding_format?: 'float' | 'base64'; }
export interface EmbeddingItem { object: 'embedding'; index: number; embedding: number[] | string; }
export interface EmbeddingResponse { object: 'list'; data: EmbeddingItem[]; model: string; usage?: Record<string, number>; }
export interface RerankRequest { model: string; query: string; documents: readonly string[]; }
export interface RerankItem { index: number; relevance_score: number; }
export interface RerankResponse { object: 'list'; model: string; results: RerankItem[]; usage?: Record<string, number>; }
export interface TranscriptionRequest { model: string; audio: Blob | ArrayBuffer | Uint8Array; fileName?: string; language?: string; response_format?: 'json' | 'verbose_json' | 'text' | 'srt' | 'vtt'; }
export interface TranscriptionResponse { text: string; [key: string]: unknown; }
export interface SpeechRequest { model: string; input: string; voice?: string; speed?: number; response_format?: 'mp3' | 'wav' | 'opus' | 'pcm'; stream_format?: 'audio'; reference_wav_b64?: string; voice_design_description?: string; }
export interface ImageGenerationRequest { model: string; prompt: string; size?: string; n?: number; response_format?: 'b64_json'; steps?: number; cfg_scale?: number; seed?: number; }
export interface ImageFileRequest { model: string; image: File | Blob; fileName?: string; prompt?: string; mask?: File | Blob; size?: string; n?: number; response_format?: 'b64_json'; }
export interface AudioGenerationRequest { model: string; prompt: string; lyrics?: string; vocal_language?: string; duration?: number; steps?: number; cfg?: number; seed?: number; response_format?: 'wav'; }

const DEFAULT_TIMEOUT = 30_000;
/**
 * A local model on a CPU can take minutes to draw a picture or write a track,
 * so the work that produces media waits longer than a quick request.
 */
const MEDIA_TIMEOUT = 600_000;

/** The options for a request that produces media, given a longer life. */
function mediaOptions(options?: LemonadeRequestOptions): LemonadeRequestOptions {
  return { timeoutMs: MEDIA_TIMEOUT, ...options };
}
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const text = (value: unknown, max = 100_000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/**
 * The message the runtime sent with a failure, so a person sees why the work
 * was refused instead of a generic error. The runtime answers with either
 * `{"error": "..."}` or `{"error": {"message": "..."}}`.
 */
async function upstreamDetail(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    if (!body.trim()) return null;
    try {
      const value: unknown = JSON.parse(body);
      if (typeof value === 'string') return value.slice(0, 500);
      if (record(value)) {
        const error = value.error;
        if (typeof error === 'string') return error.slice(0, 500);
        if (record(error) && typeof error.message === 'string') return error.message.slice(0, 500);
        if (typeof value.message === 'string') return value.message.slice(0, 500);
        if (typeof value.detail === 'string') return value.detail.slice(0, 500);
      }
    } catch { /* The runtime did not answer with JSON; use the raw text. */ }
    return body.slice(0, 500);
  } catch { return null; }
}

export class LemonadeModalityAdapter {
  private readonly origin: URL;
  constructor(private readonly descriptor: LemonadeRuntimeDescriptor, private readonly defaults: LemonadeRequestOptions = {}) {
    try {
      this.origin = new URL(descriptor.baseOrigin);
      if (!['http:', 'https:'].includes(this.origin.protocol) || this.origin.username || this.origin.password || this.origin.search || this.origin.hash) throw new Error();
    } catch { throw new LemonadeStatusError('invalid-request'); }
  }

  private async request(path: string, init: RequestInit, options: LemonadeRequestOptions = {}): Promise<Response> {
    const merged = { ...this.defaults, ...options };
    if (this.descriptor.inference) {
      let model: string | undefined;
      if (typeof init.body === 'string') {
        const body: unknown = JSON.parse(init.body);
        if (record(body) && typeof body.model === 'string') model = body.model;
      } else if (init.body instanceof FormData) {
        const value = init.body.get('model');
        if (typeof value === 'string') model = value;
      }
      const gate = this.descriptor.inference.signal(model);
      merged.signal = merged.signal ? AbortSignal.any([merged.signal, gate]) : gate;
    }
    const timeout = merged.timeoutMs ?? DEFAULT_TIMEOUT;
    const limit = merged.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(limit) || limit < 1) throw new LemonadeStatusError('invalid-request');
    const controller = new AbortController();
    const abort = () => controller.abort(merged.signal?.reason);
    merged.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeout);
    try {
      if (merged.signal?.aborted) throw new LemonadeStatusError('cancelled');
      const secret = await this.descriptor.resolveSecret();
      if (!secret) throw new LemonadeStatusError('unavailable');
      const response = await (merged.request ?? fetch)(new URL(path, this.origin), { ...init, headers: { authorization: `Bearer ${secret}`, accept: 'application/json', ...init.headers, }, signal: controller.signal });
      const length = response.headers.get('content-length');
      if (length && Number(length) > limit) { await response.body?.cancel(); throw new LemonadeStatusError('protocol', response.status); }
      if (!response.ok) { const detail = await upstreamDetail(response); throw new LemonadeStatusError('upstream', response.status, detail); }
      return response;
    } catch (error) {
      if (error instanceof LemonadeStatusError) throw error;
      throw new LemonadeStatusError(merged.signal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally { clearTimeout(timer); merged.signal?.removeEventListener('abort', abort); }
  }

  private async json<T>(path: string, body: object, options?: LemonadeRequestOptions): Promise<T> {
    const response = await this.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, options);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const limit = options?.maxResponseBytes ?? this.defaults.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    if (bytes.byteLength > limit) throw new LemonadeStatusError('protocol', response.status);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; } catch { throw new LemonadeStatusError('protocol', response.status); }
  }

  async imageGeneration(input: ImageGenerationRequest, options?: LemonadeRequestOptions): Promise<Response> {
    if (!text(input.model) || !text(input.prompt) || input.size !== undefined && !/^\d{1,5}x\d{1,5}$/.test(input.size) || input.n !== undefined && input.n !== 1 || input.response_format !== undefined && input.response_format !== 'b64_json') throw new LemonadeStatusError('invalid-request');
    return this.request('/v1/images/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, mediaOptions(options));
  }

  async imageEdit(input: ImageFileRequest, options?: LemonadeRequestOptions): Promise<Response> { return this.imageFile('/v1/images/edits', input, true, options); }
  async imageVariation(input: ImageFileRequest, options?: LemonadeRequestOptions): Promise<Response> { return this.imageFile('/v1/images/variations', input, false, options); }
  private async imageFile(path: string, input: ImageFileRequest, edit: boolean, options?: LemonadeRequestOptions): Promise<Response> {
    if (!text(input.model) || !(input.image instanceof Blob) || edit && !text(input.prompt) || input.n !== undefined && (!Number.isSafeInteger(input.n) || input.n < 1 || input.n > 10) || input.response_format !== undefined && input.response_format !== 'b64_json') throw new LemonadeStatusError('invalid-request');
    const form = new FormData(); form.append('model', input.model); form.append('image', input.image, input.fileName ?? 'image.png');
    if (edit && input.prompt) form.append('prompt', input.prompt); if (edit && input.mask) form.append('mask', input.mask, 'mask.png');
    if (input.size) form.append('size', input.size); if (input.n !== undefined) form.append('n', String(input.n)); if (input.response_format) form.append('response_format', input.response_format);
    return this.request(path, { method: 'POST', body: form }, mediaOptions(options));
  }
  async audioGeneration(input: AudioGenerationRequest, options?: LemonadeRequestOptions): Promise<Response> {
    if (!text(input.model) || !text(input.prompt) || input.response_format !== undefined && input.response_format !== 'wav') throw new LemonadeStatusError('invalid-request');
    return this.request('/v1/audio/generations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, mediaOptions(options));
  }

  async embeddings(input: EmbeddingRequest, options?: LemonadeRequestOptions): Promise<EmbeddingResponse> {
    if (!text(input.model) || !(text(input.input) || Array.isArray(input.input) && input.input.length > 0 && input.input.every((value) => text(value)))) throw new LemonadeStatusError('invalid-request');
    const response = await this.json<unknown>('/v1/embeddings', input, options);
    if (!record(response) || response.object !== 'list' || !Array.isArray(response.data) || !response.data.every((item) => record(item) && Number.isSafeInteger(item.index) && (Array.isArray(item.embedding) || typeof item.embedding === 'string'))) throw new LemonadeStatusError('protocol');
    return response as unknown as EmbeddingResponse;
  }

  async rerank(input: RerankRequest, options?: LemonadeRequestOptions): Promise<RerankResponse> {
    if (!text(input.model) || !text(input.query) || !Array.isArray(input.documents) || input.documents.length === 0 || input.documents.some((value) => !text(value))) throw new LemonadeStatusError('invalid-request');
    const response = await this.json<unknown>('/v1/rerank', input, options);
    if (!record(response) || response.object !== 'list' || !Array.isArray(response.results) || !response.results.every((item) => record(item) && Number.isSafeInteger(item.index) && typeof item.relevance_score === 'number')) throw new LemonadeStatusError('protocol');
    return response as unknown as RerankResponse;
  }

  async transcribe(input: TranscriptionRequest, options?: LemonadeRequestOptions): Promise<TranscriptionResponse> {
    if (!text(input.model) || !(input.audio instanceof Blob || input.audio instanceof ArrayBuffer || input.audio instanceof Uint8Array)) throw new LemonadeStatusError('invalid-request');
    const form = new FormData();
    const bytes = input.audio instanceof Uint8Array ? input.audio.slice().buffer as ArrayBuffer : input.audio;
    const audio = input.audio instanceof Blob ? input.audio : new Blob([bytes]);
    form.append('file', audio, input.fileName ?? 'audio.wav'); form.append('model', input.model);
    if (input.language) form.append('language', input.language); if (input.response_format) form.append('response_format', input.response_format);
    const response = await this.request('/v1/audio/transcriptions', { method: 'POST', body: form }, options);
    const raw = await response.text();
    if (input.response_format === 'text' || input.response_format === 'srt' || input.response_format === 'vtt') return { text: raw };
    try { const parsed: unknown = JSON.parse(raw); if (!record(parsed) || typeof parsed.text !== 'string') throw new Error(); return parsed as TranscriptionResponse; } catch { throw new LemonadeStatusError('protocol', response.status); }
  }

  async speech(input: SpeechRequest, options?: LemonadeRequestOptions): Promise<Blob> {
    if (!text(input.model) || !text(input.input) || input.speed !== undefined && (!Number.isFinite(input.speed) || input.speed <= 0)) throw new LemonadeStatusError('invalid-request');
    const response = await this.request('/v1/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, options);
    return new Blob([await response.arrayBuffer()], { type: response.headers.get('content-type') ?? 'audio/mpeg' });
  }
}

export interface LemonadeAudioRealtimeOptions { model: string; }
const REALTIME_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const REALTIME_MAX_SESSION_BYTES = 64 * 1024 * 1024;

/** Pinned Lemonade realtime uses WebSocket /realtime on the main HTTP port. */
export class LemonadeRealtimeAdapter {
  private readonly origin: URL;
  constructor(private readonly descriptor: LemonadeRuntimeDescriptor) {
    try {
      this.origin = new URL(descriptor.baseOrigin);
      if (!['http:', 'https:'].includes(this.origin.protocol) || this.origin.username || this.origin.password || this.origin.search || this.origin.hash) throw new Error();
    } catch { throw new LemonadeStatusError('invalid-request'); }
  }
  async connect(input: LemonadeAudioRealtimeOptions, options: { signal?: AbortSignal; webSocket?: typeof WebSocket; timeoutMs?: number } = {}): Promise<WebSocket> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!text(input.model, 200) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new LemonadeStatusError('invalid-request');
    if (options.signal?.aborted) throw new LemonadeStatusError('cancelled');
    const secret = await this.descriptor.resolveSecret();
    if (options.signal?.aborted) throw new LemonadeStatusError('cancelled');
    if (!secret) throw new LemonadeStatusError('unavailable');
    const WebSocketConstructor = options.webSocket ?? globalThis.WebSocket;
    if (!WebSocketConstructor) throw new LemonadeStatusError('unavailable');
    const endpoint = new URL('/realtime', this.origin);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    endpoint.searchParams.set('model', input.model);
    // Lemonade authenticates realtime WebSocket sessions using its documented API-key query parameter.
    endpoint.searchParams.set('api_key', secret);
    return await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocketConstructor(endpoint);
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); socket.close(); reject(new LemonadeStatusError('timeout')); } }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      const abort = () => { socket.close(); cleanup(); if (!settled) { settled = true; reject(new LemonadeStatusError('cancelled')); } };
      options.signal?.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () => {
        if (settled || options.signal?.aborted) { socket.close(); return; }
        settled = true; clearTimeout(timer);
        let sessionBytes = 0;
        socket.addEventListener('message', (event) => {
          const size = typeof event.data === 'string' ? new TextEncoder().encode(event.data).byteLength : event.data instanceof Blob ? event.data.size : event.data instanceof ArrayBuffer ? event.data.byteLength : 0;
          sessionBytes += size;
          if (size > REALTIME_MAX_MESSAGE_BYTES || sessionBytes > REALTIME_MAX_SESSION_BYTES) socket.close(1009, 'Session data limit exceeded');
        });
        resolve(socket);
      }, { once: true });
      socket.addEventListener('error', () => { cleanup(); if (!settled) { settled = true; reject(new LemonadeStatusError('unavailable')); } }, { once: true });
      socket.addEventListener('close', () => { cleanup(); if (!settled) { settled = true; reject(new LemonadeStatusError('unavailable')); } }, { once: true });
    });
  }
}

export type { LemonadeRuntimeDescriptor, LemonadeRequestOptions };
