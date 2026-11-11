import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AiCloudIcon, CheckmarkCircle01Icon, FlashIcon, Store01Icon } from '@hugeicons/core-free-icons';
import type { LocalModelListing } from '@office/providers/service';
import { createServiceClient, isAbortError, type ServiceClient } from '../shared/service-client.hook';
import { localHardwareFacts, modelBackend } from '../models/local-ai/local-ai-hardware.policy';

type ModelChoice = { providerId: string; modelId: string; roles: string[] };
type Candidate = { providerId: string; modelId: string; roles: string[]; reason: string; revision?: string; dimensions?: number | null };
type QuickStartState = {
  current: { chatProvider: string | null; chatModel: string | null; embeddingModel: string | null; embeddingRevision: string | null; embeddingDimensions: number | null };
  proposal: { chat: Candidate | null; embedding: Candidate | null };
  models: ModelChoice[];
};
type Catalog = { models: (LocalModelListing & { compatible?: boolean | null })[] };
type Runtime = { state: string; systemInfo: unknown };
type Download = { id: string; model_name: string; status: string; running?: boolean; percent?: number };

/** The models a fresh workspace starts with — the smallest ones that do the work. */
const STARTER_CHAT_MODEL = 'Bonsai-1.7B-gguf';
const STARTER_EMBEDDING_MODEL = 'Qwen3-Embedding-0.6B-GGUF';

function formatSize(sizeGB: number | null): string {
  if (sizeGB === null) return '';
  return sizeGB < 1 ? `${Math.round(sizeGB * 1000)} MB` : `${sizeGB.toFixed(1)} GB`;
}

const QUICK_START_SEEN_KEY = 'office.quick-start.seen';

/** The quick start is onboarding, not a report — once it has been shown
 *  as complete for a model pair it steps aside until the setup changes. */
function quickStartSeenFor(chatModel: string | null, embeddingModel: string | null): boolean {
  if (!chatModel || !embeddingModel) return false;
  try { return globalThis.localStorage?.getItem(QUICK_START_SEEN_KEY) === `${chatModel}/${embeddingModel}`; } catch { return false; }
}
function markQuickStartSeen(chatModel: string, embeddingModel: string): void {
  try { globalThis.localStorage?.setItem(QUICK_START_SEEN_KEY, `${chatModel}/${embeddingModel}`); } catch { /* private mode */ }
}

/**
 * Finish setup offers three separate routes: download the local starter
 * pair, connect a cloud API, or browse the Market. Cloud catalogs never
 * count as the local starter path.
 */
