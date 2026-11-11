import type { WorkspaceNode } from '@office/workspace/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CRAFT_PACKAGE_MAX_BYTES, parseCraftPackage, SHIPPED_COMPOSITION_CRAFT_IDS, type CraftBindings, type CraftCommand, type CraftPackage, type CraftRecord, type CraftResource, type CraftResourceKind, type CraftSnapshot } from '@office/methods/domain';
import { createServiceClient } from '../shared/service-client.hook';
import { useModelVisibility, visibleModelChoices } from '../models/model-visibility.hook';
import { SelectField } from '../shared/select-field.component';
import { Button, Card, Checkbox, Fieldset, Input, TextArea, Separator, Switch } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { CodeIcon } from '@hugeicons/core-free-icons';
import { firstSentence, standardPresentation } from '../app/standard-presentation.catalog';

type CraftDraft = { name: string; craftId: string; description: string; methodIds: string[]; automationIds: string[]; knowledgeIds: string[] };
const draftKey = () => `office.craft-draft:${localStorage.getItem('office.development.demo') === 'on' ? 'demo' : 'personal'}`;
function readDraft(): CraftDraft | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey()) ?? 'null');
    const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string');
    if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || !('craftId' in value) || typeof value.craftId !== 'string' || !('description' in value) || typeof value.description !== 'string' || !('methodIds' in value) || !strings(value.methodIds) || !('automationIds' in value) || !strings(value.automationIds) || !('knowledgeIds' in value) || !strings(value.knowledgeIds)) return undefined;
    return { name: value.name, craftId: value.craftId, description: value.description, methodIds: value.methodIds, automationIds: value.automationIds, knowledgeIds: value.knowledgeIds };
  } catch { return undefined; }
}

type Review = { kind: 'install' | 'enable'; package: CraftPackage; bindings: CraftBindings };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(url); }
}

function isShippedCraft(craft: CraftPackage): boolean {
  return craft.runtime === 'gyroscopic-reasoning' || craft.runtime === 'human-mark' || SHIPPED_COMPOSITION_CRAFT_IDS.has(craft.id);
}

function bindingLabel(kind: CraftResourceKind): string {
  if (kind === 'model') return 'Model';
  if (kind === 'embedding') return 'Memory index';
  if (kind === 'knowledge') return 'Knowledge';
  if (kind === 'tool') return 'Tool';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'calendar') return 'Calendar';
  return 'Conversation';
}

function recordAbout(record: CraftRecord): string {
  return standardPresentation(record.package.id)?.about ?? firstSentence(record.package.description);
}

function bindingPlaceholder(kind: CraftResourceKind): string {
  if (kind === 'model') return 'Choose a model';
  if (kind === 'embedding') return 'Choose a memory index';
  if (kind === 'knowledge') return 'Choose a Knowledge collection';
  if (kind === 'tool') return 'Choose a tool';
  if (kind === 'mcp') return 'Choose an MCP connection';
  if (kind === 'calendar') return 'Choose a calendar';
  return 'Choose a conversation';
}

function defaultBindings(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): CraftBindings {
  const selected: CraftBindings = {};
  for (const requirement of craft.requirements) {
    const candidate = bindings[requirement.key] ?? requirement.suggested;
    if (candidate && (bindings[requirement.key] === candidate || resources.some(item => item.kind === requirement.kind && item.id === candidate && item.available))) {
      selected[requirement.key] = candidate;
    }
  }
  return selected;
}

function requiredBindingsReady(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): boolean {
  return craft.requirements.every((requirement) => {
    if (requirement.optional) return true;
    const id = bindings[requirement.key];
    return Boolean(id && resources.some((item) => item.kind === requirement.kind && item.id === id && item.available));
  });
}

function needsMutateConfirmation(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): boolean {
  return craft.automations.some((item) => item.steps.some((step) => {
    if (step.kind !== 'tool') return false;
    const requirement = craft.requirements.find((value) => `@craft:${value.key}` === step.toolId);
    return Boolean(requirement && resources.some((resource) => resource.kind === 'tool' && resource.id === bindings[requirement.key] && resource.effect === 'mutate'));
  }));
}

