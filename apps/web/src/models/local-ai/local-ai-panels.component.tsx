import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input, TextArea, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Loading01Icon, Settings01Icon, Share02Icon, Wrench01Icon } from '@hugeicons/core-free-icons';
import { createServiceClient, type ServiceClient } from '../../shared/service-client.hook';
import { SelectField } from '../../shared/select-field.component';
import { LocalAiCollections, type CollectionModelChoice } from './local-ai-collections.component';
import { LocalAiRuntimeUpdate } from './local-ai-runtime-update.component';

type Operation = (value: Record<string, unknown>) => Promise<unknown>;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function rows(value: unknown, key: string): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : record(value) && Array.isArray(value[key]) ? value[key] : [];
  return Array.isArray(list) ? list.filter(record) : [];
}
const fields = [
  { key: 'max_loaded_models', label: 'Maximum loaded models', type: 'number', min: -1 },
  { key: 'ctx_size', label: 'Default context tokens', type: 'number', min: -1 },
  { key: 'global_timeout', label: 'Request timeout in seconds', type: 'number', min: 1 },
  { key: 'auto_evict', label: 'Automatically unload idle models', type: 'boolean', min: 0 },
  { key: 'inhibit_suspend', label: 'Keep computer awake during work', type: 'boolean', min: 0 },
  { key: 'auto_evict_threshold_pct', label: 'Memory threshold for automatic unloading', type: 'number', min: 0.01 },
  { key: 'log_max_file_size_mb', label: 'Maximum log file size in MB', type: 'number', min: 1 },
  { key: 'log_max_files', label: 'Retained log files', type: 'number', min: 0 },
  { key: 'disable_model_filtering', label: 'Show all model definitions', type: 'boolean', min: 0 },
  { key: 'enable_dgpu_gtt', label: 'Allow shared memory for discrete graphics', type: 'boolean', min: 0 },
  { key: 'log_level', label: 'Troubleshooting log level', type: 'enum', min: 0 },
] as const;

