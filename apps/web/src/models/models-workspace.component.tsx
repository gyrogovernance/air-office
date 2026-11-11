import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, SearchField, TextArea, Card, Separator, Modal } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CpuIcon, AiCloudIcon, Chat01Icon, File01Icon, Image01Icon, Mic01Icon, VolumeUpIcon } from '@hugeicons/core-free-icons';
import type { ModelConnection } from '@office/providers/domain';
import { discoverySummary, isLoopbackProvider } from '@office/providers/domain';
import { createServiceClient } from '../shared/service-client.hook';
import { currentServiceBase, developmentServiceBase, resolveServiceBase } from '../shared/service-endpoint.hook';
import { SelectField } from '../shared/select-field.component';
import { LocalAiHardware } from './local-ai/local-ai-hardware.component';
import { localHardwareFacts } from './local-ai/local-ai-hardware.policy';
import { capabilityRows } from './local-ai/local-ai-capability.policy';
import { LocalAiPanels } from './local-ai/local-ai-panels.component';
import { LocalAiImportFolder } from './local-ai/local-ai-import-folder.component';
import { LocalAiModelUpdates } from './local-ai/local-ai-model-lifecycle.component';
import { LocalModelScan } from './local-ai/local-model-scan.component';
import { FullHarnessOption } from './local-ai/local-managed-models.component';
import { useModelHarness } from './model-harness.hook';
import { useModelVisibility } from './model-visibility.hook';

