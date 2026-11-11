import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Chat01Icon, Delete02Icon, Download01Icon, Image01Icon, Mic01Icon, PlayIcon, Search01Icon, ServerStack01Icon, SparklesIcon, VolumeUpIcon } from '@hugeicons/core-free-icons';
import { useAppDialogs } from '../../shared/app-dialogs.component';
import type { ServiceClient } from '../../shared/service-client.hook';
import { FolderPickerButton } from '../../shared/folder-picker.component';
import { displayBytes } from './local-ai-catalog.policy';
import { FullHarnessOption, LocalManagedModels, type ManagedModel } from './local-managed-models.component';
import { useModelVisibility } from '../model-visibility.hook';
import { useModelHarness } from '../model-harness.hook';

type ScanEngine = { id: string; name: string; kind: string; version: string | null; path: string; running: boolean; port: number | null; installed?: boolean; builds?: string[] };
type ScanModel = { id: string; name: string; path: string; format: string; role?: 'chat' | 'embedding' | 'rerank' | 'image'; size: number; issue?: string; importedModel?: string };
type ScanStatus = { locations: { id: string; name: string; path: string; extra: boolean; available: boolean }[]; models: ScanModel[]; engines: ScanEngine[]; managedModels?: ManagedModel[]; canImport: boolean; scannedAt: string | null; warnings: string[]; buildVersions?: Record<string, string | null> };

/** The engine each model role needs in order to run. */
const roleEngines: Record<string, string> = { chat: 'llama.cpp', embedding: 'llama.cpp', rerank: 'llama.cpp', image: 'stable-diffusion.cpp' };

/** What a role can be used for, in the words the person would use. */
const rolePurpose: Record<string, string> = { chat: 'Chat', embedding: 'Knowledge search', rerank: 'Knowledge search', image: 'Images' };

/** Name a build after the folder that holds it, so several builds are told apart. */
function buildLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const binary = parts.indexOf('llama-server.exe') >= 0 ? parts.indexOf('llama-server.exe') : parts.length - 1;
  const folder = parts.slice(Math.max(0, binary - 3), binary).join('\\');
  return folder || path;
}

/**
 * Orders two build versions. A version that is not reported is treated as
 * older than one that is, so a build with a known version is listed first.
 */
