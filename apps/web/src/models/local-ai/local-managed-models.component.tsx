import { useEffect, useState } from 'react';
import { Button, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CpuIcon, Delete02Icon, Image01Icon, PlayIcon, ServerStack01Icon } from '@hugeicons/core-free-icons';
import { useAppDialogs } from '../../shared/app-dialogs.component';
import type { ServiceClient } from '../../shared/service-client.hook';
import { SelectField } from '../../shared/select-field.component';
import { localHardwareFacts, type HardwareFacts } from './local-ai-hardware.policy';
import { AUTO_ENGINE, modelEngines, selectedModelEngine, type ModelEngine } from './local-ai-capability.policy';
import { useModelVisibility } from '../model-visibility.hook';
import { useModelHarness } from '../model-harness.hook';

export type ManagedModel = { id: string; name: string; role: 'chat' | 'embedding' | 'rerank' | 'image' | 'stt' | 'tts' | 'other'; recipe: string; backend: string | null };

/** The device a backend runs on, in words a person would use. */
const deviceLabels: Record<string, string> = { cpu: 'CPU', amd_gpu: 'AMD GPU', nvidia_gpu: 'NVIDIA GPU', intel_gpu: 'Intel GPU' };

/** What a model is for, in the words a person would use. */
const roleNames: Record<string, string> = { chat: 'Chat model', embedding: 'Embedding model', rerank: 'Rerank model', image: 'Image model', stt: 'Transcription model', tts: 'Speech model', other: 'Model' };

export function FullHarnessOption({ enabled, disabled, onChange }: { enabled: boolean; disabled: boolean; onChange: (enabled: boolean) => void }) {
  return <label className="local-model-harness">
    <input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span><strong>Full harness</strong><small>Enables Copilot tools for this model, including terminal commands (Ask first or Allow All). Requires a capable model and more memory, and may be slower. Run code stays gated in Tools settings.</small></span>
  </label>;
}

/**
 * One model the runtime holds. The model is listed apart from the user's own
 * data because it is managed by the runtime, not stored with the workspace.
 */
