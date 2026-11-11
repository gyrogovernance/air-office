import { useEffect, useRef, useState } from 'react';
import { Button, Input, TextArea } from '@heroui/react';
import { CollapsibleSection } from '../../shared/collapsible-section.component';
import type { ServiceClient } from '../../shared/service-client.hook';
import { SelectField } from '../../shared/select-field.component';
const MB = 1024 * 1024;
const actions = {
  'image-generation': { label: 'Image generation', route: 'images/generations', example: { prompt: 'A red kite', n: 1 }, help: 'prompt is required. Optional size, steps, cfg_scale, seed and response_format: b64_json.' },
  'audio-generation': { label: 'Audio generation', route: 'audio/generations', example: { prompt: 'Soft piano', duration: 5, response_format: 'wav' }, help: 'prompt is required. Optional lyrics, vocal_language, duration, steps, cfg and seed.' },
  'image-edit': { label: 'Image edit', route: 'images/edits', example: { prompt: 'Add a blue sky' }, help: 'Upload an image and optional mask. prompt is required. Optional size, n (1–10), response_format: b64_json.' },
  'image-variation': { label: 'Image variation', route: 'images/variations', example: {}, help: 'Upload an image. Optional size, n (1–10), response_format: b64_json. Variation does not accept a prompt.' },
  rerank: { label: 'Rerank', route: 'rerank', example: { query: 'What is AIR Office?', documents: ['An AI workspace', 'A weather report'] }, help: 'query is text; documents is a nonempty array of text strings. Results include document indexes and relevance scores.' },
  transcription: { label: 'File transcription', route: 'audio/transcriptions', example: { response_format: 'json' }, help: 'Upload audio as multipart file. Optional language and response_format: json, verbose_json, text, srt or vtt.' },
  speech: { label: 'Speech', route: 'audio/speech', example: { input: 'Hello from AIR Office', response_format: 'wav' }, help: 'input is required text. Optional voice, speed, response_format: mp3, wav, opus or pcm; stream_format: audio; reference_wav_b64; voice_design_description. Raw PCM can be saved but requires an external player with matching audio settings.' },
  classify: { label: 'Classification', route: 'classify', example: { input: 'A short text to classify', top_k: 3 }, help: 'input is required text; top_k is an optional positive integer. Model is optional.' },
  tokenize: { label: 'Tokenize', route: 'tokenize', example: { content: 'Hello world', with_pieces: true }, help: 'content is required text. Optional add_special, parse_special and with_pieces booleans. Uses the loaded model, without a model field.' },
  embeddings: { label: 'Embeddings', route: 'embeddings', example: { input: ['A short text'], encoding_format: 'float' }, help: 'input is text or an array of text. Optional encoding_format: float or base64.' },
  slots: { label: 'Slot cache controls', route: 'slots', example: { id: 0, action: 'save', input: { filename: 'slot-cache.bin' } }, help: 'Use List slots to inspect slots. Control JSON requires a nonnegative integer id and action: save, restore or erase. Save and restore require input.filename, a plain filename of at most 120 characters without directories. Erase removes the slot cache.' },
} as const;
type Action = keyof typeof actions;
type Media = { url: string; type: string; filename: string };

async function boundedBlob(response: Response, signal: AbortSignal): Promise<Blob> {
  const limit = 16 * MB;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('The response exceeds the 16 MB display limit.'); }
  const reader = response.body?.getReader();
  if (!reader) return new Blob([]);
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('The response exceeds the 16 MB display limit.'); }
      chunks.push(new Uint8Array(next.value));
    }
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

