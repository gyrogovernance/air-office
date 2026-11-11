import { useEffect, useMemo, useRef, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { WorkspaceHero } from '../shared/workspace-hero.component';
import { SelectField } from '../shared/select-field.component';
import { imageQualities, imageShapes, imageSize, imageSteps, mediaModelName, mediaModelsForKind, type ImageQuality, type ImageShape, type MediaModel } from '../models/local-ai/media-capability.policy';
import { Button, Card, Separator, Tabs, TextArea } from '@heroui/react';
import { DeviceCapture } from './device-capture.component';

type InstalledModel = { id?: unknown; name?: unknown; model_name?: unknown; recipe?: unknown; labels?: unknown };
type Generated = { url: string; type: 'image' | 'download'; filename: string };

const kinds: { value: 'image'; label: string; route: string; help: string }[] = [
  { value: 'image', label: 'Image', route: 'images/generations', help: 'Describe the image you want Local AI to generate.' },
];

const MB = 1024 * 1024;

async function boundedBlob(response: Response, signal: AbortSignal): Promise<Blob> {
  const limit = 16 * MB;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('The response is larger than 16 MB.'); }
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
      if (size > limit) { await reader.cancel(); throw new Error('The response is larger than 16 MB.'); }
      chunks.push(new Uint8Array(next.value));
    }
    return new Blob(chunks, { type: response.headers.get('content-type') ?? 'application/octet-stream' });
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/**
 * The models the runtime holds, with the labels that say what each can do.
 * An imported model keeps a generated name in the runtime, so the readable
 * part is taken from it.
 */
function mediaModels(value: unknown): MediaModel[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' && 'data' in value && Array.isArray(value.data) ? value.data : [];
  return rows.flatMap((row): MediaModel[] => {
    if (!row || typeof row !== 'object') return [];
    const item = row as InstalledModel;
    const id = item.id ?? item.name ?? item.model_name;
    if (typeof id !== 'string' || !id) return [];
    const labels = Array.isArray(item.labels) ? item.labels.filter((label): label is string => typeof label === 'string') : [];
    return [{ id, name: mediaModelName(id), recipe: typeof item.recipe === 'string' ? item.recipe : '', labels }];
  });
}

