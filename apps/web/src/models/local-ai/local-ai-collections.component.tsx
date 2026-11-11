import { useId, useRef, useState } from 'react';
import { Button, Checkbox, Fieldset, Input, TextArea } from '@heroui/react';
import { SelectField } from '../../shared/select-field.component';
import { COLLECTION_ROUTER_PROMPT, parseCollectionDefinition, type CollectionDefinition, type CollectionOperation } from '@office/providers/lemonade-collections';

export interface CollectionModelChoice { id: string; label?: string; labels?: readonly string[]; recipe?: string; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
type RuleField = 'keywords_any' | 'regex' | 'min_chars' | 'max_chars' | 'min_total_chars' | 'max_total_chars' | 'has_images' | 'has_tools';
interface BuilderRule { id: string; field: RuleField; value: string; target: string; }
export async function collectionOperation(value: CollectionOperation): Promise<unknown> {
  const response = await fetch('/api/v1/local-ai/collections/operations', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? 'The collection operation failed.');
  return body.result;
}
const roles = ['llm', 'vision', 'image', 'edit', 'transcription', 'speech'] as const;
const roleLabels = { llm: 'Planner model', vision: 'Vision model', image: 'Image generation model', edit: 'Image editing model', transcription: 'Transcription model', speech: 'Speech model' };
const roleCapabilities: Record<typeof roles[number], string[]> = { llm: ['tool-calling'], vision: ['vision'], image: ['image'], edit: ['edit'], transcription: ['transcription', 'audio'], speech: ['tts', 'speech'] };
const signals: { id: RuleField; label: string }[] = [
  { id: 'keywords_any', label: 'Contains any keyword' }, { id: 'regex', label: 'Matches regular expression' },
  { id: 'min_chars', label: 'Minimum prompt bytes' }, { id: 'max_chars', label: 'Maximum prompt bytes' },
  { id: 'min_total_chars', label: 'Minimum conversation bytes' }, { id: 'max_total_chars', label: 'Maximum conversation bytes' },
  { id: 'has_images', label: 'Has images' }, { id: 'has_tools', label: 'Has tools' }
];
export function LocalAiCollections({ models, operation = collectionOperation, initialDefinition, onSaved, download = downloadDefinition }: {
  models: readonly CollectionModelChoice[];
  operation?: (value: CollectionOperation) => Promise<unknown>;
  initialDefinition?: CollectionDefinition;
  onSaved?: () => void;
  download?: (definition: CollectionDefinition) => void;
}) {
  const prefix = useId(); const sequence = useRef(0); const working = useRef(false);
  const [name, setName] = useState('user.MyCollection'); const [recipe, setRecipe] = useState<'collection.omni' | 'collection.router'>('collection.omni');
  const [selected, setSelected] = useState<Partial<Record<typeof roles[number], string>>>({});
  const [prompt, setPrompt] = useState(''); const [candidates, setCandidates] = useState<string[]>([]); const [fallback, setFallback] = useState('');
  const [mode, setMode] = useState<'llm' | 'rules'>('llm'); const [router, setRouter] = useState(''); const [routerPrompt, setRouterPrompt] = useState(COLLECTION_ROUTER_PROMPT);
  const [rules, setRules] = useState<BuilderRule[]>([]); const [imported, setImported] = useState<CollectionDefinition | null>(initialDefinition ?? null);
  const [exportModel, setExportModel] = useState(''); const [testPrompt, setTestPrompt] = useState(''); const [images, setImages] = useState(false); const [tools, setTools] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [result, setResult] = useState<unknown>(null);
  const concrete = models.filter((model) => !model.recipe?.startsWith('collection.'));
  function definition(): CollectionDefinition {
    if (imported) return parseCollectionDefinition(imported);
    if (recipe === 'collection.omni') {
      if (!selected.llm) throw new Error('Select a planner model.');
      return parseCollectionDefinition({ model_name: name, recipe, components: [...new Set(roles.map((role) => selected[role]).filter((value): value is string => Boolean(value)))], ...(prompt.trim() ? { system_prompt: prompt } : {}) });
    }
    const components = [...new Set([...candidates, ...(mode === 'llm' && router ? [router] : [])])];
    const routing = { candidates, default_model: fallback, ...(mode === 'llm' ? { router: { type: 'llm', model: router, prompt: routerPrompt } } : { rules: rules.map((rule) => ({ id: rule.id, route_to: rule.target, match: { [rule.field]: rule.field === 'keywords_any' ? rule.value.split(',').map((value) => value.trim()).filter(Boolean) : rule.field === 'has_images' || rule.field === 'has_tools' ? rule.value === 'true' : rule.field === 'regex' ? rule.value : rule.value.trim() ? Number(rule.value) : -1 } })) }) };
    return parseCollectionDefinition({ version: '1', model_name: name, recipe, components, routing });
  }
  async function run(action: () => Promise<unknown>, message: string) {
    if (working.current) return; working.current = true; setBusy(true); setError(''); setNotice(''); setResult(null);
    try { const value = await action(); setResult(value ?? null); setNotice(message); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The collection operation failed.'); } finally { working.current = false; setBusy(false); }
  }
  function modelSelect(label: string, value: string, change: (id: string) => void, options = concrete) {
    return <label>{label}<SelectField aria-label={label} value={value} disabled={busy} onValueChange={change}><option value="">Select a model</option>{value && !options.some((item) => item.id === value) && <option value={value}>{value} (unavailable)</option>}{options.map((model) => <option key={model.id} value={model.id}>{model.label ?? model.id}</option>)}</SelectField></label>;
  }
  function moveRule(index: number, direction: number) { setRules((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; }); }
  function updateRule(index: number, change: Partial<BuilderRule>) { setRules((current) => current.map((rule, i) => i === index ? { ...rule, ...change } : rule)); }
  const isRouter = imported ? imported.recipe === 'collection.router' : recipe === 'collection.router';
  return <section className="local-ai-collections" aria-label="Model group definitions" aria-busy={busy}>
    <h3>Model group definitions</h3><p>Save a definition to register it. Import and install also downloads missing component files through the runtime. Existing component registrations retain their definitions.</p>
    {error && <p role="alert">{error === 'The local model operation could not be completed.' ? 'Check the collection name, selected models, routing default, and prompt placeholders.' : error}</p>}{notice && <p role="status">{notice}</p>}
    <Fieldset disabled={busy}><Fieldset.Legend>Import a definition</Fieldset.Legend><label>Model group JSON file (maximum 512 KB)<input type="file" accept=".json,application/json" onChange={(event) => {
      const file = event.target.files?.[0]; if (!file) return;
      void run(async () => { if (file.size > 512 * 1024) throw new Error('Choose a model group file smaller than 512 KB.'); const value = parseCollectionDefinition(JSON.parse(await file.text())); setImported(value); return null; }, 'Definition loaded for review. Choose Import and install to apply it.');
    }} /></label></Fieldset>
    {imported ? <div className="collection-review"><h4>Review definition: {imported.model_name}</h4><p>{imported.recipe} · {imported.components.length} components</p><p>Imported conditions and embedded model definitions are preserved. Start a new definition to use the structured builder, or export this definition for backup.</p><dl className="model-option-summary"><div><dt>Name</dt><dd>{imported.model_name}</dd></div><div><dt>Recipe</dt><dd>{imported.recipe}</dd></div><div><dt>Components</dt><dd>{imported.components.join(', ') || 'None'}</dd></div></dl><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => { setImported(null); setError(''); setNotice(''); setResult(null); }}>Start a new definition</Button></div> : <Fieldset disabled={busy}><Fieldset.Legend>Build a model group</Fieldset.Legend>
      <label>Model group ID<Input value={name} onChange={(event) => setName(event.target.value)} aria-describedby={`${prefix}-identity`} /></label><p id={`${prefix}-identity`}>Use a stable user-prefixed ID, such as user.MyGroup. Model selections keep their original IDs.</p>
      <label>Model group type<SelectField aria-label="Model group type" value={recipe} disabled={busy} onValueChange={(value) => setRecipe(value as typeof recipe)}><option value="collection.omni">Omni group</option><option value="collection.router">Routing group</option></SelectField></label>
      {recipe === 'collection.omni' ? <>
        {roles.map((role) => <div key={role}>{modelSelect(roleLabels[role], selected[role] ?? '', (id) => setSelected((current) => ({ ...current, [role]: id })), concrete.filter((model) => role === 'llm' ? model.labels?.includes('tool-calling') : roleCapabilities[role].some((capability) => model.labels?.includes(capability))))}</div>)}
        <label>System prompt override<TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Leave empty to inherit the runtime default" /></label><p>Overrides require both {'{tool_list}'} and {'{tool_guidance}'} placeholders.</p><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => setPrompt('')}>Use default system prompt</Button>
      </> : <>
        <Fieldset><Fieldset.Legend>Candidate models</Fieldset.Legend>{concrete.map((model) => <Checkbox className="collection-checkbox" key={model.id} isSelected={candidates.includes(model.id)} onChange={(checked) => { setCandidates((current) => checked ? [...current, model.id] : current.filter((id) => id !== model.id)); if (!checked && fallback === model.id) setFallback(''); }}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{model.label ?? model.id}</Checkbox.Content></Checkbox>)}{!concrete.length && <p>No registered component models are available.</p>}</Fieldset>
        {modelSelect('Default model', fallback, setFallback, concrete.filter((model) => candidates.includes(model.id)))}<p>The default is used when no rule matches or model-backed routing fails open.</p>
        <label>Routing mode<SelectField aria-label="Routing mode" value={mode} disabled={busy} onValueChange={(value) => setMode(value as typeof mode)}><option value="llm">LLM routing</option><option value="rules">Ordered rules</option></SelectField></label>
        {mode === 'llm' ? <>{modelSelect('Router model', router, setRouter)}<label>Router prompt<TextArea value={routerPrompt} onChange={(event) => setRouterPrompt(event.target.value)} /></label><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => setRouterPrompt(COLLECTION_ROUTER_PROMPT)}>Reset router prompt</Button></> : <><p>Rules run from top to bottom. The first matching rule selects its target.</p>{rules.map((rule, index) => <Fieldset key={rule.id}><Fieldset.Legend>Rule {index + 1}</Fieldset.Legend><label>Condition<SelectField aria-label="Condition" value={rule.field} disabled={busy} onValueChange={(value) => updateRule(index, { field: value as RuleField, value: ['has_tools', 'has_images'].includes(value) ? 'true' : '' })}>{signals.map((signal) => <option key={signal.id} value={signal.id}>{signal.label}</option>)}</SelectField></label>{rule.field === 'has_images' || rule.field === 'has_tools' ? <label>Present<SelectField aria-label="Present" value={rule.value} disabled={busy} onValueChange={(value) => updateRule(index, { value })}><option value="true">Yes</option><option value="false">No</option></SelectField></label> : <label>{rule.field === 'keywords_any' ? 'Keywords, separated by commas' : 'Condition value'}<Input type={rule.field.includes('chars') ? 'number' : 'text'} min={0} step={1} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} /></label>}{modelSelect('Route to', rule.target, (target) => updateRule(index, { target }), concrete.filter((model) => candidates.includes(model.id)))}<div className="collection-actions"><Button variant="tertiary" size="sm" isDisabled={busy || index === 0} aria-label={`Move rule ${index + 1} up`} onPress={() => moveRule(index, -1)}>Move up</Button><Button variant="tertiary" size="sm" isDisabled={busy || index === rules.length - 1} aria-label={`Move rule ${index + 1} down`} onPress={() => moveRule(index, 1)}>Move down</Button><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => setRules((current) => current.filter((item) => item.id !== rule.id))}>Remove rule {index + 1}</Button></div></Fieldset>)}<Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => setRules((current) => [...current, { id: `rule-${++sequence.current}`, field: 'keywords_any', value: '', target: '' }])}>Add rule</Button></>}
      </>}
    </Fieldset>}
    <div className="collection-actions"><Button variant="tertiary" size="sm" isDisabled={busy || Boolean(imported?.models?.length)} onPress={() => void run(async () => { const value = await operation({ operation: 'save-collection', definition: definition() }); onSaved?.(); return value; }, 'Model group saved. Install missing models from Find models if needed.')}>Save definition</Button><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(async () => { const value = await operation({ operation: 'import-collection', definition: definition() }); onSaved?.(); return value; }, 'Import started. Follow progress under Downloads.')}>Import and install</Button><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(async () => { download(definition()); }, 'Definition exported.')}>Export draft</Button></div>
    {isRouter && <Fieldset disabled={busy}><Fieldset.Legend>Test routing</Fieldset.Legend><p>This test may load the router or classifier models and use them for one routing decision.</p><label>Test prompt<TextArea value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} /></label><Checkbox className="collection-checkbox" isSelected={images} onChange={setImages}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Has images</Checkbox.Content></Checkbox><Checkbox className="collection-checkbox" isSelected={tools} onChange={setTools}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Has tools</Checkbox.Content></Checkbox><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(() => operation({ operation: 'test-collection-routing', definition: definition(), prompt: testPrompt, has_images: images, has_tools: tools }), 'Routing test completed.')}>Test routing</Button></Fieldset>}
    <Fieldset disabled={busy}><Fieldset.Legend>Export a registered model group</Fieldset.Legend>{modelSelect('Registered model group', exportModel, setExportModel, models.filter((model) => model.recipe?.startsWith('collection.')))}<Button variant="tertiary" size="sm" isDisabled={busy || !exportModel} onPress={() => void run(async () => { const value = parseCollectionDefinition(await operation({ operation: 'export-collection', model: exportModel })); download(value); }, 'Model group and component definitions exported.')}>Export model group</Button></Fieldset>
    {busy && <p role="status">Working...</p>}{result !== null && <section><h4>Latest outcome</h4><dl className="model-option-summary">{Object.entries(record(result) ? result : { result }).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value) : Array.isArray(value) ? `${value.length} items` : 'Details available in the exported file'}</dd></div>)}</dl></section>}
  </section>;
}
function downloadDefinition(definition: CollectionDefinition) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${definition.model_name.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}