export function QuickStartSettings({ client: suppliedClient, onOpenModels, onOpenCloudAi, onApplied }: {
  client?: ServiceClient;
  onOpenModels?: () => void;
  onOpenCloudAi?: () => void;
  onApplied?: () => void;
}) {
  const client = useMemo(() => suppliedClient ?? createServiceClient(), [suppliedClient]);
  const [state, setState] = useState<QuickStartState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      // Quick-start is the card; catalog/status only refine download buttons and can hang while Local AI wakes.
      const quickStart = await client.json<QuickStartState>('/api/v1/quick-start', { signal });
      if (signal?.aborted) return;
      setState(quickStart);
      setError('');
      const optional = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
      const [models, status] = await Promise.all([
        client.json<Catalog>('/api/v1/model-catalog', { signal: optional }).catch((reason) => { if (signal?.aborted) throw reason; return null; }),
        client.json<Runtime>('/api/v1/local-ai/status', { signal: optional }).catch((reason) => { if (signal?.aborted) throw reason; return null; })
      ]);
      if (signal?.aborted) return;
      setCatalog(models);
      setRuntime(status);
    } catch (reason) {
      if (isAbortError(reason) || signal?.aborted) return;
      setError(reason instanceof Error ? reason.message : 'The installed models could not be read.');
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [load]);

  const chatReady = Boolean(state?.current.chatProvider && state?.current.chatModel);
  const embeddingReady = Boolean(state?.current.embeddingModel && state?.current.embeddingDimensions);
  const bothReady = chatReady && embeddingReady;
  const localPairReady = Boolean(state?.proposal.chat && state?.proposal.embedding);

  useEffect(() => {
    if (bothReady && state?.current.chatModel && state.current.embeddingModel) {
      markQuickStartSeen(state.current.chatModel, state.current.embeddingModel);
    }
  }, [bothReady, state?.current.chatModel, state?.current.embeddingModel]);

  const hardware = localHardwareFacts(runtime?.systemInfo);
  const runtimeReady = runtime?.state === 'ready';
  const starterChat = catalog?.models.find((model) => model.id === STARTER_CHAT_MODEL) ?? null;
  const starterEmbedding = catalog?.models.find((model) => model.id === STARTER_EMBEDDING_MODEL) ?? null;
  const starterUnavailable = (model: (LocalModelListing & { compatible?: boolean | null }) | null) =>
    !model || model.compatible === false || modelBackend(model.recipe, hardware)?.state === 'unsupported';

  const operation = useCallback(async <T,>(value: Record<string, unknown>) =>
    (await client.json<{ result: T }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify(value) })).result, [client]);

  const apply = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const current = await client.json<QuickStartState>('/api/v1/quick-start');
      const proposal = current.proposal;
      await client.json('/api/v1/quick-start', {
        method: 'PUT',
        body: JSON.stringify({
          chatProvider: proposal.chat?.providerId ?? current.current.chatProvider ?? undefined,
          chatModel: proposal.chat?.modelId ?? current.current.chatModel ?? undefined,
          embeddingModel: proposal.embedding?.modelId ?? current.current.embeddingModel ?? undefined,
          embeddingRevision: proposal.embedding?.revision ?? current.current.embeddingRevision ?? undefined,
          embeddingDimensions: proposal.embedding?.dimensions ?? current.current.embeddingDimensions ?? undefined
        })
      });
      setApplied(true);
      await load();
      onApplied?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The defaults could not be saved.');
    } finally {
      setBusy(false);
    }
  }, [client, load, onApplied]);

  const watchDownloads = useCallback(async () => {
    try {
      const result = await operation<Download[] | { downloads: Download[] }>({ operation: 'downloads' });
      const observed = Array.isArray(result) ? result : result.downloads ?? [];
      const progress: Record<string, number> = {};
      for (const download of observed) {
        if (typeof download.percent === 'number') progress[download.model_name] = download.percent;
      }
      setDownloadProgress(progress);
      const pending = observed.some((download) =>
        [STARTER_CHAT_MODEL, STARTER_EMBEDDING_MODEL].includes(download.model_name) &&
        (download.running || ['downloading', 'paused'].includes(download.status)));
      if (pending) { pollTimer.current = setTimeout(() => void watchDownloads(), 2000); return; }
    } catch { /* a lost progress read does not stop the refresh below */ }
    setDownloadProgress({});
    setBusy(false);
    await load();
    await apply();
  }, [operation, load, apply]);

  async function downloadStarters() {
    if (!starterChat || !starterEmbedding) return;
    setBusy(true); setError('');
    try {
      for (const model of [starterChat, starterEmbedding]) {
        const backend = modelBackend(model.recipe, hardware);
        if (backend && ['installable', 'update_required'].includes(backend.state)) {
          await operation({ operation: 'install', input: { recipe: backend.recipe, backend: backend.id, stream: false } });
        }
        await operation({ operation: 'pull', input: { model_name: model.id, stream: true, subscribe: false } });
      }
      window.dispatchEvent(new Event('office-models-changed'));
      await watchDownloads();
    } catch {
      setError('The models could not be downloaded. Check the download location and try again.');
      setBusy(false);
    }
  }

  const downloading = Object.keys(downloadProgress).length > 0;

  if (!state) {
    return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Quick start">
      <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={FlashIcon} size={18} aria-hidden="true" />Finish setup</Card.Title></Card.Header><Separator />
      {error ? <p role="alert">{error}</p> : <p role="status">Checking installed models…</p>}
    </Card>;
  }

  if (bothReady) {
    if (quickStartSeenFor(state.current.chatModel, state.current.embeddingModel)) return null;
    return <Card variant="secondary" className="rounded-2xl p-3 settings-quickstart-done" render={(props) => <section {...props} />} aria-label="Quick start">
      <p className="settings-quickstart-done-line"><HugeiconsIcon icon={CheckmarkCircle01Icon} size={16} aria-hidden="true" />You're set. Local chat and document search are ready, and cloud models work too.</p>
      {onOpenModels && <Button variant="tertiary" size="sm" onPress={onOpenModels}>Change models</Button>}
      {error && <p role="alert">{error}</p>}
    </Card>;
  }

  const downloadBlocked = busy || downloading || !runtimeReady || starterUnavailable(starterChat) || starterUnavailable(starterEmbedding);
  const localPrimaryLabel = localPairReady
    ? (busy ? 'Saving…' : applied ? 'Defaults saved' : 'Use these models')
    : (downloading ? 'Downloading…' : busy ? 'Starting…' : 'Download and start');
  const localPrimaryAction = localPairReady ? () => void apply() : () => void downloadStarters();
  const localPrimaryDisabled = localPairReady ? busy : downloadBlocked;

  return <Card variant="secondary" className="rounded-2xl p-3 settings-quickstart-hero" render={(props) => <section {...props} />} aria-label="Quick start">
    <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={FlashIcon} size={18} aria-hidden="true" />Finish setup</Card.Title></Card.Header><Separator />
    <p className="settings-quickstart-lead">Run models on your computer for privacy-sensitive work, or connect a cloud provider.</p>
    {error && <p role="alert">{error}</p>}

    <div className="settings-pref-row">
      <div className="settings-pref-copy">
        <span className="settings-pref-label">1. Local starters</span>
        <span className="settings-pref-help">
          {localPairReady
            ? `${state.proposal.chat!.modelId} and ${state.proposal.embedding!.modelId} are installed. Save them as workspace defaults.`
            : `Download Bonsai for chat and Qwen for document indexing${starterChat || starterEmbedding ? ` (${[starterChat ? formatSize(starterChat.sizeGB) : null, starterEmbedding ? formatSize(starterEmbedding.sizeGB) : null].filter(Boolean).join(' + ')})` : ''}.`}
        </span>
        {!localPairReady && <>
          <span className="settings-quickstart-name">Chat · <span className="settings-quickstart-brand">Bonsai</span>{typeof downloadProgress[STARTER_CHAT_MODEL] === 'number' ? ` · ${Math.round(downloadProgress[STARTER_CHAT_MODEL]!)}%` : ''}</span>
          <span className="settings-quickstart-name">Indexing · <span className="settings-quickstart-brand">Qwen</span>{typeof downloadProgress[STARTER_EMBEDDING_MODEL] === 'number' ? ` · ${Math.round(downloadProgress[STARTER_EMBEDDING_MODEL]!)}%` : ''}</span>
        </>}
      </div>
      <Button size="sm" isDisabled={localPrimaryDisabled} onPress={localPrimaryAction}>{localPrimaryLabel}</Button>
    </div>

    <div className="settings-pref-row">
      <div className="settings-pref-copy">
        <span className="settings-pref-label">2. Cloud API</span>
        <span className="settings-pref-help">Add OpenAI, Anthropic, OpenRouter, or another provider key for cloud chat.</span>
      </div>
      {onOpenCloudAi && <Button variant="secondary" size="sm" onPress={onOpenCloudAi}><HugeiconsIcon icon={AiCloudIcon} size={16} aria-hidden="true" />Add cloud API</Button>}
    </div>

    <div className="settings-pref-row">
      <div className="settings-pref-copy">
        <span className="settings-pref-label">3. Market</span>
        <span className="settings-pref-help">Browse and download any local model yourself.</span>
      </div>
      {onOpenModels && <Button variant="tertiary" size="sm" onPress={onOpenModels}><HugeiconsIcon icon={Store01Icon} size={16} aria-hidden="true" />Open Market</Button>}
    </div>

    {!localPairReady && catalog && !runtimeReady && <p className="settings-pref-help">The local runtime is starting up. Downloads become available in a moment.</p>}
    {!localPairReady && runtimeReady && (!starterChat || !starterEmbedding) && <p className="settings-pref-help">The model catalog is not ready yet. Use Cloud API or Market in the meantime.</p>}
  </Card>;
}