export function WorkplaceMediaWorkspace({ client, appearance = 'light', onOpenModels }: { client: ServiceClient; appearance?: 'light' | 'dark'; onOpenModels?: () => void }) {
  const [view, setView] = useState<'generate' | 'capture'>('generate');
  const [models, setModels] = useState<MediaModel[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [shape, setShape] = useState<ImageShape>('square');
  const [quality, setQuality] = useState<ImageQuality>('standard');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [listingError, setListingError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<Generated | null>(null);
  const pending = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const mounted = useRef(false);
  const current = kinds[0]!;
  /** Only the models that can draw images are offered. */
  const available = useMemo(() => mediaModelsForKind(models, current.value), [models, current.value]);
  /** The quality the user chose, with the words that explain it. */
  const qualityChoice = imageQualities.find((item) => item.value === quality) ?? imageQualities[1]!;

  function clearResult() {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = null;
    setResult(null);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); if (preview.current) URL.revokeObjectURL(preview.current); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setListingError('');
    void client.json<{ result: unknown }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'installed-models' }), signal: controller.signal })
      .then(({ result: response }) => { if (!controller.signal.aborted) setModels(mediaModels(response)); })
      .catch(() => { if (!controller.signal.aborted) setListingError('Local AI models could not be loaded. Check the connection in Local AI settings, then retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const refresh = () => setRefreshKey((key) => key + 1);
    window.addEventListener('office-models-changed', refresh);
    window.addEventListener('air-office-bootstrap', refresh);
    return () => { controller.abort(); window.removeEventListener('office-models-changed', refresh); window.removeEventListener('air-office-bootstrap', refresh); };
  }, [client, refreshKey]);

  /** The chosen model, kept only while it can still do this kind of work. */
  useEffect(() => {
    if (!available.some((item) => item.id === model)) setModel(available[0]?.id ?? '');
  }, [available, model]);

  async function generate() {
    if (pending.current || busy) return;
    if (!model || !available.some((item) => item.id === model)) { setError('Choose an installed Local AI model.'); return; }
    if (!prompt.trim()) { setError('Enter a prompt.'); return; }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(''); setNotice(''); clearResult();
    try {
      // The engine takes a width and a height, and it counts steps, so the
      // shape and the quality the user chose travel with the request.
      const body = { model, prompt: prompt.trim(), size: imageSize(shape), steps: imageSteps(quality) };
      const response = await client.request(`/api/v1/local-ai/${current.route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const blob = await boundedBlob(response, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (!response.ok) {
        const detail = await blob.text();
        let message = `Generation failed (${response.status}).`;
        try { const value = JSON.parse(detail) as { error?: { message?: string } }; if (typeof value.error?.message === 'string') message = value.error.message; } catch { /* Keep the status message. */ }
        throw new Error(message);
      }
      const type = blob.type.split(';')[0]!.toLowerCase();
      const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type);
      let output = blob;
      if (type === 'application/json' || type.endsWith('+json')) {
        const value: unknown = JSON.parse(await blob.text());
        const data = value && typeof value === 'object' && 'data' in value && Array.isArray(value.data) ? value.data[0] as { b64_json?: unknown } | undefined : undefined;
        if (typeof data?.b64_json !== 'string') throw new Error('No image was returned. Try another model or prompt.');
        const bytes = Uint8Array.from(atob(data.b64_json), (character) => character.charCodeAt(0));
        if (bytes.byteLength > 16 * MB) throw new Error('The image is larger than 16 MB.');
        output = new Blob([bytes], { type: 'image/png' });
      } else if (!isImage) {
        throw new Error('No usable image was returned. Try another model or prompt.');
      }
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' } as Record<string, string>)[output.type.split(';')[0]!] ?? 'bin';
      const url = URL.createObjectURL(output);
      preview.current = url;
      setResult({ url, type: 'image', filename: `air-office-image.${extension}` });
      setNotice('Generation completed.');
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? 'Generation cancelled.' : reason instanceof Error ? reason.message : 'Generation failed.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="workplace-media workspace-hero-page" data-workspace="media" aria-label="Media">
    <WorkspaceHero icon={<WorkspaceDestinationIcon name="media" size={56} />} subtitle="Generate images or capture camera stills and short video." />
    <Tabs selectedKey={view} onSelectionChange={(key) => { if (key === 'generate' || key === 'capture') setView(key); }}>
      <Tabs.ListContainer className="workplace-media-views">
        <Tabs.List aria-label="Media tools">
          <Tabs.Tab id="generate">Generate<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="capture">Capture<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
    {view === 'capture' ? <DeviceCapture client={client} /> : <>
    {loading && <p className="workplace-media-status" role="status">Loading installed models…</p>}
    {listingError && <Card className="workplace-media-empty"><p role="alert">{listingError}</p><div className="workplace-media-actions"><Button variant="secondary" size="sm" onPress={() => setRefreshKey((key) => key + 1)}>Retry</Button>{onOpenModels && <Button variant="secondary" size="sm" onPress={onOpenModels}>Open Models settings</Button>}</div></Card>}
    {error && <p className="sidebar-error" role="alert">{error}</p>}
    {notice && <p className="workplace-media-status" role="status">{notice}</p>}
    {!loading && !listingError && models.length === 0 ? (
      <Card className="workplace-media-empty">
        <p>No Local AI models are available for generation yet.</p>
        {onOpenModels && <Button variant="secondary" size="sm" onPress={onOpenModels}>Open Models settings</Button>}
      </Card>
    ) : !loading && !listingError && available.length === 0 ? (
      <Card className="workplace-media-empty">
        <p>No installed model can draw images. Download one in the Market, then try again.</p>
        {onOpenModels && <Button variant="secondary" size="sm" onPress={onOpenModels}>Open Models settings</Button>}
      </Card>
    ) : !loading && !listingError ? (
      <Card className="workplace-media-panel" render={(props) => {
        const { ref, ...rest } = props;
        return <form {...(rest as React.FormHTMLAttributes<HTMLFormElement>)} onSubmit={(event) => { event.preventDefault(); void generate(); }} />;
      }}>
        <label>Model
          <SelectField aria-label="Generation model" value={model} disabled={busy} onValueChange={setModel}>
            <option value="">Choose an installed model</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectField>
        </label>
        <p className="workplace-media-hint">{current.help}</p>
        <label>Prompt
          <TextArea value={prompt} disabled={busy} maxLength={4000} placeholder="A red kite above a quiet harbour" onChange={(event) => setPrompt(event.target.value)}/>
        </label>
        <div className="workplace-media-options">
          <label>Shape
            <SelectField aria-label="Image shape" value={shape} disabled={busy} onValueChange={(value) => setShape(value as ImageShape)}>
              {imageShapes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </SelectField>
          </label>
          <label>Quality
            <SelectField aria-label="Image quality" value={quality} disabled={busy} onValueChange={(value) => setQuality(value as ImageQuality)}>
              {imageQualities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </SelectField>
          </label>
          <p className="workplace-media-hint">{qualityChoice.help}</p>
        </div>
        <Separator />
        <Card.Footer className="workplace-media-actions">
          <Button type="submit" size="sm" isDisabled={busy || !model}>{busy ? 'Working…' : 'Generate'}</Button>
          {busy && <Button variant="tertiary" size="sm" onPress={() => pending.current?.abort()}>Cancel</Button>}
        </Card.Footer>
      </Card>
    ) : null}
    {result && <Card className="workplace-media-result" aria-label="Generated media">
      <a href={result.url} download={result.filename}>Download {result.filename}</a>
      {result.type === 'image' && <><Separator /><img src={result.url} alt="Generated image preview"/></>}
    </Card>}
    </>}
  </section>;
}