function ManagedModelRow({ model, engines, client, onChanged, onRemove, onUseModel, onOpenMedia, fullHarness, onFullHarness }: { model: ManagedModel; engines: ModelEngine[]; client: ServiceClient; onChanged: () => Promise<void>; onRemove: (model: ManagedModel) => void; onUseModel?: (model: string) => void; onOpenMedia?: () => void; fullHarness: boolean; onFullHarness: (enabled: boolean) => Promise<void> }) {
  const [options, setOptions] = useState<{ saved?: Record<string, unknown>; effective?: Record<string, unknown> } | null>(null);
  const visibility = useModelVisibility();
  const modelKey = `managed-local:${model.id}`;
  const pinned = visibility.pinned.includes(modelKey);
  const hidden = visibility.hidden.includes(modelKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void client.json<{ result: { saved?: Record<string, unknown>; effective?: Record<string, unknown> } }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'model-options', model: model.id }), signal: controller.signal })
      .then((result) => setOptions(result.result)).catch(() => undefined);
    return () => controller.abort();
  }, [client, model.id]);
  const current = selectedModelEngine(options, model.recipe);
  /**
   * The choice the user made. When nothing is saved the runtime picks the
   * engine itself, so the chooser shows the automatic choice rather than
   * pretending the user made one.
   */
  const saved = typeof options?.saved?.[`${model.recipe}_backend`] === 'string' && options.saved[`${model.recipe}_backend`] ? String(options.saved[`${model.recipe}_backend`]) : null;
  const effective = saved ?? AUTO_ENGINE;
  async function choose(value: string) {
    if (!value) return;
    setBusy(true); setError('');
    try {
      // An engine the user has not installed yet is installed first, so the
      // choice is real rather than a promise.
      const engine = engines.find((item) => item.id === value);
      if (engine && !engine.installed) {
        await client.json('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'install', input: { recipe: engine.recipe, backend: engine.id, stream: false } }) });
      }
      await client.json('/api/v1/local-ai/model-scan', { method: 'POST', body: JSON.stringify({ action: 'set-model-engine', model: model.id, backend: value, recipe: model.recipe }) });
      setOptions((current) => {
        const key = `${model.recipe}_backend`;
        const savedOptions = { ...current?.saved };
        const effectiveOptions = { ...current?.effective };
        if (value === AUTO_ENGINE) {
          delete savedOptions[key];
          delete effectiveOptions[key];
        } else {
          savedOptions[key] = value;
        }
        return { ...current, saved: savedOptions, effective: effectiveOptions };
      });
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The engine could not be changed.'); }
    finally { setBusy(false); }
  }
  return <div className="local-model-row" data-role="managed">
    <div className="local-model-copy">
      <strong>{model.name}</strong>
      <span className="local-model-meta">{roleNames[model.role] ?? 'Model'} · Downloaded</span>
    </div>
    <div className="local-model-engine">
      <span className="local-model-engine-label"><HugeiconsIcon icon={CpuIcon} size={16} aria-hidden="true" />Runs on</span>
      <SelectField aria-label={`Engine for ${model.name}`} value={effective} disabled={busy || engines.length === 0} onValueChange={(value) => void choose(value)}>
        {engines.length === 0
          ? <option value={AUTO_ENGINE}>No engine available</option>
          : <option value={AUTO_ENGINE}>Automatic{current ? ` · ${current}` : ''}</option>}
        {engines.map((engine) => {
          const devices = engine.devices.filter((device) => device !== 'cpu').map((device) => deviceLabels[device] ?? device.replaceAll('_', ' '));
          const suffix = devices.length ? ` · ${devices.join(', ')}` : '';
          return <option key={engine.id} value={engine.id}>{engine.label}{suffix}{engine.installed ? '' : ' · Install'}</option>;
        })}
      </SelectField>
    </div>
    <div className="team-actions">
      {model.role === 'chat' && onUseModel && <Button variant="secondary" size="sm" onPress={() => onUseModel(model.id)}><HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />Use in chat</Button>}
      {model.role === 'chat' && <><Button variant="tertiary" size="sm" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${model.name}`} onPress={() => visibility.togglePin(modelKey)}>{pinned ? 'Unpin' : 'Pin'}</Button><Button variant="tertiary" size="sm" aria-label={`${hidden ? 'Show' : 'Hide'} ${model.name}`} onPress={() => visibility.toggleHidden(modelKey)}>{hidden ? 'Show' : 'Hide'}</Button></>}
      {model.role === 'image' && onOpenMedia && <Button variant="secondary" size="sm" onPress={onOpenMedia}><HugeiconsIcon icon={Image01Icon} size={16} aria-hidden="true" />Use in Media</Button>}
      <Button variant="danger-soft" size="sm" isDisabled={busy} aria-label={`Delete model ${model.name}`} onPress={() => onRemove(model)}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Delete</Button>
    </div>
    {model.role === 'chat' && <FullHarnessOption enabled={fullHarness} disabled={busy} onChange={(enabled) => { setBusy(true); setError(''); void onFullHarness(enabled).catch((reason) => setError(reason instanceof Error ? reason.message : 'The harness preference could not be saved.')).finally(() => setBusy(false)); }} />}
    {error && <span className="local-model-error" role="alert">{error}</span>}
  </div>;
}

/** Models the managed runtime holds, each with the engine it runs on. */
export function LocalManagedModels({ client, systemInfo, runtimeReady, onChanged, onUseModel, onOpenMedia }: { client: ServiceClient; systemInfo: unknown; runtimeReady?: boolean; onChanged: () => Promise<void>; onUseModel?: (model: string) => void; onOpenMedia?: () => void }) {
  const [models, setModels] = useState<ManagedModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogs = useAppDialogs();
  const harness = useModelHarness(client);
  const hardware: HardwareFacts = localHardwareFacts(systemInfo);
  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void client.json<{ managedModels?: ManagedModel[] }>('/api/v1/local-ai/model-scan', { signal: controller.signal })
        .then((status) => { if (!controller.signal.aborted && current === revision) { setModels(status.managedModels ?? []); setError(''); } })
        .catch(() => { if (!controller.signal.aborted && current === revision) setError('Downloaded models could not be loaded.'); });
    };
    refresh();
    window.addEventListener('office-models-changed', refresh);
    return () => { controller.abort(); window.removeEventListener('office-models-changed', refresh); };
  }, [client, runtimeReady]);
  const engines = modelEngines('llamacpp', hardware);
  /** Each model chooses from the engines of its own recipe. */
  const enginesFor = (recipe: string) => recipe === 'llamacpp' ? engines : modelEngines(recipe, hardware);
  /**
   * A downloaded model is removed from the runtime, so its files go with it.
   * The user is told this, because the file cannot be recovered.
   */
  async function remove(model: ManagedModel) {
    const approved = await dialogs.confirm({
      title: 'Delete model',
      message: `Delete "${model.name}"? The downloaded files are removed from this computer and the model is no longer available.`,
      confirmLabel: 'Delete model',
      destructive: true,
    });
    if (!approved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await client.json('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'delete', input: { model_name: model.id } }) });
      setModels((current) => current.filter((item) => item.id !== model.id));
      setNotice(`${model.name} was deleted.`);
      await onChanged();
      window.dispatchEvent(new Event('office-models-changed'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The model could not be deleted.'); }
    finally { setBusy(false); }
  }
  if (models.length === 0 && !error) return null;
  return <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-xl p-3" aria-label="Downloaded models">
    <h4 className="settings-block-heading"><HugeiconsIcon icon={ServerStack01Icon} size={18} aria-hidden="true" />Downloaded models</h4>
    <Separator />
    <p className="settings-pref-help">Models downloaded in Market run on your computer. Choose an engine or enable more agent tools for a compatible chat model.</p>
    {models.map((model) => <ManagedModelRow key={model.id} model={model} engines={enginesFor(model.recipe)} client={client} onChanged={onChanged} onRemove={(selected) => void remove(selected)} onUseModel={onUseModel} onOpenMedia={onOpenMedia} fullHarness={harness.isFullHarness('managed-local', model.id)} onFullHarness={(enabled) => harness.setFullHarness('managed-local', model.id, enabled).then(() => undefined)} />)}
    {notice && <p role="status">{notice}</p>}
    {harness.error && <p role="alert">{harness.error}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