export function LocalAiPanels({ operation, client }: { operation: Operation; client?: ServiceClient }) {
  const resolvedClient = useMemo(() => client ?? createServiceClient(), [client]);
  const [models, setModels] = useState<CollectionModelChoice[]>([]);
  const [aliases, setAliases] = useState<Record<string, unknown>[]>([]);
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>({});
  const [alias, setAlias] = useState(''); const [target, setTarget] = useState('');
  const [jobName, setJobName] = useState('Research benchmark'); const [jobModel, setJobModel] = useState(''); const [prompt, setPrompt] = useState('Reply with a short sentence.');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const mounted = useRef(true); const working = useRef(false);
  async function refresh() {
    const results = await Promise.allSettled([operation({ operation: 'installed-models' }), operation({ operation: 'aliases' }), operation({ operation: 'jobs' }), operation({ operation: 'config' })]);
    if (!mounted.current) return;
    const [modelResult, aliasResult, jobResult, configResult] = results;
    if (modelResult.status === 'fulfilled') setModels(rows(modelResult.value, 'data').flatMap((item) => { const id = item.id ?? item.model_name; return typeof id === 'string' ? [{ id, ...(typeof item.recipe === 'string' ? { recipe: item.recipe } : {}), labels: Array.isArray(item.labels) ? item.labels.filter((label): label is string => typeof label === 'string') : [] }] : []; }));
    if (aliasResult.status === 'fulfilled') {
      const value = aliasResult.value;
      const aliases = record(value) && 'aliases' in value ? value.aliases : value;
      setAliases(Array.isArray(aliases) ? aliases.filter(record) : record(aliases) ? Object.entries(aliases).map(([alias, target]) => ({ alias, target })) : []);
    }
    if (jobResult.status === 'fulfilled') setJobs(rows(jobResult.value, 'jobs'));
    if (configResult.status === 'fulfilled' && record(configResult.value)) setConfig(record(configResult.value.saved) ? configResult.value.saved : configResult.value);
    if (results.some((result) => result.status === 'rejected')) setError('Some advanced settings could not be refreshed. Try again when Local AI is ready.');
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [resolvedClient]);
  async function run(value: Record<string, unknown>, success: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(value); if (mounted.current) { setNotice(success); await refresh(); } }
    catch { if (mounted.current) setError('The change could not be completed. Your draft is kept. Check the values and try again.'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  const modelOptions = <><option value="">Choose an installed model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</>;
  return <section className="model-setup-panel" aria-label="Advanced model controls" aria-busy={busy}>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void refresh()}>Refresh advanced settings</Button>
    <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3"><h3 className="settings-block-heading"><HugeiconsIcon icon={Share02Icon} size={18} aria-hidden="true" />Model groups and routing</h3><Separator /><p>A model group combines several models behind one name, or routes each request to the model that fits it. These group models, not your documents. Collections of documents are configured under Knowledge.</p>
      <LocalAiCollections models={models} operation={async (value) => (await resolvedClient.json<{ result: unknown }>('/api/v1/local-ai/collections/operations', { method: 'POST', body: JSON.stringify(value) })).result} onSaved={() => { void refresh(); window.dispatchEvent(new Event('office-models-changed')); }} />
      <h4 className="settings-subheading">Aliases</h4><ul className="model-job-list">{aliases.map((item) => { const name = String(item.alias ?? item.name ?? ''); return <Card key={name} render={(props) => {
        const { ref, ...rest } = props;
        return <li {...(rest as React.LiHTMLAttributes<HTMLLIElement>)} />;
      }}><strong>{name}</strong><span>{String(item.target ?? item.model_name ?? item.model ?? '')}</span><div className="team-actions"><Button variant="secondary" size="sm" onPress={() => { setAlias(name); setTarget(String(item.target ?? item.model_name ?? item.model ?? '')); }}>Edit</Button><Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run({ operation: 'remove-alias', alias: name }, 'Alias removed.')}>Remove</Button></div></Card>; })}</ul>
      <form className="model-connection-editor" onSubmit={(event) => { event.preventDefault(); void run({ operation: 'add-alias', input: { alias: alias.trim(), model_name: target } }, 'Alias saved.'); }}><label>Alias<Input required value={alias} onChange={(event) => setAlias(event.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" /></label><label>Target model<SelectField aria-label="Target model" value={target} onValueChange={setTarget}>{target && !models.some((model) => model.id === target) && <option value={target}>{target} (unavailable)</option>}{modelOptions}</SelectField></label><Button type="submit" variant="secondary" size="sm" isDisabled={busy || !target || !alias.trim()}>Save alias</Button></form>
    </Card>
    <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3"><h3 className="settings-block-heading"><HugeiconsIcon icon={Loading01Icon} size={18} aria-hidden="true" />Operation jobs and benchmarks</h3><Separator /><p>A benchmark loads the selected model, requests a short response, then unloads it. Existing work can be paused or interrupted.</p>
      <form className="model-connection-editor" onSubmit={(event) => { event.preventDefault(); void run({ operation: 'create-job', input: { name: jobName, definition: { steps: [{ id: 'load', op: 'load', params: { model: jobModel } }, { id: 'sample', op: 'chat', params: { model: jobModel, messages: [{ role: 'user', content: prompt }], max_tokens: 64 } }, { id: 'unload', op: 'unload', params: { model: jobModel } }] }, inputs: {} } }, 'Benchmark submitted.'); }}><label>Job name<Input required value={jobName} onChange={(event) => setJobName(event.target.value)} /></label><label>Benchmark model<SelectField aria-label="Benchmark model" value={jobModel} onValueChange={setJobModel}>{modelOptions}</SelectField></label><label>Test prompt<TextArea required value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label><Button type="submit" variant="secondary" size="sm" isDisabled={busy || !jobModel}>Start benchmark</Button></form>
      <ul className="model-job-list">{jobs.map((job) => { const id = String(job.id ?? ''); const state = String(job.status ?? 'unknown'); const active = state === 'running' || state === 'queued'; const context = record(job.context) ? job.context : {}; const summary = Object.entries(context).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 8); return <Card key={id} render={(props) => {
        const { ref, ...rest } = props;
        return <li {...(rest as React.LiHTMLAttributes<HTMLLIElement>)} />;
      }}><strong>{String(job.name ?? id)}</strong><span>{state}</span><div className="team-actions">{(active ? ['pause', 'interrupt'] as const : state === 'paused' || state === 'interrupted' ? ['resume'] as const : []).map((action) => <Button key={action} variant="secondary" size="sm" isDisabled={busy} onPress={() => void run({ operation: 'job-control', id, action }, 'Job action requested.')}>{action === 'pause' ? 'Pause' : action === 'interrupt' ? 'Interrupt' : 'Resume'}</Button>)}{!active && state !== 'unknown' && <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run({ operation: 'delete-job', id }, 'Job removed.')}>Remove job</Button>}</div>{summary.length > 0 && <dl className="model-option-summary" aria-label={`Results for ${String(job.name ?? id)}`}>{summary.map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl>}</Card>; })}</ul>
    </Card>
    <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3"><h3 className="settings-block-heading"><HugeiconsIcon icon={Settings01Icon} size={18} aria-hidden="true" />Configuration</h3><Separator /><p>These are saved settings. Reload models after changing load options. Restart Local AI if a changed server setting requires it.</p><div className="model-option-fields">{fields.map((field) => { const value = configDraft[field.key] ?? config[field.key]; return <form key={field.key} className="model-connection-editor" onSubmit={(event) => { event.preventDefault(); void run({ operation: 'set-config', input: { key: field.key, value } }, 'Configuration saved.'); }}><label>{field.label}{field.type === 'boolean' ? <SelectField aria-label={field.label} value={typeof value === 'boolean' ? String(value) : ''} onValueChange={(next) => setConfigDraft((current) => ({ ...current, [field.key]: next === 'true' }))}><option value="" disabled>Not reported</option><option value="true">On</option><option value="false">Off</option></SelectField> : field.type === 'enum' ? <SelectField aria-label={field.label} value={typeof value === 'string' ? value : ''} onValueChange={(next) => setConfigDraft((current) => ({ ...current, [field.key]: next }))}><option value="" disabled>Not reported</option>{['trace', 'debug', 'info', 'warning', 'error', 'fatal', 'none'].map((level) => <option key={level}>{level}</option>)}</SelectField> : <Input type="number" step={field.key === 'auto_evict_threshold_pct' ? '0.01' : '1'} min={field.min} value={typeof value === 'number' ? value : ''} onChange={(event) => setConfigDraft((current) => ({ ...current, [field.key]: event.target.valueAsNumber }))} required />}</label><Button type="submit" variant="secondary" size="sm" isDisabled={busy || value === undefined}>Save</Button></form>; })}</div></Card>
    <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3"><h3 className="settings-block-heading"><HugeiconsIcon icon={Wrench01Icon} size={18} aria-hidden="true" />Maintenance</h3><Separator /><p>Synchronizing updates model definitions. Cache cleanup may remove unused downloaded cache files. Imported model files remain in their original folder.</p><Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run({ operation: 'sync-models' }, 'Model definitions synchronized.')}>Sync model definitions</Button><p>Cache cleanup is unavailable because shared-file ownership cannot be verified. Use model deletion to remove files from private storage.</p><LocalAiRuntimeUpdate /></Card>
  </section>;
}
