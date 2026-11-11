import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, SearchField } from '@heroui/react';
import type { LocalModelListing } from '@office/providers/service';
import { createServiceClient, type ServiceClient } from '../../shared/service-client.hook';
import { useAppDialogs } from '../../shared/app-dialogs.component';
import { SelectField } from '../../shared/select-field.component';
import { LocalAiDownloadHistory } from './local-ai-download-history.component';
import { LocalAiHardware } from './local-ai-hardware.component';
import { localHardwareFacts, modelBackend } from './local-ai-hardware.policy';
import { displayBytes, parseVariants, parseRepositories } from './local-ai-catalog.policy';

type Catalog = { models: (LocalModelListing & { compatible?: boolean | null })[]; source: 'runtime' | 'bundled'; release: string };
type Runtime = { state: string; systemInfo: unknown };
type Download = { id: string; model_name: string; status: string; running?: boolean; percent?: number };
type Repository = { repository_id: string; display_name?: string; description?: string };
type Variants = ReturnType<typeof parseVariants>;
const purpose = (model: LocalModelListing) => model.labels.some((label) => ['embedding', 'embeddings'].includes(label)) ? 'Indexing' : model.labels.some((label) => ['rerank', 'reranking'].includes(label)) ? 'Reranking' : model.labels.includes('vision') ? 'Chat and images' : model.labels.includes('image') ? 'Image generation' : model.labels.some((label) => ['audio', 'tts', 'audio-generation', 'voice-design'].includes(label)) ? 'Audio' : model.labels.includes('classification') ? 'Classification' : 'Chat';
const purposes = ['Chat', 'Chat and images', 'Indexing', 'Reranking', 'Image generation', 'Audio', 'Classification'];
export function LocalModelsMarket({ client: suppliedClient, onSetup, onUseModel }: { client?: ServiceClient; onSetup: () => void; onUseModel?: (model: string) => void }) {
  const client = useMemo(() => suppliedClient ?? createServiceClient(), [suppliedClient]);
  const dialogs = useAppDialogs();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [showHistory, setShowHistory] = useState(false);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [downloadRevision, setDownloadRevision] = useState(0);
  const [showAllModels, setShowAllModels] = useState(false);
  const [allModels, setAllModels] = useState<(LocalModelListing & { compatible?: boolean | null })[] | null>(null);
  const [hiddenLargeModels, setHiddenLargeModels] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [variants, setVariants] = useState<Variants | null>(null);
  const [checkedReport, setCheckedReport] = useState<unknown>(null);
  const searchEpoch = useRef(0);
  const runtimeReady = runtime?.state === 'ready';
  const ready = runtimeReady && catalog?.source === 'runtime';
  const hardware = localHardwareFacts(checkedReport ?? runtime?.systemInfo);
  const operation = useCallback(async <T,>(value: Record<string, unknown>, signal?: AbortSignal) => (await client.json<{ result: T }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify(value), signal })).result, [client]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const results = await Promise.allSettled([
      client.json<Catalog>('/api/v1/model-catalog', { signal }),
      client.json<Runtime>('/api/v1/local-ai/status', { signal }),
    ]);
    if (signal?.aborted) return;
    const [listing, status] = results;
    if (listing.status === 'fulfilled') {
      setCatalog(listing.value);
      setHiddenLargeModels(listing.value.models.filter((model) => model.recipe.startsWith('collection.') && (model.sizeGB ?? 0) > 26).length);
    }
    else setError('Models could not be loaded. Refresh the catalog to retry.');
    setRuntime(status.status === 'fulfilled' ? status.value : null);
  }, [client]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => { controller.abort(); searchEpoch.current++; }; }, [refresh]);
  const active = downloads.some((download) => download.running || ['downloading', 'paused'].includes(download.status));
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const observe = async () => {
      try {
        const result = await operation<Download[] | { downloads: Download[] }>({ operation: 'downloads' }, controller.signal);
        if (controller.signal.aborted) return;
        const observed = Array.isArray(result) ? result : result.downloads ?? [];
        setDownloads(observed);
        if (active || observed.length > 0) { await refresh(controller.signal); window.dispatchEvent(new Event('office-models-changed')); }
      } catch { if (!controller.signal.aborted && active) setError('Download progress could not be refreshed. Retry the download.'); }
      finally { if (!controller.signal.aborted && active) timer = setTimeout(() => void observe(), 3000); }
    };
    void observe(); return () => { controller.abort(); clearTimeout(timer); };
  }, [operation, refresh, ready, active, notice, downloadRevision]);
  async function perform(id: string, action: Record<string, unknown>, success: string) {
    setBusy(id); setError(''); setNotice('');
    try { await operation(action); await refresh(); setDownloadRevision((revision) => revision + 1); setNotice(success); window.dispatchEvent(new Event('office-models-changed')); }
    catch { setError('The requested action failed. Try again.'); }
    finally { setBusy(''); }
  }
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [preparing, setPreparing] = useState('');
  async function download(model: LocalModelListing) {
    const backend = modelBackend(model.recipe, hardware);
    setBusy(model.id); setRowErrors((previous) => ({ ...previous, [model.id]: '' }));
    try {
      if (backend && ['installable', 'update_required'].includes(backend.state)) {
        setPreparing(model.id);
        await operation({ operation: 'install', input: { recipe: backend.recipe, backend: backend.id, stream: false } });
        setPreparing('');
      }
      await operation({ operation: 'pull', input: { model_name: model.id, stream: true, subscribe: false } });
      setDownloadRevision((revision) => revision + 1);
      await refresh();
      setNotice('');
      window.dispatchEvent(new Event('office-models-changed'));
    } catch { setRowErrors((previous) => ({ ...previous, [model.id]: `Could not download ${model.id}. Try again.` })); }
    finally { setPreparing(''); setBusy(''); }
  }
  async function searchOnline() {
    const epoch = ++searchEpoch.current;
    setBusy('search'); setError('');
    try { const result = await operation<unknown>({ operation: 'registry-search', input: { query: query.trim(), format: 'gguf' } }); if (epoch === searchEpoch.current) setRepositories(parseRepositories(result)); }
    catch { if (epoch === searchEpoch.current) setError('Repository search failed. Try again.'); }
    finally { setBusy(''); }
  }
  /**
   * A model downloaded from the Market is removed from the runtime, so the
   * files go with it. The user is told this, because the file cannot be
   * recovered once it is gone.
   */
  async function deleteModel(model: LocalModelListing) {
    const approved = await dialogs.confirm({
      title: 'Delete model',
      message: `Delete "${model.id}"? The downloaded files are removed from this computer and the model is no longer available.`,
      confirmLabel: 'Delete model',
      destructive: true,
    });
    if (!approved) return;
    setBusy(model.id); setError(''); setNotice('');
    try {
      await operation({ operation: 'delete', input: { model_name: model.id } });
      await refresh();
      setNotice(`${model.id} was deleted.`);
      setDownloadRevision((revision) => revision + 1);
      window.dispatchEvent(new Event('office-models-changed'));
    } catch { setRowErrors((previous) => ({ ...previous, [model.id]: `Could not delete ${model.id}. Try again.` })); }
    finally { setBusy(''); }
  }
  const catalogModels = catalog?.models ?? [];
  const displayedModels = showAllModels ? (allModels ?? catalogModels) : catalogModels.filter((model) => {
    const largeCollection = model.recipe.startsWith('collection.') && model.sizeGB !== null && model.sizeGB > 26;
    return !largeCollection;
  });
  const visible = displayedModels.filter((model) => `${model.id} ${model.labels.join(' ')}`.toLowerCase().includes(query.toLowerCase()) && (role === 'all' || purpose(model) === role) && (!installedOnly || model.downloaded === true)).sort((a, b) => Number(purpose(b) === 'Chat') - Number(purpose(a) === 'Chat') || Number(b.suggested) - Number(a.suggested) || a.id.localeCompare(b.id));
  const proposed = !showAllModels && ready ? visible.filter((model) => model.suggested && !model.recipe.startsWith('collection.') && model.compatible !== false && modelBackend(model.recipe, hardware)?.state !== 'unsupported').sort((a, b) => Number(b.labels.includes('hot')) - Number(a.labels.includes('hot'))).slice(0, 6) : [];
  const proposedIds = new Set(proposed.map((model) => model.id));
  function modelRow(model: LocalModelListing & { compatible?: boolean | null }) {
    const backend = modelBackend(model.recipe, hardware);
    const installed = model.downloaded === true;
    const downloading = downloads.find((download) => download.model_name === model.id && (download.running || download.status === 'downloading'));
    return <li className="model-catalog-row" key={model.id}>
      <div className="local-model-summary">
        <div className="local-model-copy"><strong>{model.id}</strong><span className="local-model-meta">{purpose(model)}{model.sizeGB ? ` · ${model.sizeGB < 1 ? `${Math.round(model.sizeGB * 1000)} MB` : `${model.sizeGB.toFixed(1)} GB`}` : ''}</span>{installed && <span className="local-model-meta">Installed</span>}{!installed && ready && backend?.state === 'unsupported' && <span className="local-model-meta">Not supported on this hardware</span>}</div>
        <div className="team-actions">{downloading ? <span role="status">Downloading{typeof downloading.percent === 'number' ? ` ${Math.round(downloading.percent)}%` : '...'}</span> : installed ? <><Button variant="secondary" size="sm" onPress={() => onUseModel && ["Chat", "Chat and images"].includes(purpose(model)) ? onUseModel(model.id) : onSetup()}>{onUseModel && ["Chat", "Chat and images"].includes(purpose(model)) ? "Use in chat" : "Model settings"}</Button><Button variant="danger-soft" size="sm" isDisabled={Boolean(busy)} aria-label={`Delete model ${model.id}`} onPress={() => void deleteModel(model)}>Delete</Button></> : <Button variant="secondary" size="sm" isDisabled={Boolean(busy) || !ready || backend?.state === 'unsupported' || showAllModels && model.compatible === false} onPress={() => void download(model)}>{busy === model.id ? preparing === model.id ? 'Preparing...' : 'Starting...' : 'Download'}</Button>}</div>      </div>
      {showAllModels && model.compatible === false && <p className="local-model-meta">Does not fit this computer’s supported models</p>}
      {rowErrors[model.id] && <p role="alert">{rowErrors[model.id]}</p>}
    </li>;
  }
  return <section className="models-workspace market-models" aria-label="Model catalog">
    <div className="model-catalog-filters"><SearchField aria-label="Search models" value={query} onChange={(value) => { searchEpoch.current++; setQuery(value); setRepositories(null); setVariants(null); }}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input maxLength={500} placeholder="Search models" /><SearchField.ClearButton /></SearchField.Group></SearchField><SelectField aria-label="Model purpose" value={role} onValueChange={setRole}><option value="all">All purposes</option>{purposes.map((label) => <option key={label} value={label}>{label}</option>)}</SelectField><Checkbox isSelected={installedOnly} onChange={setInstalledOnly}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Installed only</Checkbox.Content></Checkbox></div>
    <LocalAiHardware systemInfo={runtime?.systemInfo} client={client} onRefresh={() => refresh()} onChecked={setCheckedReport} />
    <div className="model-connections-toolbar"><Button variant="tertiary" size="sm" onPress={() => { setError(''); void refresh(); }}>Refresh catalog</Button></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!catalog && !error ? <p role="status">Loading catalog...</p> : catalog && <p className="method-hint" role="status">{visible.length} models</p>}
    {proposed.length > 0 && <section aria-label="Suggested models"><h3>Suggested models</h3><ul className="model-catalog-list">{proposed.map(modelRow)}</ul></section>}
    <ul className="model-catalog-list" aria-label={showAllModels ? 'All models' : 'Available models'}>{visible.filter((model) => !proposedIds.has(model.id)).map(modelRow)}</ul>
    {catalog && visible.length === 0 && <p>No models match these filters.</p>}
    {ready && hiddenLargeModels > 0 && !showAllModels && <p className="method-hint">{hiddenLargeModels} large model bundles hidden. <Button variant="tertiary" size="sm" onPress={() => { setAllModels(catalogModels); setShowAllModels(true); }}>Show all models</Button></p>}
    {ready && showAllModels && <Button variant="tertiary" size="sm" onPress={() => setShowAllModels(false)}>Show compatible models</Button>}
    {query.trim().length >= 3 && <Button variant="secondary" size="sm" isDisabled={!ready || Boolean(busy)} onPress={() => void searchOnline()}>Search repositories for “{query.trim()}”</Button>}
    {repositories && <section aria-label="Repository search results"><h3>Repositories</h3>{repositories.length === 0 && <p>No repositories found.</p>}{repositories.map((repository) => <div className="settings-pref-row" key={repository.repository_id}><div className="local-model-copy"><strong>{repository.display_name ?? repository.repository_id}</strong><span className="method-hint">{repository.description}</span>{variants?.checkpoint === repository.repository_id && variants.variants.map((variant) => <div className="team-actions" key={variant.name}><span>{variant.name} · {displayBytes(variant.sizeBytes) ?? 'Size not reported'}</span><Button variant="secondary" size="sm" isDisabled={Boolean(busy) || !ready} onPress={() => void perform(repository.repository_id, { operation: 'pull', input: { model_name: `user.${variants.suggestedName}`, recipe: variants.recipe, checkpoint: `${variants.checkpoint}:${variant.name}`, ...(variants.labels.includes('vision') && variants.mmprojFiles[0] ? { vision: true, mmproj: variants.mmprojFiles[0] } : variants.labels.includes('embeddings') ? { embedding: true } : variants.labels.includes('reranking') ? { reranking: true } : {}), stream: true, subscribe: false } }, 'Download started.')}>Download {variant.name}</Button></div>)}</div><Button variant="secondary" size="sm" isDisabled={Boolean(busy) || !ready} onPress={() => { setBusy(repository.repository_id); setError(''); void operation({ operation: 'variants', checkpoint: repository.repository_id }).then((value) => setVariants(parseVariants(value, repository.repository_id))).catch(() => setError('Model variants could not be loaded. Try again.')).finally(() => setBusy('')); }}>Choose variant</Button></div>)}</section>}
    {downloads.length > 0 && <section aria-label="Model downloads"><h3>Downloads</h3>{downloads.map((download) => <div className="settings-pref-row" key={download.id}><span>{download.model_name} · {download.status}{typeof download.percent === 'number' ? ` · ${Math.round(download.percent)}%` : ''}</span><div className="team-actions">{download.running && <Button variant="tertiary" size="sm" isDisabled={Boolean(busy)} onPress={() => void perform(download.id, { operation: 'download-control', input: { id: download.id, action: 'pause' } }, 'Download paused.')}>Pause</Button>}{['paused', 'error', 'cancelled'].includes(download.status) && <Button variant="secondary" size="sm" isDisabled={Boolean(busy)} onPress={() => void perform(download.id, { operation: 'pull', input: { model_name: download.model_name, stream: true, subscribe: false } }, 'Download resumed.')}>Resume</Button>}{(download.running || download.status === 'paused') && <Button variant="tertiary" size="sm" isDisabled={Boolean(busy)} onPress={() => void perform(download.id, { operation: 'download-control', input: { id: download.id, action: 'cancel' } }, 'Download cancelled.')}>Cancel</Button>}</div></div>)}</section>}
    <Button variant="tertiary" size="sm" aria-expanded={showHistory} onPress={() => setShowHistory(!showHistory)}>Download history</Button>
    {showHistory && <LocalAiDownloadHistory client={client} />}
  </section>;
}