type RuntimeStatus = { state: string; release: string; instanceId: string; generation: number; baseOrigin: string; systemInfo: unknown; health?: unknown };
type Connection = ModelConnection & { credentialConfigured?: boolean };
const client = createServiceClient();
const capabilityIcons = { chat: Chat01Icon, mic: Mic01Icon, volume: VolumeUpIcon, image: Image01Icon } as const;
const protocolLabels = { ollama: 'Ollama', 'openai-compatible': 'OpenAI compatible', 'openai-responses': 'OpenAI Responses', 'azure-openai': 'Azure OpenAI', anthropic: 'Anthropic', gemini: 'Gemini' } satisfies Record<ModelConnection['kind'], string>;
const templates = [
  { name: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
  { name: 'LM Studio', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
  { name: 'llama.cpp server', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1' },
  { name: 'OpenAI', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
  { name: 'OpenAI Responses', kind: 'openai-responses', baseUrl: 'https://api.openai.com/v1' },
  { name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { name: 'Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { name: 'Azure OpenAI', kind: 'azure-openai', baseUrl: '' },
  { name: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'Hugging Face', kind: 'openai-compatible', baseUrl: 'https://router.huggingface.co/v1' },
  { name: 'Custom endpoint', kind: 'openai-compatible', baseUrl: '' },
] satisfies Pick<ModelConnection, 'name' | 'kind' | 'baseUrl'>[];

export function ModelsWorkspace({ scope, onBrowseModels, onUseModel, onOpenMedia }: { scope: 'local' | 'cloud' | 'runtime'; onBrowseModels?: () => void; onUseModel?: (model: string) => void; onOpenMedia?: () => void }) {
  const [serviceBase, setServiceBase] = useState(() => currentServiceBase() ?? developmentServiceBase);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(() => {
    const native = typeof window !== 'undefined' ? window.__AIR_LEMONADE_STATUS__ : undefined;
    return native?.base_origin ? { state: native.state, release: native.release, instanceId: 'air-lemonade', generation: native.generation ?? 0, baseOrigin: native.base_origin, systemInfo: null } : null;
  });
  const [runtimeError, setRuntimeError] = useState('');
  const runtimeClient = useMemo(() => createServiceClient(serviceBase), [serviceBase]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const base = await resolveServiceBase();
      if (alive) setServiceBase(base);
    })().catch((reason: unknown) => { if (alive) setRuntimeError(reason instanceof Error ? reason.message : 'AIR Office service is unavailable.'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = () => { if (pending || !alive) return; pending = true; void runtimeClient.json<RuntimeStatus>('/api/v1/local-ai/status', { signal: controller.signal }).then((status) => { if (alive) { setRuntimeStatus(status); setRuntimeError(''); } }).catch((reason: unknown) => { if (alive) { setRuntimeError(reason instanceof Error ? reason.message : 'Local AI status is unavailable.'); setRuntimeStatus((current) => current ? { ...current, state: 'unavailable' } : null); } }).finally(() => { pending = false; }); };
    void refresh();
    const changed = () => {
      const native = window.__AIR_LEMONADE_STATUS__;
      if (native) setRuntimeStatus(native.base_origin ? { state: native.state, release: native.release, instanceId: 'air-lemonade', generation: native.generation ?? 0, baseOrigin: native.base_origin, systemInfo: null } : null);
      if (window.__AIR_SERVICE_BASE__ && window.__AIR_SERVICE_BASE__ !== serviceBase) setServiceBase(window.__AIR_SERVICE_BASE__);
      else void refresh();
    };
    window.addEventListener('air-office-bootstrap', changed);
    const timer = window.setInterval(refresh, 5000);
    return () => { alive = false; controller.abort(); window.clearInterval(timer); window.removeEventListener('air-office-bootstrap', changed); };
  }, [runtimeClient, serviceBase]);
  const [addingConnection, setAddingConnection] = useState(false);
  const [connectionAdvanced, setConnectionAdvanced] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [discoveredFilter, setDiscoveredFilter] = useState('');
  const modelVisibility = useModelVisibility();
  const modelHarness = useModelHarness(client);
  const [harnessPending, setHarnessPending] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const [localNotice, setLocalNotice] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [draft, setDraft] = useState<ModelConnection | null>(null);
  const [secret, setSecret] = useState('');
  const [modelText, setModelText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<{ state: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [headersText, setHeadersText] = useState('{}');
  const [capabilitiesText, setCapabilitiesText] = useState('{}');
  const [chatGptState, setChatGptState] = useState<{ status: string; sessionId: string | null; authorizationUrl?: string; accounts: { id: string; email: string; active: boolean; connected: boolean; planUsageAvailable: boolean }[]; activeAccountId: string | null } | null>(null);
  const [chatGptModels, setChatGptModels] = useState<string[]>([]);
  const [chatGptError, setChatGptError] = useState('');
  const [chatGptBusy, setChatGptBusy] = useState(false);
  const chatGptPopup = useRef<Window | null>(null);
  const checkEpoch = useRef(0);
  const checkController = useRef<AbortController | null>(null);
  useEffect(() => () => checkController.current?.abort(), []);
  function updateDraft(item: ModelConnection) { checkEpoch.current++; checkController.current?.abort(); setChecking(false); setHealth(null); setDraft(item); }
  async function refresh() { const result = await client.json<{ connections: Connection[] }>('/api/v1/model-connections'); setConnections(result.connections); }
  async function refreshChatGptModels() {
    const result = await client.json<{ providers: { id: string; models: string[] }[] }>('/api/v1/providers');
    setChatGptModels(result.providers.find((provider) => provider.id === 'chatgpt-signin')?.models ?? []);
  }
  function publishChatGptModels() { window.dispatchEvent(new Event('office-models-changed')); }
  async function checkHealth(item: Connection) {
    const epoch = ++checkEpoch.current; checkController.current?.abort();
    const controller = new AbortController(); checkController.current = controller;
    setHealth(null); setError(''); setChecking(true);
    try { const result = await client.json<{ state: string; message: string }>(`/api/v1/model-connections/${item.id}/health`, { signal: controller.signal }); if (checkEpoch.current === epoch) setHealth(result); }
    catch (reason) { if (!controller.signal.aborted && checkEpoch.current === epoch) setHealth({ state: 'unreachable', message: reason instanceof Error ? reason.message : 'The endpoint could not be reached.' }); }
    finally { if (checkEpoch.current === epoch) setChecking(false); }
  }
  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Connections unavailable.')).finally(() => setLoading(false)); }, []);
  const refreshChatGpt = async (sessionId?: string, options?: { publish?: boolean }) => {
    const state = await client.json<NonNullable<typeof chatGptState>>('/api/v1/cloud/chatgpt/status' + (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''));
    setChatGptState(state);
    if (state.accounts.some((account) => account.active && account.planUsageAvailable)) {
      try { await refreshChatGptModels(); if (options?.publish !== false) publishChatGptModels(); }
      catch { setChatGptModels([]); }
    } else setChatGptModels([]);
    return state;
  };
  useEffect(() => {
    if (scope !== 'cloud' || !chatGptState?.sessionId || chatGptState.status !== 'authorizing') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.json<typeof chatGptState>(`/api/v1/cloud/chatgpt/status?sessionId=${encodeURIComponent(chatGptState.sessionId!)}`);
        if (!active) return;
        setChatGptState(result);
        if (result.status === 'connected') {
          chatGptPopup.current?.close();
          chatGptPopup.current = null;
          setChatGptError('');
          try { await refreshChatGptModels(); } catch { setChatGptModels([]); }
          publishChatGptModels();
          return;
        }
        if (result.status === 'authorizing') timer = setTimeout(() => void poll(), 1200);
        else { chatGptPopup.current?.close(); chatGptPopup.current = null; }
      } catch (reason) { if (active) setChatGptError(reason instanceof Error ? reason.message : 'ChatGPT sign-in status is unavailable.'); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [scope, chatGptState?.sessionId, chatGptState?.status]);
  useEffect(() => { if (scope === 'cloud') void refreshChatGpt().catch((reason: unknown) => setChatGptError(reason instanceof Error ? reason.message : 'ChatGPT accounts are unavailable.')); }, [scope]);
  async function startChatGptSignIn(accountId?: string) {
    chatGptPopup.current = window.airDesktop ? null : window.open('about:blank', '_blank');
    if (chatGptPopup.current) chatGptPopup.current.opener = null;
    setChatGptBusy(true); setChatGptError('');
    try {
      const session = await client.json<{ sessionId: string; status: string; authorizationUrl: string }>('/api/v1/cloud/chatgpt/sign-in', { method: 'POST', body: JSON.stringify(accountId ? { accountId } : {}) });
      if (chatGptPopup.current) chatGptPopup.current.location.href = session.authorizationUrl;
      else window.open(session.authorizationUrl, '_blank', 'noopener,noreferrer');
      await refreshChatGpt(session.sessionId);
    } catch (reason) { chatGptPopup.current?.close(); chatGptPopup.current = null; setChatGptError(reason instanceof Error ? reason.message : 'ChatGPT sign-in could not be started.'); }
    finally { setChatGptBusy(false); }
  }
  async function disconnectChatGpt(accountId: string) {
    const result = await client.json<{ revocationConfirmed: boolean }>(`/api/v1/cloud/chatgpt/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    await refreshChatGpt();
    setChatGptModels([]);
    publishChatGptModels();
    if (!result.revocationConfirmed) setChatGptError('Local credentials were removed, but remote sign-out was not confirmed. You can disconnect AIR Office in ChatGPT settings.');
  }
  function edit(item: ModelConnection) { updateDraft(item); setConnectionAdvanced(item.models.length === 0 && item.observedModels.length === 0); setDiscoveredFilter(''); setModelText(item.models.join('\n')); setHeadersText(JSON.stringify(item.headers ?? {}, null, 2)); setCapabilitiesText(JSON.stringify(item.modelCapabilities ?? {}, null, 2)); setSecret(''); setNotice(''); setError(''); }
  function add(index: number) { const template = templates[index]; if (!template) return; edit({ ...template, id: `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`, models: [], imageModels: [], observedModels: [], observedAt: null, discovery: 'unknown', discoveryError: null }); }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.'); }
    finally {
      try { await refresh(); window.dispatchEvent(new Event('office-models-changed')); }
      catch { setError((current) => current || 'Connection status could not be refreshed.'); }
      setBusy(false);
    }
  }
  async function save() {
    if (!draft) return;
    let headers: Record<string, string>; let modelCapabilities: ModelConnection['modelCapabilities'];
    try { headers = JSON.parse(headersText) as Record<string, string>; modelCapabilities = JSON.parse(capabilitiesText) as ModelConnection['modelCapabilities']; } catch { throw new Error('Advanced headers and capabilities must be valid JSON objects.'); }
    const next = { ...draft, headers, modelCapabilities, models: modelText.split(/[\n,]/).map((name) => name.trim()).filter(Boolean) };
    const response = await client.request('/api/v1/model-connections', { method: 'PUT', body: JSON.stringify({ connection: next, ...(secret.trim() ? { secret: secret.trim() } : {}) }) });
    const body = await response.json().catch(() => null) as { connection?: ModelConnection; error?: string } | null;
    if (!response.ok) {
      // Retain attempted edits for retry; the refreshed list shows saved state.
      throw new Error(body?.error ?? `Connection save failed (${response.status}).`);
    }
    if (!body?.connection) throw new Error('The service saved the connection but returned no connection details.');
    updateDraft(body.connection);
    setSecret('');
    return body.connection;
  }
  async function saveAndRefreshModels() {
    await save();
    if (!draft) return null;
    const result = await client.json<{ connection: ModelConnection; empty: boolean }>(`/api/v1/model-connections/${draft.id}/discover`, { method: 'POST' });
    updateDraft(result.connection);
    setModelText(result.connection.models.join('\n'));
    setNotice(result.empty ? 'No models were found.' : 'Model list updated.');
    return result.connection;
  }
  async function localOperation<T>(operation: Record<string, unknown>): Promise<T> {
    const response = await runtimeClient.json<{ result: T }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify(operation) });
    return response.result;
  }
  async function refreshRuntime() {
    const status = await runtimeClient.json<RuntimeStatus>('/api/v1/local-ai/status');
    setRuntimeStatus(status); setRuntimeError('');
  }
  async function manageBackend(operation: Record<string, unknown>, success: string) {
    setLocalBusy(true); setLocalError(''); setLocalNotice('');
    try {
      const result = await localOperation<unknown>(operation);
      setLocalNotice(success);
      const status = await runtimeClient.json<RuntimeStatus>('/api/v1/local-ai/status');
      setRuntimeStatus(status);
    } catch (reason) { setLocalError(reason instanceof Error ? reason.message : 'The backend operation could not be completed.'); }
    finally { setLocalBusy(false); }
  }
  const connectedFolder = useMemo(() => () => runtimeClient.json<{ connected: boolean; label?: string }>('/api/v1/local-ai/import-folder'), [runtimeClient]);
  const hardware = localHardwareFacts(runtimeStatus?.systemInfo);
  const saved = connections.find((item) => item.id === draft?.id);
  const connectionModels = saved ? [...new Set([...saved.models, ...saved.observedModels])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })) : [];
  const discoveredModels = connectionModels.filter((model) => model.toLowerCase().includes(discoveredFilter.trim().toLowerCase()));
  const hiddenCount = saved ? connectionModels.filter((model) => modelVisibility.hidden.includes(`${saved.id}:${model}`)).length : 0;
  const pinnedCount = saved ? connectionModels.filter((model) => modelVisibility.pinned.includes(`${saved.id}:${model}`)).length : 0;
  const runtimeReady = !runtimeError && runtimeStatus?.state === 'ready';
  const runtimeLabel = runtimeReady ? 'Ready' : runtimeStatus?.state === 'loading' ? 'Starting…' : 'Unavailable';
  return <section className="models-workspace" aria-label={scope === 'cloud' ? 'Cloud AI' : 'Local AI'}>
    {scope === 'local' && <>
      <div className="model-connections-toolbar"><span role="status">{runtimeLabel}</span>{onBrowseModels && <Button size="sm" onPress={onBrowseModels}>Browse models in Market</Button>}</div>
      <LocalAiHardware systemInfo={runtimeStatus?.systemInfo} client={runtimeClient} available={runtimeReady} onRefresh={refreshRuntime} />
      <LocalModelScan client={runtimeClient} onImported={() => refreshRuntime()} onUseModel={onUseModel} onOpenMedia={onOpenMedia} systemInfo={runtimeStatus?.systemInfo} runtimeReady={runtimeReady} />
      {capabilityRows(hardware).length > 0 && <Card render={(props) => <section {...props} />} className="rounded-2xl p-3" aria-label="Local engines"><h3 className="settings-block-heading"><HugeiconsIcon icon={CpuIcon} size={18} aria-hidden="true" />Engines</h3><Separator /><p className="settings-pref-help">What each engine lets you do locally, and whether it is ready.</p>{capabilityRows(hardware).map((row) => <div className="settings-pref-row" key={row.capability.id}><div className="settings-pref-copy"><span className="settings-pref-label"><HugeiconsIcon icon={capabilityIcons[row.capability.icon]} size={16} aria-hidden="true" />{row.capability.label}</span><span className="settings-pref-help">{row.detail}</span></div><div className="team-actions">{row.state === 'ready' && <span className="local-engine-state is-ready">{row.label}</span>}{row.state === 'install' && row.backend && <Button variant="secondary" size="sm" isDisabled={localBusy || !runtimeReady} onPress={() => void manageBackend({ operation: 'install', input: { recipe: row.backend!.recipe, backend: row.backend!.id, stream: false } }, `${row.capability.engine} is ready.`)}>{row.backend.state === 'update_required' ? 'Update' : 'Install'}</Button>}{row.state === 'unknown' && <span className="local-engine-state">{row.label}</span>}{row.state === 'unsupported' && <span className="local-engine-state is-unsupported">{row.label}</span>}</div></div>)}</Card>}
      {localError && <p role="alert">{localError}</p>}{localNotice && <p role="status">{localNotice}</p>}
    </>}
    {scope === 'runtime' && <section className="model-setup-panel" aria-label="Advanced local runtime">
      {runtimeReady && <LocalAiModelUpdates client={runtimeClient} onChanged={refreshRuntime} />}
      {typeof window !== 'undefined' && Boolean(window.airDesktop) && <LocalAiImportFolder connectedFolder={connectedFolder} disconnectFolder={() => runtimeClient.json('/api/v1/local-ai/import-folder', { method: 'DELETE' })} importFolder={(selection) => runtimeClient.json('/api/v1/local-ai/import-folder', { method: 'POST', body: JSON.stringify(selection) })} onImported={refreshRuntime} />}
      <LocalAiPanels operation={localOperation} client={runtimeClient} />
      <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3"><h3 className="settings-block-heading"><HugeiconsIcon icon={File01Icon} size={18} aria-hidden="true" />Register a model definition</h3><Separator /><form className="model-connection-editor" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void localOperation({ operation: 'register-model', input: { model_name: String(form.get('model_name') ?? ''), recipe: String(form.get('recipe') ?? ''), checkpoint: String(form.get('checkpoint') ?? '') } }).then(() => setLocalNotice('Model registered.')).catch(() => setLocalError('Model registration failed.')); }}><label className="app-dialog-field">Model name<Input name="model_name" required maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label><label className="app-dialog-field">Recipe<Input name="recipe" required defaultValue="llamacpp" /></label><label className="app-dialog-field">Folder name<Input name="checkpoint" required maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label><Button type="submit" variant="secondary" size="sm" isDisabled={!runtimeReady}>Register</Button></form></Card>
      {localError && <p role="alert">{localError}</p>}{localNotice && <p role="status">{localNotice}</p>}
    </section>}
    {scope === 'cloud' && <>
    {scope === 'cloud' && <Card render={(props) => <section {...props} />} className="rounded-2xl p-3" aria-label="ChatGPT account">
      <h3 className="settings-block-heading"><HugeiconsIcon icon={Chat01Icon} size={18} aria-hidden="true" />ChatGPT account</h3><Separator />
      {chatGptState?.accounts.length ? <>
        <p className="settings-pref-help">Sign in to use models from your ChatGPT plan in chat. Tokens stay in the service credential store and run through the same Copilot path as API keys and Local.</p>
        {chatGptState.accounts.map((account) => <div className="settings-pref-row" key={account.id}><div className="settings-pref-copy"><span className="settings-pref-label">{account.email} · {account.id.slice(0, 8)}{account.active ? ' · Active' : ''}</span><span className="settings-pref-help">{!account.connected ? 'Signed out' : account.planUsageAvailable ? 'Plan models enabled' : 'Plan model access unavailable'}</span></div><div className="team-actions">{account.connected && !account.active && <Button variant="tertiary" size="sm" isDisabled={chatGptBusy} onPress={() => void perform(async () => { await client.json('/api/v1/cloud/chatgpt/select', { method: 'POST', body: JSON.stringify({ accountId: account.id }) }); await refreshChatGpt(); publishChatGptModels(); })}>Use account</Button>}<Button variant="tertiary" size="sm" isDisabled={chatGptBusy} onPress={() => void startChatGptSignIn(account.id)}>Reconnect</Button>{account.connected && <Button variant="tertiary" size="sm" isDisabled={chatGptBusy} onPress={() => void perform(() => disconnectChatGpt(account.id))}>Disconnect</Button>}</div></div>)}
        {chatGptModels.length > 0 && <section className="model-discovered" aria-labelledby="chatgpt-models-title">
          <h3 id="chatgpt-models-title">Plan models ({chatGptModels.length})</h3>
          <p className="settings-pref-help">These models appear in chat and other model pickers after sign-in.</p>
          <ul className="model-discovered-list" aria-label="ChatGPT plan models">{chatGptModels.map((model) => {
            const key = `chatgpt-signin:${model}`;
            const pinned = modelVisibility.pinned.includes(key);
            const hidden = modelVisibility.hidden.includes(key);
            return <li key={model} data-hidden={hidden || undefined}><span>{model}{pinned && <small> · Pinned</small>}{hidden && <small> · Hidden</small>}</span><div className="team-actions"><Button variant="tertiary" size="sm" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${model}`} onPress={() => modelVisibility.togglePin(key)}>{pinned ? 'Unpin' : 'Pin'}</Button><Button variant="tertiary" size="sm" aria-label={`${hidden ? 'Show' : 'Hide'} ${model}`} onPress={() => modelVisibility.toggleHidden(key)}>{hidden ? 'Show' : 'Hide'}</Button>{onUseModel && <Button variant="tertiary" size="sm" onPress={() => onUseModel(key)}>Use</Button>}</div></li>;
          })}</ul>
        </section>}
      </> : <p className="settings-pref-help">Connect ChatGPT to use models included with your plan.</p>}
      <div className="team-actions"><Button size="sm" isDisabled={chatGptBusy || chatGptState?.status === 'authorizing'} onPress={() => void startChatGptSignIn()}>{chatGptState?.status === 'authorizing' ? 'Waiting for ChatGPT...' : chatGptState?.accounts.length ? 'Add ChatGPT account' : 'Continue with ChatGPT'}</Button></div>
      {chatGptError && <p role="alert">{chatGptError}</p>}
    </Card>}
    <Card render={(props) => <section {...props} />} className="rounded-2xl p-3" aria-label="Provider connections">
    <h3 className="settings-block-heading"><HugeiconsIcon icon={AiCloudIcon} size={18} aria-hidden="true" />Provider connections</h3><Separator />
    <div className="model-connections-toolbar"><SearchField aria-label="Search connections" value={modelFilter} onChange={setModelFilter}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search connections" /><SearchField.ClearButton /></SearchField.Group></SearchField><Button variant="secondary" size="sm" onPress={() => { setAddingConnection(!addingConnection); setDraft(null); }}>{addingConnection ? 'Cancel' : 'Add connection'}</Button></div>
    {addingConnection && <div className="model-template-grid" aria-label="Add a connection">{templates.map((item, index) => <Button key={item.name} variant="secondary" size="sm" isDisabled={busy} onPress={() => { add(index); setAddingConnection(false); }}>{item.name}</Button>)}</div>}
    <p className="settings-pref-help">Connect cloud providers or a server running on your computer.</p>
    {loading ? <p role="status">Loading…</p> : <div className="model-connection-list" aria-label="Saved connections">{connections.filter((item) => {
      return `${item.name} ${item.models.join(' ')} ${item.observedModels.join(' ')}`.toLowerCase().includes(modelFilter.toLowerCase());
    }).map((item) => <button type="button" key={item.id} className={`model-connection${draft?.id === item.id ? ' is-selected' : ''}`} disabled={busy} onClick={() => edit(item)}><strong>{item.name.replace(/ · Demo$/, '')}</strong><span>{new Set([...item.models, ...item.observedModels]).size} {new Set([...item.models, ...item.observedModels]).size === 1 ? 'model' : 'models'}{item.credentialConfigured ? ' · Key saved' : ''}</span></button>)}</div>}
    {draft && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) { setDraft(null); setSecret(''); setError(''); setNotice(''); } }}><Modal.Container scroll="inside"><Modal.Dialog className="model-connection-dialog" aria-labelledby="model-connection-title"><Modal.CloseTrigger isDisabled={busy} /><form className="model-connection-dialog-form" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await saveAndRefreshModels(); setDraft(null); setSecret(''); setError(''); setNotice('Connection saved.'); }); }}>
      <Modal.Header><Modal.Heading id="model-connection-title">{saved ? 'Edit connection' : 'Add connection'}</Modal.Heading></Modal.Header><Modal.Body className="model-connection-dialog-body">
      <label className="app-dialog-field">Name<Input required maxLength={120} value={draft.name} disabled={busy} onChange={(event) => updateDraft({ ...draft, name: event.target.value })}/></label>
      <label className="app-dialog-field">Type<SelectField value={draft.kind} disabled={busy} onValueChange={(value) => { if (Object.hasOwn(protocolLabels, value)) updateDraft({ ...draft, kind: value as ModelConnection['kind'] }); }}>{Object.entries(protocolLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></label>
      <label className="app-dialog-field">Endpoint URL<Input required type="url" value={draft.baseUrl} disabled={busy} placeholder="https://api.example.com/v1" onChange={(event) => updateDraft({ ...draft, baseUrl: event.target.value })}/></label>
      <label className="app-dialog-field">{saved?.credentialConfigured ? 'Replace API key' : 'API key'}<Input type="password" autoComplete="new-password" value={secret} disabled={busy} placeholder={saved?.credentialConfigured ? 'Leave blank to keep the saved key' : 'Optional for local servers'} onChange={(event) => setSecret(event.target.value)}/></label>
      <div className="team-actions model-connection-key-actions">
        <Button variant="secondary" size="sm" isDisabled={busy || checking} onPress={() => void perform(async () => { const connection = await saveAndRefreshModels(); if (connection) await checkHealth(connection); })}>{busy || checking ? 'Saving…' : 'Save and Test'}</Button>
        {saved && <Button variant="tertiary" size="sm" isDisabled={busy || (!saved.credentialConfigured && !saved.retiredCredentialIds?.length)} onPress={() => void perform(async () => { await client.json(`/api/v1/providers/${saved.id}/credential`, { method: 'DELETE' }); setNotice('Saved key removed.'); })}>Remove</Button>}
      </div>
      {health && <p className="model-connection-feedback" role={health.state === 'failed' || health.state === 'unreachable' || health.state === 'auth-required' ? 'alert' : 'status'}>{health.message}</p>}
      {saved && saved.discovery !== 'success' && <p className={`model-discovery-status${saved.discovery === 'failed' ? ' is-error' : ''}`} role={saved.discovery === 'failed' ? 'alert' : 'status'}>{discoverySummary(saved)}</p>}
      {notice && <p className="model-connection-feedback" role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {saved && connectionModels.length > 0 && <section className="model-discovered" aria-labelledby="discovered-models-title">
        <h3 id="discovered-models-title">Chat models ({connectionModels.length})</h3>
        <p className="settings-pref-help">Pin favorites so they stay at the top of this list and in the chat model menu. Hide models you do not want in that menu.</p>
        <SearchField aria-label="Search provider models" value={discoveredFilter} onChange={setDiscoveredFilter}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search models" /><SearchField.ClearButton /></SearchField.Group></SearchField>
        <p className="model-visibility-summary" role="status" aria-live="polite">{pinnedCount} pinned · {hiddenCount} hidden</p>
        {discoveredModels.length > 0 ? <ul className="model-discovered-list" aria-label="Provider models">{discoveredModels.map((model) => {
          const key = `${saved.id}:${model}`;
          const pinned = modelVisibility.pinned.includes(key);
          const hidden = modelVisibility.hidden.includes(key);
          return <li key={model} data-hidden={hidden || undefined}><span>{model}{pinned && <small> · Pinned</small>}{hidden && <small> · Hidden</small>}</span><div className="team-actions"><Button variant="tertiary" size="sm" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${model}`} onPress={() => modelVisibility.togglePin(key)}>{pinned ? 'Unpin' : 'Pin'}</Button><Button variant="tertiary" size="sm" aria-label={`${hidden ? 'Show' : 'Hide'} ${model}`} onPress={() => modelVisibility.toggleHidden(key)}>{hidden ? 'Show' : 'Hide'}</Button></div>{isLoopbackProvider(saved.baseUrl) && <FullHarnessOption enabled={modelHarness.isFullHarness(saved.id, model)} disabled={busy || modelHarness.loading || harnessPending} onChange={(enabled) => { setHarnessPending(true); void modelHarness.setFullHarness(saved.id, model, enabled).catch(() => undefined).finally(() => setHarnessPending(false)); }} />}</li>;
        })}</ul> : <p role="status">No models match your search.</p>}
        <div className="team-actions"><Button variant="secondary" size="sm" onPress={() => modelVisibility.update((current) => ({ ...current, hidden: [...new Set([...current.hidden, ...connectionModels.map((model) => `${saved.id}:${model}`).filter((key) => !current.pinned.includes(key))])] }))}>Hide unpinned</Button><Button variant="secondary" size="sm" onPress={() => modelVisibility.update((current) => ({ ...current, hidden: current.hidden.filter((key) => !connectionModels.some((model) => key === `${saved.id}:${model}`)) }))}>Show all</Button></div>
      </section>}
      {modelHarness.error && <p role="alert">{modelHarness.error}</p>}
      {draft.kind === 'azure-openai' && <><label className="app-dialog-field">Deployment name<Input value={draft.deployment ?? ''} disabled={busy} onChange={(event) => updateDraft({ ...draft, deployment: event.target.value })}/></label><label className="app-dialog-field">API version<Input value={draft.apiVersion ?? ''} disabled={busy} placeholder="v1" onChange={(event) => updateDraft({ ...draft, apiVersion: event.target.value })}/></label></>}
      <div className="model-connection-options"><Button variant="secondary" size="sm" aria-expanded={connectionAdvanced} aria-controls="model-connection-options" onPress={() => setConnectionAdvanced(!connectionAdvanced)}>{connectionAdvanced ? 'Hide connection options' : 'Show connection options'}</Button>{connectionAdvanced && <div id="model-connection-options" className="model-advanced"><label className="app-dialog-field">Model IDs<TextArea rows={3} value={modelText} disabled={busy} placeholder="One model ID per line" onChange={(event) => setModelText(event.target.value)}/></label>{draft.kind === 'openai-compatible' && <label className="app-dialog-field">Image model IDs<Input disabled={busy} value={draft.imageModels.join(', ')} placeholder="Optional" onChange={(event) => updateDraft({ ...draft, imageModels: event.target.value.split(',').map((id) => id.trim()).filter(Boolean) })}/></label>}<label className="app-dialog-field">Headers (JSON)<TextArea rows={3} value={headersText} disabled={busy} onChange={(event) => { setHeadersText(event.target.value); setHealth(null); checkEpoch.current++; setChecking(false); checkController.current?.abort(); }}/></label><label className="app-dialog-field">Capabilities (JSON)<TextArea rows={3} value={capabilitiesText} disabled={busy} onChange={(event) => setCapabilitiesText(event.target.value)}/></label></div>}</div>
      </Modal.Body><Modal.Footer className="model-connection-dialog-footer">{saved && <Button variant="danger-soft" size="sm" isDisabled={busy} onPress={() => void perform(async () => { await client.json(`/api/v1/model-connections/${saved.id}`, { method: 'DELETE' }); setDraft(null); setSecret(''); setNotice('Connection removed.'); })}>Remove connection</Button>}<div className="model-connection-dialog-footer-end"><Button variant="secondary" isDisabled={busy} onPress={() => { setDraft(null); setSecret(''); setError(''); setNotice(''); }}>Cancel</Button><Button type="submit" isDisabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div></Modal.Footer>
    </form></Modal.Dialog></Modal.Container></Modal.Backdrop>}
    </Card>
    </>}
    {!draft && <>{busy && <p role="status">Working...</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</>}
  </section>;
}