function compareVersions(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const parts = (value: string) => value.split(/[.\-+]/).map((part) => Number.parseInt(part, 10)).map((part) => Number.isNaN(part) ? 0 : part);
  const left = parts(a); const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function LocalModelScan({ client, onImported, onUseModel, onOpenMedia, systemInfo, runtimeReady }: { client: ServiceClient; onImported: () => Promise<void>; onUseModel?: (model: string) => void; onOpenMedia?: () => void; systemInfo?: unknown; runtimeReady?: boolean }) {
  const visibility = useModelVisibility();
  const harness = useModelHarness(client);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const dialogs = useAppDialogs();
  useEffect(() => { const controller = new AbortController(); void client.json<ScanStatus>('/api/v1/local-ai/model-scan', { signal: controller.signal }).then(setStatus).catch(() => { if (!controller.signal.aborted) setError('Model locations could not be loaded.'); }); return () => controller.abort(); }, [client]);
  async function action(value: Record<string, unknown>, success = '') {
    setBusy(String(value.action)); setError(''); setNotice('');
    try {
      setStatus(await client.json<ScanStatus>('/api/v1/local-ai/model-scan', { method: 'POST', body: JSON.stringify(value) }));
      if (value.action === 'import' || value.action === 'delete') { await onImported(); window.dispatchEvent(new Event('office-models-changed')); }
      if (success) setNotice(success);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The scan action failed. Try again.'); }
    finally { setBusy(''); }
  }
  async function removeModel(id: string, name: string, imported: boolean) {
    const approved = await dialogs.confirm({ title: imported ? 'Remove model' : 'Remove model from list', message: imported ? `Remove "${name}" from Local AI? The model files on disk are kept.` : `Remove "${name}" from the list? The files on disk are kept.`, confirmLabel: 'Remove model', destructive: true });
    if (!approved) return;
    await action({ action: 'delete', id }, 'The model was removed. Its files are still on disk.');
  }
  /**
   * A build is only taken out of the list. The files belong to the user, so
   * they are never removed by AIR Office.
   */
  async function removeBuild(build: { id: string; build: string; label: string }) {
    const approved = await dialogs.confirm({ title: 'Remove engine build', message: `Remove this build from the list? The files on disk are kept.`, confirmLabel: 'Remove build', destructive: true });
    if (!approved) return;
    await action({ action: 'remove-engine', id: build.id, build: build.build }, 'The build was removed from the list. Its files are still on disk.');
  }
  const locations = status?.locations.filter((location) => location.extra || location.available) ?? [];
  const extraFolders = locations.filter((location) => location.extra);
  // The Data → Models folder is owned storage, so it is listed with added
  // folders but cannot be removed from the scan list here.
  const ownedFolders = locations.filter((location) => !location.extra && location.name === 'AI models');
  const listedFolders = [...ownedFolders, ...extraFolders];
  const engines = status?.engines ?? [];
  /**
   * Every llama.cpp server binary the scan found, one entry per build. The
   * newest build is listed first, because a user with several builds wants
   * the current one at the top.
   */
  const builds = useMemo(() => {
    const found = engines.flatMap((engine) => {
      const paths = engine.builds?.length ? engine.builds : engine.kind === 'llama.cpp' && !engine.path.startsWith('http') ? [engine.path] : [];
      return paths.filter((path) => /llama-server(\.exe)?$/i.test(path)).map((path) => ({ id: engine.id, build: path, engine: engine.name, label: buildLabel(path), path, version: status?.buildVersions?.[path] ?? null }));
    });
    return found.sort((a, b) => compareVersions(b.version, a.version));
  }, [engines, status?.buildVersions]);
  const hasEngine = engines.some((engine) => engine.kind === 'llama.cpp');
  const installedModels = status?.models.filter((model) => model.importedModel) ?? [];
  /** The one action a model offers, chosen by what the model can actually do. */
  const modelAction = (model: ScanModel) => {
    if (!model.importedModel) return <Button variant="secondary" size="sm" isDisabled={Boolean(busy) || !status?.canImport || Boolean(model.issue)} onPress={() => void action({ action: 'import', id: model.id }, 'The model was imported and is ready to use.')}>{busy === 'import' ? 'Importing...' : 'Import'}</Button>;
    const role = model.role ?? 'chat';
    if (role === 'chat' && onUseModel) {
      const key = `managed-local:${model.importedModel}`;
      const pinned = visibility.pinned.includes(key);
      const hidden = visibility.hidden.includes(key);
      return <><Button variant="secondary" size="sm" onPress={() => { if (model.importedModel) onUseModel(model.importedModel); }}><HugeiconsIcon icon={PlayIcon} size={16} aria-hidden="true" />Use in chat</Button><Button variant="tertiary" size="sm" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${model.name}`} onPress={() => visibility.togglePin(key)}>{pinned ? 'Unpin' : 'Pin'}</Button><Button variant="tertiary" size="sm" aria-label={`${hidden ? 'Show' : 'Hide'} ${model.name}`} onPress={() => visibility.toggleHidden(key)}>{hidden ? 'Show' : 'Hide'}</Button></>;
    }
    if (role === 'image' && onOpenMedia) return <Button variant="secondary" size="sm" onPress={onOpenMedia}><HugeiconsIcon icon={Image01Icon} size={16} aria-hidden="true" />Use in Media</Button>;
    return <span className="local-model-meta">Ready for {(rolePurpose[role] ?? 'Chat').toLowerCase()}</span>;
  };
  const walkthrough = [
    { label: 'Add a folder', done: listedFolders.length > 0 },
    { label: 'Scan for models', done: Boolean(status?.scannedAt) },
    { label: 'Import a model', done: installedModels.length > 0 },
    { label: 'Use it in chat', done: false },
  ];
  return <Card render={(props) => <section {...props} />} className="local-model-scan rounded-2xl p-3" aria-label="Local models">
    <h3 className="settings-block-heading"><HugeiconsIcon icon={SparklesIcon} size={18} aria-hidden="true" />Local models</h3>
    <Separator />
    <ol className="local-walkthrough" aria-label="How to set up local models">{walkthrough.map((step, index) => <li key={step.label} className={step.done ? 'is-done' : ''}><span className="local-walkthrough-step">{index + 1}</span><span>{step.label}</span></li>)}</ol>
    <div className="team-actions"><FolderPickerButton client={client} label="Add folders" title="Add model scan folder" disabled={Boolean(busy)} onSelect={(path) => void action({ action: 'add-folder', path }, 'The folder was added. Scan for models.')} /><Button size="sm" isDisabled={Boolean(busy) || !status} onPress={() => void action({ action: 'scan' }, 'The scan finished.')}>{busy === 'scan' ? 'Scanning...' : 'Scan for models'}</Button></div>
    {listedFolders.length > 0 && <Card variant="secondary" className="rounded-xl p-3" aria-label="Scanned folders">
      <h4 className="settings-block-heading"><HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" />Scanned folders</h4>
      <Separator />
      {listedFolders.map((location) => <div className="settings-pref-row" key={location.id}><div className="settings-pref-copy"><span className="settings-pref-label">{location.name}{location.extra ? '' : ' · From Data settings'}</span><span className="settings-pref-help">{location.path}{!location.available ? ' · Unavailable' : ''}</span></div>{location.extra ? <Button variant="tertiary" size="sm" isDisabled={Boolean(busy)} aria-label={`Remove scan folder ${location.name}`} onPress={() => void action({ action: 'remove-folder', id: location.id })}>Remove</Button> : null}</div>)}
    </Card>}
    {builds.length > 0 && <Card variant="secondary" className="rounded-xl p-3" aria-label="Engine builds">
      <h4 className="settings-block-heading"><HugeiconsIcon icon={ServerStack01Icon} size={18} aria-hidden="true" />Engine builds</h4>
      <Separator />
      <p className="settings-pref-help">Several llama.cpp builds can be installed at once. Each one is a separate version of the same engine; the newest one is listed first. Use a build you already have instead of installing one, and remove the ones you no longer need.</p>
      {builds.map((build) => <div className="settings-pref-row" key={build.build}><div className="settings-pref-copy"><span className="settings-pref-label">{build.label}</span><span className="settings-pref-help">{build.version ? `Version ${build.version} · ` : ''}{build.path}</span></div><div className="team-actions"><Button variant="secondary" size="sm" isDisabled={Boolean(busy) || !status?.canImport} onPress={() => void action({ action: 'use-engine', id: build.id, build: build.build }, 'This engine build is now used for local chat.')}>Use this build</Button><Button variant="danger-soft" size="sm" isDisabled={Boolean(busy)} aria-label={`Remove engine build ${build.label}`} onPress={() => void removeBuild(build)}>Remove</Button></div></div>)}
    </Card>}
    {status && engines.length === 0 && builds.length === 0 && <p className="settings-pref-help">No local engine was found on this computer. You can still add models and download them from the Market.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <LocalManagedModels client={client} systemInfo={systemInfo} runtimeReady={runtimeReady} onChanged={onImported} onUseModel={onUseModel} onOpenMedia={onOpenMedia} />
    {status?.warnings.map((warning) => <p className="settings-pref-help" key={warning}>{warning}</p>)}
    {status && status.models.length > 0 && <Card variant="secondary" className="rounded-xl p-3" aria-label="Models on this computer">
      <h4 className="settings-block-heading"><HugeiconsIcon icon={Download01Icon} size={18} aria-hidden="true" />Models on this computer</h4>
      <Separator />
      <p className="settings-pref-help">Model files found in your folders. Import one to use it in AIR Office; your files are never moved or changed.</p>
      <ul className="model-catalog-list" aria-label="Detected models">{status.models.map((model) => {
        const role = model.role ?? 'chat';
        const needed = roleEngines[role];
        const purpose = rolePurpose[role];
        return <li className="model-catalog-row" key={model.id}><div className="local-model-summary"><div className="local-model-copy"><strong>{model.name}</strong><span className="local-model-meta">{model.format} · {displayBytes(model.size)}{model.importedModel ? ' · Ready to use' : ''}</span><span className="local-model-meta">For {purpose} · Runs on {needed}{model.importedModel || hasEngine ? '' : ' · Engine not found'}</span><span className="local-model-meta">{model.path}</span>{model.issue && <span className="local-model-meta">{model.issue}</span>}</div><div className="team-actions">{modelAction(model)}<Button variant="danger-soft" size="sm" isDisabled={Boolean(busy) || (Boolean(model.importedModel) && !status.canImport)} aria-label={model.importedModel ? `Remove model ${model.name}` : `Remove model ${model.name} from the list`} onPress={() => void removeModel(model.id, model.name, Boolean(model.importedModel))}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Remove</Button></div></div>{model.importedModel && role === 'chat' && <FullHarnessOption enabled={harness.isFullHarness('managed-local', model.importedModel)} disabled={harness.loading || Boolean(busy)} onChange={(enabled) => { if (model.importedModel) { setBusy('harness'); void harness.setFullHarness('managed-local', model.importedModel, enabled).catch(() => undefined).finally(() => setBusy('')); } }} />}</li>;
      })}</ul>
    </Card>}
    {harness.error && <p role="alert">{harness.error}</p>}
    {status && status.models.length === 0 && <p role="status">No GGUF or MLX models found. Add a folder or check folder access.</p>}
    {status && !status.canImport && status.models.length > 0 && <p className="settings-pref-help">Import requires the managed local runtime on this computer.</p>}
  </Card>;
}
