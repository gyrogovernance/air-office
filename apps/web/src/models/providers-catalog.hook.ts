import type { ModelReasoningOptions } from '@office/contracts/chat';
import type { ModelRegistryEntry } from '@office/providers/service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createServiceClient } from '../shared/service-client.hook';
import { resolveServiceBase } from '../shared/service-endpoint.hook';
import { staticDemoBuild } from '../static-demo/static-demo.flag';

const localProvider: ProviderDescriptor = { id: 'local-replay', models: ['local-replay'] };
const selectionStorageKey = 'air-office:selected-model';

function readSelection(): { provider: string; model: string } | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(selectionStorageKey) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const { provider, model } = value as { provider?: unknown; model?: unknown };
    return typeof provider === 'string' && typeof model === 'string' && provider && model ? { provider, model } : null;
  } catch { return null; }
}

function writeSelection(provider: string, model: string): void {
  try { window.localStorage.setItem(selectionStorageKey, JSON.stringify({ provider, model })); } catch { /* The active choice still works for this session. */ }
}

/**
 * Nonsecret provider and model descriptors returned by the application service.
 * The service never returns a stored credential here, so this list is safe to
 * hold in renderer state.
 */
export interface ProviderDescriptor {
  id: string;
  name?: string;
  models: string[];
  /** True when models on this connection accept image input (CHAT-045). */
  images?: boolean;
  /** Presence only. The service never returns the credential value itself. */
  credentialConfigured?: boolean;
  capabilities?: unknown;
  modelFacts?: ModelRegistryEntry[];
  /** ChatGPT plan models expose per-model reasoning effort choices here. */
  reasoningByModel?: Record<string, ModelReasoningOptions>;
}

export interface ProviderCatalogState {
  providers: ProviderDescriptor[];
  selectedProvider: string | null;
  selectedModel: string | null;
  loading: boolean;
  error: string;
  /** True when the service runs in demo mode, where the replay model is the point. */
  demo: boolean;
  selectProvider: (id: string) => void;
  /** Selects a model by its combined `provider:model` key and resolves its owning provider in the same call. */
  selectModel: (key: string) => void;
  refresh: () => Promise<void>;
}

async function fetchBootstrapToken(base: string, signal: AbortSignal): Promise<string> {
  if (staticDemoBuild()) return 'static-demo';
  const response = await fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: window.location.origin }, signal });
  if (!response.ok) throw new Error('AIR Office service is unavailable.');
  return (await response.json() as { token: string }).token;
}

/**
 * Whether the service runs in demo mode. Demo uses a separate database from Normal;
 * the browser Demo toggle is a development aid, so
 * the replay model is offered there and nowhere else.
 */
