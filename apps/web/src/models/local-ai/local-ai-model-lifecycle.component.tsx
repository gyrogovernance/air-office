import { useEffect, useRef, useState } from 'react';
import { Button, Input, TextArea, Card, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { RefreshIcon } from '@hugeicons/core-free-icons';
import { SelectField } from '../../shared/select-field.component';
import type { ServiceClient } from '../../shared/service-client.hook';

type Model = { id: string; update_available?: boolean };
type Options = { saved: Record<string, unknown>; effective: Record<string, unknown>; defaults: Record<string, unknown> };
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function optionValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !/secret|token|password|path|checkpoint|api.?key/i.test(key) && (item === null || typeof item === 'number' || typeof item === 'boolean' || typeof item === 'string' && !/[\\/]/.test(item))));
}
async function operation<T>(client: ServiceClient, value: Record<string, unknown>): Promise<T> {
  return (await client.json<{ result: T }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify(value) })).result;
}

/** Pinning applies to the running model; the two explicit actions also work when residency is unknown. */
export function LocalAiModelActions({ model, client, disabled = false, onChanged, onOptions }: { model: string; client: ServiceClient; disabled?: boolean; onChanged: () => Promise<void>; onOptions: () => void }) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [failed, setFailed] = useState(false); const working = useRef(false);
  async function pin(pinned: boolean) {
    if (working.current) return;
    working.current = true; setBusy(true); setNotice(''); setFailed(false);
    try { await operation(client, { operation: 'pin', input: { model_name: model, pinned } }); setNotice(pinned ? 'Running model pinned against automatic eviction.' : 'Running model unpinned.'); await onChanged(); }
    catch { setFailed(true); setNotice('Pin state could not be changed. Load the model and try again.'); }
    finally { working.current = false; setBusy(false); }
  }
  return <div aria-label={`Additional actions for ${model}`}><div className="team-actions"><Button variant="tertiary" size="sm" isDisabled={disabled || busy} onPress={() => void pin(true)}>Pin</Button><Button variant="tertiary" size="sm" isDisabled={disabled || busy} onPress={() => void pin(false)}>Unpin</Button><Button variant="secondary" size="sm" isDisabled={disabled || busy} onPress={onOptions}>Model options</Button></div>{notice && <p role={failed ? 'alert' : 'status'}>{notice}</p>}</div>;
}