export function CraftSettings({ onOpenKnowledge, onChanged, scopeId, startWithCreate = false }: { scopeId?: string; startWithCreate?: boolean; onOpenKnowledge?: () => void; onChanged?: () => Promise<void> }) {
  const client = useMemo(() => createServiceClient(), []);
  const visibility = useModelVisibility();
  const [snapshot, setSnapshot] = useState<CraftSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [creating, setCreating] = useState(startWithCreate);
  const [showContents, setShowContents] = useState(false);
  const [draft] = useState(readDraft);
  const [name, setName] = useState(draft?.name ?? '');
  const [craftId, setCraftId] = useState(draft?.craftId ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [methodIds, setMethodIds] = useState<string[]>(draft?.methodIds ?? []);
  const [automationIds, setAutomationIds] = useState<string[]>(draft?.automationIds ?? []);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>(draft?.knowledgeIds ?? []);
  useEffect(() => { if (startWithCreate) setCreating(true); }, [startWithCreate]);
  useEffect(() => {
    if (!name && !description && !methodIds.length && !automationIds.length && !knowledgeIds.length) return;
    localStorage.setItem(draftKey(), JSON.stringify({ name, craftId, description, methodIds, automationIds, knowledgeIds }));
  }, [name, craftId, description, methodIds, automationIds, knowledgeIds]);
  useEffect(() => {
    if (!startWithCreate || !scopeId || draft) return;
    const controller = new AbortController();
    void Promise.all([
      client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes', { signal: controller.signal }),
      client.json<{ collectionId: string }>(`/api/v1/workspace/scopes/${encodeURIComponent(scopeId)}/knowledge`, { method: 'POST', body: '{}', signal: controller.signal }),
    ]).then(([{ nodes }, { collectionId }]) => {
      if (controller.signal.aborted) return;
      const project = nodes.find(node => node.id === scopeId);
      if (!project) return;
      setName(current => current || project.name);
      setCraftId(current => current || project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80));
      setKnowledgeIds(current => [...new Set([...current, collectionId])]);
      setRefresh(value => value + 1);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The project could not be prepared.'); });
    return () => controller.abort();
  }, [client, startWithCreate, scopeId, draft]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    client.json<CraftSnapshot>('/api/v1/crafts', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setSnapshot(data); setError(''); }
    }).catch(() => { if (!controller.signal.aborted) setError('Unavailable. Please retry.'); });
    return () => controller.abort();
  }, [client, refresh]);

  function showReview(craft: CraftPackage, kind: Review['kind'], bindings: CraftBindings = {}) {
    setReview({ kind, package: craft, bindings: defaultBindings(craft, bindings, snapshot?.resources ?? []) });
    setConfirmed(false);
    setShowContents(false);
    setError('');
    setNotice('');
  }

  async function command(value: CraftCommand) {
    setPending(true); setError(''); setNotice('');
    try {
      const response = await client.json<{ result: unknown; snapshot: CraftSnapshot }>('/api/v1/crafts', { method: 'POST', body: JSON.stringify(value) });
      setSnapshot(response.snapshot);
      if (value.action === 'install' && value.package.id === craftId) { localStorage.removeItem(draftKey()); setName(''); setCraftId(''); setDescription(''); setMethodIds([]); setAutomationIds([]); setKnowledgeIds([]); }
      if (value.action === 'configure' || value.action === 'install') await onChanged?.();
      if (value.action === 'configure' || value.action === 'install' || value.action === 'remove') window.dispatchEvent(new Event('air-office:crafts-changed'));
      if (value.action === 'compose') { showReview(parseCraftPackage(JSON.stringify(response.result)), 'install'); setCreating(false); }
      else { setReview(null); setNotice(value.action === 'install' ? 'Installed.' : value.action === 'remove' ? 'Removed.' : value.action === 'configure' && value.enabled ? 'Enabled.' : 'Disabled.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update.'); }
    finally { setPending(false); }
  }

  async function requestEnable(record: CraftRecord) {
    if (!snapshot) return;
    const bindings = defaultBindings(record.package, record.bindings, snapshot.resources);
    const ready = requiredBindingsReady(record.package, bindings, snapshot.resources);
    const confirm = needsMutateConfirmation(record.package, bindings, snapshot.resources);
    if (ready && !confirm) {
      await command({ action: 'configure', id: record.package.id, enabled: true, bindings, confirmed: false });
      return;
    }
    showReview(record.package, 'enable', bindings);
  }

  async function importPackage(file: File) {
    setPending(true); setError('');
    try {
      if (file.size > CRAFT_PACKAGE_MAX_BYTES) throw new Error('This package exceeds the size limit.');
      showReview(parseCraftPackage(await file.text()), 'install');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not import.'); }
    finally { setPending(false); }
  }

  async function exportPackage(record: CraftRecord) {
    setPending(true); setError('');
    try {
      const response = await client.json<{ result: unknown }>('/api/v1/crafts', { method: 'POST', body: JSON.stringify({ action: 'export', id: record.package.id }) });
      const portable = parseCraftPackage(JSON.stringify(response.result));
      download(new Blob([JSON.stringify(portable, null, 2)], { type: 'application/json' }), `${portable.id}.craft.json`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export.'); }
    finally { setPending(false); }
  }

  async function exportDataset() {
    setPending(true); setError('');
    try {
      const response = await client.request('/api/v1/reasoning/dataset');
      if (!response.ok) throw new Error('Could not export the dataset.');
      download(await response.blob(), 'air-office-exchanges.jsonl');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export the dataset.'); }
    finally { setPending(false); }
  }

  function select(ids: string[], id: string, checked: boolean): string[] { return checked ? [...ids, id] : ids.filter(value => value !== id); }
  function resourceOptions(kind: CraftResourceKind, selectedId: string): CraftResource[] {
    const resources = snapshot?.resources.filter(item => item.kind === kind) ?? [];
    if (kind !== 'model') return resources;
    const choices = resources.map(resource => ({ key: resource.model ? `${resource.model.providerId}:${resource.model.modelId}` : resource.id, label: resource.label, resource }));
    return visibleModelChoices(choices, visibility, choices.find(choice => choice.resource.id === selectedId)?.key).map(choice => choice.resource);
  }
  const reviewRequirements = review?.package.requirements.filter((requirement) => !requirement.optional || Boolean(review.bindings[requirement.key])) ?? [];
  const needsConfirmation = review?.kind === 'enable' && needsMutateConfirmation(review.package, review.bindings, snapshot?.resources ?? []);
  const missing = review ? !requiredBindingsReady(review.package, review.bindings, snapshot?.resources ?? []) : false;

  return <section className="alignment-crafts craft-settings settings-group" aria-label="Crafts">
    <div className="research-workspace-section-heading">
      <div className="craft-actions">
        <Button size="sm" isDisabled={!snapshot || pending} onPress={() => { setCreating(value => !value); setReview(null); }}>{name ? 'Resume' : 'Create'}</Button>
        <Button variant="secondary" size="sm" isDisabled={!snapshot || pending} onPress={() => fileInput.current?.click()}>Import</Button>
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Import package" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPackage(file); }}/>
    </div>
    {error && <p role="alert">{error} <Button variant="ghost" size="sm" isDisabled={pending} onPress={() => setRefresh(value => value + 1)}>Refresh</Button></p>}
    {notice && <p role="status">{notice}</p>}
    {!snapshot && !error && <p role="status">Loading…</p>}

    {creating && snapshot && <form className="alignment-craft-import alignment-craft-form" onSubmit={event => { event.preventDefault(); void command({ action: 'compose', id: craftId, name, description, methodIds, automationIds, knowledgeIds }); }}>
      <h3>Create</h3>
      <label>Name<Input required maxLength={120} value={name} onChange={event => { const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); if (!craftId || craftId === slug(name)) setCraftId(slug(event.target.value)); setName(event.target.value); }}/></label>
      <label>Package ID<Input required pattern="[a-z0-9][a-z0-9.-]{0,79}" maxLength={80} value={craftId} onChange={event => setCraftId(event.target.value)} placeholder="my-package"/></label>
      <label>What does it do?<TextArea required maxLength={1000} rows={2} value={description} onChange={event => setDescription(event.target.value)}/></label>
      <Fieldset><Fieldset.Legend>Agents, prompts and skills</Fieldset.Legend><div className="alignment-craft-choices">{snapshot.methods.map(item => <Checkbox key={item.id} isSelected={methodIds.includes(item.id)} onChange={checked => setMethodIds(select(methodIds, item.id, checked))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{item.name} <small>{item.kind === 'preset' ? 'Agent' : item.kind}</small></span></Checkbox.Content></Checkbox>)}</div>{!snapshot.methods.length && <p>Create a method in Agents, Prompts or Skills first.</p>}</Fieldset>
      <Fieldset><Fieldset.Legend>Knowledge</Fieldset.Legend><div className="alignment-craft-choices">{snapshot.resources.filter(item => item.kind === 'knowledge').map(item => <Checkbox key={item.id} isSelected={knowledgeIds.includes(item.id)} onChange={checked => setKnowledgeIds(select(knowledgeIds, item.id, checked))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{item.label}</Checkbox.Content></Checkbox>)}</div></Fieldset>
      <Fieldset><Fieldset.Legend>Actions</Fieldset.Legend><div className="alignment-craft-choices">{snapshot.automations.map(item => <Checkbox key={item.id} isSelected={automationIds.includes(item.id)} onChange={checked => setAutomationIds(select(automationIds, item.id, checked))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{item.name}</Checkbox.Content></Checkbox>)}</div>{!snapshot.automations.length && <p>No automations to include.</p>}</Fieldset>
      <div className="craft-actions"><Button type="submit" size="sm" isDisabled={pending || (!methodIds.length && !automationIds.length && !knowledgeIds.length)}>Review package</Button><Button variant="secondary" size="sm" onPress={() => setCreating(false)}>Cancel</Button></div>
    </form>}

    {review && snapshot && <section className="alignment-craft-import alignment-craft-form" aria-label={review.kind === 'install' ? 'Install package' : 'Enable'}>
      <h3>{review.kind === 'install' ? `Install ${review.package.name}` : `Enable ${review.package.name}`}</h3>
      <p>{standardPresentation(review.package.id)?.about ?? review.package.description}</p>
      {review.kind === 'enable' && reviewRequirements.length > 0 && (
        <p className="method-hint">Choose resources to use while this is enabled.</p>
      )}
      {reviewRequirements.map(requirement => <div className="alignment-craft-binding" key={requirement.key}>
        <label htmlFor={`craft-binding-${requirement.key}`}>{bindingLabel(requirement.kind)}</label>
        <SelectField id={`craft-binding-${requirement.key}`} value={review.bindings[requirement.key] ?? ''} disabled={pending} onValueChange={value => setReview({ ...review, bindings: { ...review.bindings, [requirement.key]: value } })}>
          <option value="">{bindingPlaceholder(requirement.kind)}</option>
          {review.bindings[requirement.key] && !snapshot.resources.some(item => item.kind === requirement.kind && item.id === review.bindings[requirement.key]) && <option value={review.bindings[requirement.key]} disabled>Previously selected · Unavailable</option>}
          {resourceOptions(requirement.kind, review.bindings[requirement.key] ?? '').map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · Unavailable'}</option>)}
        </SelectField>
      </div>)}
      {review.kind === 'install' && <>
        <Button variant="ghost" size="sm" aria-expanded={showContents} onPress={() => setShowContents(value => !value)}>{showContents ? 'Hide JSON' : 'View JSON'}</Button>
        {showContents && <pre className="alignment-craft-json">{JSON.stringify(review.package, null, 2)}</pre>}
      </>}
      {needsConfirmation && <Checkbox className="alignment-craft-confirm" isSelected={confirmed} onChange={setConfirmed}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Allow the included automations to run their tool steps, including steps that change data.</Checkbox.Content></Checkbox>}
      <div className="craft-actions">
        <Button
          size="sm"
          isDisabled={pending || (review.kind === 'enable' && (missing || (needsConfirmation && !confirmed)))}
          onPress={() => void command(review.kind === 'install' ? { action: 'install', package: review.package, bindings: review.bindings } : { action: 'configure', id: review.package.id, enabled: true, bindings: review.bindings, confirmed })}
        >
          {review.kind === 'install' ? 'Install' : 'Enable'}
        </Button>
        <Button variant="secondary" size="sm" isDisabled={pending} onPress={() => setReview(null)}>Cancel</Button>
      </div>
    </section>}

    <div className="alignment-craft-list">{snapshot?.crafts.map(record => <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <article {...props} />} key={record.package.id}>
      <Card.Header className="alignment-craft-heading">
        <div className="alignment-craft-title-row">
          <h3 className="settings-block-heading"><HugeiconsIcon icon={CodeIcon} size={18} aria-hidden="true" />{record.package.name}</h3>
          <Switch
            isSelected={record.enabled}
            isDisabled={pending}
            onChange={(enabled) => {
              if (!enabled) void command({ action: 'configure', id: record.package.id, enabled: false, bindings: record.bindings, confirmed: false });
              else void requestEnable(record);
            }}
          >
            <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control><span className="sr-only">Turn {record.package.name} {record.enabled ? 'off' : 'on'}</span></Switch.Content>
          </Switch>
        </div>
        <p className="alignment-craft-about">{recordAbout(record)}</p>
      </Card.Header>
      <Separator />
      {record.enabled && record.package.requirements.some((requirement) => !requirement.optional) && (
        <p className="method-hint">
          {record.package.requirements.filter((requirement) => !requirement.optional).map((requirement) => {
            const resource = snapshot.resources.find((item) => item.kind === requirement.kind && item.id === record.bindings[requirement.key]);
            return `${bindingLabel(requirement.kind)}: ${resource?.label ?? 'Not set'}`;
          }).join(' · ')}
        </p>
      )}
      <Card.Footer className="craft-actions justify-end">
        <Button variant="secondary" size="sm" isDisabled={pending} onPress={() => void exportPackage(record)}>Export</Button>
        {record.package.runtime === 'gyroscopic-reasoning' && <><Button variant="secondary" size="sm" isDisabled={pending} onPress={() => void exportDataset()}>Export dataset</Button>{onOpenKnowledge && <Button variant="secondary" size="sm" onPress={onOpenKnowledge}>Memory index</Button>}</>}
        {record.package.runtime === 'composition' && !record.enabled && !isShippedCraft(record.package) && (
          <Button variant="ghost" size="sm" isDisabled={pending} onPress={() => void command({ action: 'remove', id: record.package.id })}>Remove</Button>
        )}
      </Card.Footer>
    </Card>)}</div>
  </section>;
}