export function LocalAiModality({ client, models: availableModels, workplace = false }: { client: ServiceClient; models?: string[]; workplace?: boolean }) {
  const [model, setModel] = useState('');
  const [action, setAction] = useState<Action>('image-generation');
  const [payload, setPayload] = useState('{}');
  const [workplacePrompt, setWorkplacePrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mask, setMask] = useState<File | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const preview = useRef<string | null>(null);
  function clearMedia() { if (preview.current) URL.revokeObjectURL(preview.current); preview.current = null; setMedia(null); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); if (preview.current) URL.revokeObjectURL(preview.current); preview.current = null; }; }, []);
  const multipart = action === 'transcription' || action === 'image-edit' || action === 'image-variation';
  const needsModel = workplace || (action !== 'slots' && action !== 'tokenize' && action !== 'classify');
  async function run(listSlots = false) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setError(''); setNotice(''); setResult(null); clearMedia();
    try {
      let body: BodyInit | undefined;
      let input: Record<string, unknown> = {};
      if (!listSlots) {
        if (workplace) { input = { prompt: workplacePrompt, ...(action === 'audio-generation' ? { duration: 5, response_format: 'wav' } : {}) }; }
        else { const parsed: unknown = JSON.parse(payload);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request JSON must be an object.');
        input = { ...parsed } as Record<string, unknown>;
        delete input.model;
        }
        if (needsModel && !model.trim()) throw new Error('Select an available model.');
        if (action !== 'slots' && action !== 'tokenize' && model.trim()) input.model = model.trim();
        const sizeLimit = action === 'classify' || action === 'tokenize' ? 512_000 : 12 * MB;
        if (new TextEncoder().encode(JSON.stringify(input)).byteLength > sizeLimit) throw new Error(`Request JSON exceeds the ${sizeLimit === 512_000 ? '512 KB' : '12 MB'} limit.`);
        if (multipart) {
          if (!file) throw new Error(action === 'transcription' ? 'Choose an audio file.' : 'Choose an image file.');
          if (file.size > 12 * MB || (mask && mask.size > 12 * MB)) throw new Error('Uploaded files must be 12 MB or smaller.');
          if (action === 'image-edit' && (typeof input.prompt !== 'string' || !input.prompt.trim())) throw new Error('Image edit requires a prompt in the JSON request.');
          const form = new FormData(); form.set('model', model.trim()); form.set(action === 'transcription' ? 'file' : 'image', file);
          const keys = action === 'transcription' ? ['language', 'response_format'] : ['size', 'n', 'response_format', ...(action === 'image-edit' ? ['prompt'] : [])];
          for (const key of keys) if (input[key] !== undefined) form.set(key, String(input[key]));
          if (action === 'image-edit' && mask) form.set('mask', mask);
          body = form;
        } else {
          if (action === 'slots') {
            if (!Number.isSafeInteger(input.id) || Number(input.id) < 0 || !['save', 'restore', 'erase'].includes(String(input.action))) throw new Error('Slot controls require a nonnegative integer id and save, restore or erase action.');
            if (input.action !== 'erase') {
              const filename = (input.input as { filename?: unknown } | undefined)?.filename;
              if (typeof filename !== 'string' || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,119}$/.test(filename) || filename.endsWith('.')) throw new Error('Enter a plain cache filename of at most 120 characters.');
            }
          }
          body = JSON.stringify(input);
        }
      }
      setBusy(true);
      const response = await client.request(`/api/v1/local-ai/${actions[action].route}`, { method: listSlots ? 'GET' : 'POST', body, signal: controller.signal, ...(body instanceof FormData || listSlots ? {} : { headers: { 'content-type': 'application/json' } }) });
      const blob = await boundedBlob(response, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const type = blob.type.split(';')[0]!.toLowerCase();
      if (!response.ok) {
        const detail = await blob.text(); let message = `AIR request failed (${response.status}).`;
        try { const value = JSON.parse(detail) as { error?: { message?: string } }; if (typeof value.error?.message === 'string') message = value.error.message; } catch { /* Keep the bounded status message for non-JSON errors. */ }
        throw new Error(message);
      }
      if (type === 'application/json' || type.endsWith('+json')) {
        const value: unknown = JSON.parse(await blob.text());
        if (!mounted.current || controller.signal.aborted) return;
        setResult(value);
      } else {
        const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type);
        const isAudio = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/opus', 'audio/webm'].includes(type);
        const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'opus' } as Record<string, string>)[type] ?? 'bin';
        const url = URL.createObjectURL(blob); preview.current = url;
        setMedia({ url, type: isImage ? 'image' : isAudio ? 'audio' : 'download', filename: `air-office-${action}.${extension}` });
        setResult({ contentType: type, bytes: blob.size, download: 'Generated file ready' });
      }
      setNotice('Modality request completed.');
    } catch (reason) { if (mounted.current) setError(controller.signal.aborted ? 'Modality request cancelled.' : reason instanceof Error ? reason.message : 'The Local AI request failed.'); }
    finally { if (pending.current === controller) pending.current = null; if (mounted.current) setBusy(false); }
  }
  return <section aria-label={workplace ? 'Create media' : 'Modality test controls'}><h3>{workplace ? 'Create with Local AI' : 'Modality tests'}</h3><p>{workplace ? 'Generate an image or audio using a model available in Local AI.' : 'Requests use authenticated AIR routes. JSON and uploaded files are limited to 12 MB each; classification and tokenization JSON to 512 KB. Responses are limited to 16 MB.'}</p>
    <form className="team-actions" onSubmit={(event) => { event.preventDefault(); void run(); }}>
      <label>Model{needsModel ? ' (required)' : ' (optional)'}{availableModels ? <SelectField aria-label="Model" value={model} disabled={busy} onValueChange={setModel}><option value="">Select an available model</option>{availableModels.map((id) => <option key={id} value={id}>{id}</option>)}</SelectField> : <Input value={model} disabled={busy || action === 'slots' || action === 'tokenize'} onChange={(event) => setModel(event.target.value)} />}</label>
      <label>Operation<SelectField aria-label="Operation" value={action} disabled={busy} onValueChange={(value) => { const next = value as Action; setAction(next); setPayload(JSON.stringify(actions[next].example, null, 2)); setFile(null); setMask(null); clearMedia(); setResult(null); setError(''); setNotice(''); }}>{(workplace ? (['image-generation', 'audio-generation'] as const) : Object.keys(actions) as Action[]).map((id) => <option key={id} value={id}>{actions[id].label}</option>)}</SelectField></label>
      {!workplace && <><p id="modality-request-help">{actions[action].help}</p>
      <label>Request JSON<TextArea value={payload} disabled={busy} aria-describedby="modality-request-help" onChange={(event) => setPayload(event.target.value)} /></label>
      <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => setPayload(JSON.stringify(actions[action].example, null, 2))}>Use example request</Button></>}
      {workplace && <label>Prompt<TextArea value={workplacePrompt} disabled={busy} onChange={(event) => setWorkplacePrompt(event.target.value)} /></label>}
      {multipart && <label>{action === 'transcription' ? 'Audio' : 'Image'} file (maximum 12 MB)<input key={action} type="file" disabled={busy} accept={action === 'transcription' ? 'audio/*' : 'image/*'} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>}
      {action === 'image-edit' && <label>Optional mask (maximum 12 MB)<input type="file" accept="image/*" disabled={busy} onChange={(event) => setMask(event.target.files?.[0] ?? null)} /></label>}
      <Button type="submit" variant="tertiary" size="sm" isDisabled={busy}>Run modality request</Button>{action === 'slots' && <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(true)}>List slots</Button>}
      {busy && <Button variant="tertiary" size="sm" onPress={() => pending.current?.abort()}>Cancel modality request</Button>}
    </form>
    {busy && <p role="status">Working...</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result !== null && <CollapsibleSection defaultExpanded title="Latest modality result"><pre>{JSON.stringify(result, null, 2)}</pre></CollapsibleSection>}
    {media && <div aria-label="Generated media"><a href={media.url} download={media.filename}>Download generated file</a>{media.type === 'image' && <img src={media.url} alt="Generated image preview" style={{ maxWidth: '100%', maxHeight: 480 }} />}{media.type === 'audio' && <audio controls src={media.url} aria-label="Generated audio playback">Generated audio</audio>}</div>}
  </section>;
}