export function LocalAiModelOptions({ client, initialModel = '' }: { client: ServiceClient; initialModel?: string }) {
  const [models, setModels] = useState<Model[]>([]); const [model, setModel] = useState(initialModel);
  const [options, setOptions] = useState<Options | null>(null); const [draft, setDraft] = useState('{}');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const working = useRef(false); const epoch = useRef(0);
  useEffect(() => { let alive = true; void operation<unknown>(client, { operation: 'installed-models' }).then((result) => {
    const rows = Array.isArray(result) ? result : record(result) && Array.isArray(result.data) ? result.data : [];
    if (alive) setModels(rows.flatMap((item: unknown) => { if (!record(item)) return []; const id = item.id ?? item.name ?? item.model_name; return typeof id === 'string' ? [{ id, update_available: item.update_available === true }] : []; }));
  }).catch(() => { if (alive) setError('Installed models could not be loaded.'); }); return () => { alive = false; epoch.current++; }; }, [client]);
  useEffect(() => { setModel(initialModel); setOptions(null); setDraft('{}'); epoch.current++; }, [initialModel]);
  function apply(value: unknown) {
    if (!record(value) || !record(value.saved) || !record(value.effective) || !record(value.defaults)) throw new Error('incomplete-options');
    const next = { saved: optionValues(value.saved), effective: optionValues(value.effective), defaults: optionValues(value.defaults) };
    setOptions(next); setDraft(JSON.stringify(next.saved, null, 2));
  }
  async function run(action: () => Promise<void>, success: string) {
    if (working.current) return; working.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); setNotice(success); } catch { setError('The model request could not be completed. Check the selected model and option values, then try again.'); }
    finally { working.current = false; setBusy(false); }
  }
  async function load() { const current = epoch.current; const result = await operation(client, { operation: 'model-options', model }); if (current === epoch.current) apply(result); }
  function changeModel(value: string) { epoch.current++; setModel(value); setOptions(null); setDraft('{}'); setError(''); setNotice(''); }
  return <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3" aria-label="Per-model saved and effective options" aria-busy={busy}>
    <h2>Model options</h2><Separator /><p>Saved overrides apply to future loads. Effective values combine those overrides with inherited defaults; a running model may need to be unloaded and loaded again. Pinning controls automatic eviction of a running model.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <label className="app-dialog-field">Installed model<SelectField disabled={busy} value={model} onValueChange={changeModel}><option value="">Select a model</option>{model && !models.some((item) => item.id === model) && <option value={model}>{model}</option>}{models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</SelectField></label>
    <Button variant="secondary" size="sm" isDisabled={busy || !model} onPress={() => void run(load, 'Saved, effective and default options loaded.')}>Load model options</Button>
    {options && <><h3 className="settings-subheading">Saved overrides</h3><p>Use null to remove an override and inherit its default. Only the displayed ordinary option fields can be saved here.</p><form className="model-connection-editor" onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const parsed: unknown = JSON.parse(draft);
      if (!record(parsed) || Object.entries(parsed).some(([key, value]) => !Object.hasOwn(options.effective, key) && !Object.hasOwn(options.saved, key) || key === 'model_name' || key === 'pinned' || value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || JSON.stringify(optionValues(parsed)) !== JSON.stringify(parsed)) throw new Error('invalid-options');
      await operation(client, { operation: 'save-model-options', model, options: parsed }); await load();
    }, 'Model overrides saved. Reload a running model to apply changed load options.'); }}><div className="model-option-fields">{Object.entries(options.effective).filter(([key]) => key !== 'model_name' && key !== 'pinned').map(([key, effective]) => {
      let saved: Record<string, unknown>; try { const value: unknown = JSON.parse(draft); saved = record(value) ? value : {}; } catch { return null; }
      const value = saved[key]; const inherited = value === undefined || value === null; const kind = typeof (effective ?? options.defaults[key]);
      return <label key={key}>{key.replaceAll('_', ' ')}<span className="method-hint">Current: {String(effective ?? 'Not reported')}{inherited ? ' · Inherited' : ' · Override'}</span>{kind === 'boolean' ? <SelectField disabled={busy} value={inherited ? '' : String(value)} onValueChange={(next) => setDraft(JSON.stringify({ ...saved, [key]: next === '' ? null : next === 'true' }, null, 2))}><option value="">Inherit</option><option value="true">On</option><option value="false">Off</option></SelectField> : <Input disabled={busy} type={kind === 'number' ? 'number' : 'text'} step="any" placeholder={`Inherit: ${String(options.defaults[key] ?? effective ?? '')}`} value={inherited ? '' : String(value)} onChange={(event) => { const text = event.target.value; setDraft(JSON.stringify({ ...saved, [key]: text === '' ? null : kind === 'number' ? Number(text) : text }, null, 2)); }} />}</label>;
    })}</div><section><h4>Advanced option fields</h4><label className="app-dialog-field">Saved overrides JSON<TextArea rows={8} disabled={busy} value={draft} onChange={(event) => setDraft(event.target.value)} /></label></section><div className="team-actions"><Button type="submit" variant="secondary" size="sm" isDisabled={busy}>Save model overrides</Button><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(async () => { await operation(client, { operation: 'reset-model-options', model }); await load(); }, 'Saved overrides cleared. Default inheritance restored.')}>Reset to inherited defaults</Button></div></form>
      <section><h4>Effective values for the next load</h4><dl className="model-option-summary">{Object.entries(options.effective).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value ?? 'Not reported')}</dd></div>)}</dl></section><section><h4>Inherited defaults</h4><dl className="model-option-summary">{Object.entries(options.defaults).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value ?? 'Not reported')}</dd></div>)}</dl></section></>}
  </Card>;
}

export function LocalAiModelUpdates({ client, onChanged }: { client: ServiceClient; onChanged: () => Promise<void> }) {
  const [models, setModels] = useState<string[] | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const working = useRef(false);
  async function run(action: () => Promise<void>) { if (working.current) return; working.current = true; setBusy(true); setError(''); setNotice(''); try { await action(); } catch { setError('The model update request could not be completed. Try again when the runtime is ready.'); } finally { working.current = false; setBusy(false); } }
  return <Card render={(props) => <section {...props} />} variant="secondary" className="rounded-2xl p-3 gap-3" aria-label="Model file updates"><h3 className="settings-block-heading"><HugeiconsIcon icon={RefreshIcon} size={18} aria-hidden="true" />Model file updates</h3><Separator /><p>Check the upstream registries for model file updates. Downloading an update is a separate action and may use substantial bandwidth.</p><Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run(async () => {
    const result = await operation<unknown>(client, { operation: 'check-updates' });
    if (!record(result) || !Array.isArray(result.models)) throw new Error('invalid-update-response');
    setModels(result.models.flatMap((item: unknown) => typeof item === 'string' ? [item] : record(item) && typeof item.model_name === 'string' ? [item.model_name] : []));
    setNotice(record(result.failed_models) && Object.keys(result.failed_models).length ? 'Some model checks failed. Try checking again.' : 'Model update check completed.');
  })}>Check model file updates</Button>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{models && (models.length ? <ul>{models.map((model) => <li key={model}>{model}<Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run(async () => { await operation(client, { operation: 'pull', input: { model_name: model, stream: true, subscribe: false } }); setNotice(`Update download requested for ${model}. Follow progress under Active downloads.`); await onChanged(); })}>Download update for {model}</Button></li>)}</ul> : <p>No model updates were returned.</p>)}</Card>;
}