export function useDemoMode(): boolean {
  const [demo, setDemo] = useState(() => staticDemoBuild());
  useEffect(() => {
    if (staticDemoBuild()) {
      setDemo(true);
      return;
    }
    const controller = new AbortController();
    void resolveServiceBase()
      .then((base) => fetch(`${base}/bootstrap`, { method: 'POST', headers: { origin: window.location.origin }, signal: controller.signal }))
      .then((response) => response.ok ? response.json() as Promise<{ demo?: unknown }> : null)
      .then((body) => { if (!controller.signal.aborted) setDemo(body?.demo === true); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return demo;
}

/**
 * Loads configured provider connections and their models from the application
 * service. Unavailable connections retain their selection so the user can repair or replace it explicitly.
 */
export function useProviderCatalog(): ProviderCatalogState {
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [providers, setProviders] = useState<ProviderDescriptor[]>([localProvider]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(() => readSelection()?.provider ?? null);
  const [selectedModel, setSelectedModel] = useState<string | null>(() => readSelection()?.model ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const demo = useDemoMode();
  /** The workspace default that was applied last, so a restart starts on the same model. */
  const defaultApplied = useRef('');
  const explicitSelection = useRef(false);

  const refresh = useCallback(async () => {
    const generation = ++epoch.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setLoading(true);
    try {
      let loaded: ProviderDescriptor[];
      let defaults: { defaults?: { chatProvider?: string | null; chatModel?: string | null } } | null = null;
      if (staticDemoBuild()) {
        // Static Pages builds have no loopback service; the seeded client answers these routes.
        const client = createServiceClient();
        loaded = (await client.json<{ providers: ProviderDescriptor[] }>('/api/v1/providers')).providers;
        defaults = await client.json<{ defaults?: { chatProvider?: string | null; chatModel?: string | null } }>('/api/v1/workspace-defaults').catch(() => null);
      } else {
        const base = await resolveServiceBase();
        const token = await fetchBootstrapToken(base, active.signal);
        const response = await fetch(`${base}/api/v1/providers`, { headers: { authorization: `Bearer ${token}` }, signal: active.signal });
        if (!response.ok) throw new Error('The provider catalog could not be loaded.');
        loaded = (await response.json() as { providers: ProviderDescriptor[] }).providers;
        defaults = await fetch(`${base}/api/v1/workspace-defaults`, { headers: { authorization: `Bearer ${token}` }, signal: active.signal })
          .then((result) => result.ok ? result.json() as Promise<{ defaults?: { chatProvider?: string | null; chatModel?: string | null } }> : null)
          .catch(() => null);
      }
      if (generation !== epoch.current) return;
      const next = loaded;
      setProviders(next.map((provider) => ({ ...provider, images: provider.capabilities && typeof provider.capabilities === 'object' && 'images' in provider.capabilities ? (provider.capabilities as { images: boolean }).images : provider.images })));
      // The workspace default is applied when it is new to this catalog, so an
      // explicit choice in the composer is never replaced by the default. A
      // default the user changed in the settings is applied, because that is
      // an explicit choice too.
      const providerId = defaults?.defaults?.chatProvider ?? null;
      const modelId = defaults?.defaults?.chatModel ?? null;
      const defaultKey = providerId && modelId ? `${providerId}:${modelId}` : '';
      if (defaultKey && defaultKey !== defaultApplied.current && next.some((provider) => provider.id === providerId && provider.models.includes(modelId!))) {
        const applyDefault = Boolean(defaultApplied.current) || !explicitSelection.current;
        defaultApplied.current = defaultKey;
        const saved = readSelection();
        const savedAvailable = saved && next.some((provider) => provider.id === saved.provider && provider.models.includes(saved.model));
        if (applyDefault && !savedAvailable) {
          setSelectedProvider(providerId);
          setSelectedModel(modelId);
          writeSelection(providerId!, modelId!);
        }
      }
      // Refresh never changes a saved or explicit selection. A first connection is chosen only by the user.
      setError('');
    } catch (reason) {
      if (generation !== epoch.current) return;
      setError(reason instanceof Error ? reason.message : 'Provider discovery failed.');
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); const changed = () => { void refresh(); }; window.addEventListener('office-models-changed', changed); return () => { epoch.current++; controller.current?.abort(); window.removeEventListener('office-models-changed', changed); }; }, [refresh]);

  const selectProvider = useCallback((id: string) => {
    explicitSelection.current = true;
    setSelectedProvider(id);
    setProviders((current) => {
      const provider = current.find((item) => item.id === id);
      const model = provider?.models[0] ?? null;
      setSelectedModel(model);
      if (model) writeSelection(id, model);
      return current;
    });
  }, []);

  const selectModel = useCallback((key: string) => {
    const separator = key.indexOf(':');
    if (separator <= 0 || separator === key.length - 1) return;
    explicitSelection.current = true;
    setSelectedProvider(key.slice(0, separator));
    setSelectedModel(key.slice(separator + 1));
    writeSelection(key.slice(0, separator), key.slice(separator + 1));
  }, []);

  return { providers, selectedProvider, selectedModel, loading, error, demo, selectProvider, selectModel, refresh };
}
