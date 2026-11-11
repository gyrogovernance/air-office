import { SelectField } from '../shared/select-field.component';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MethodDefinition, ModelPreset, SavedPrompt, ReusableSkill } from '@office/methods/domain';
import { validateDefinition } from '@office/methods/domain';
import type { MethodsWorkspaceState } from './methods-workspace.hook';
import type { ToolDefinition } from '@office/contracts/tool';
import { createServiceClient } from '../shared/service-client.hook';
import { useProviderCatalog } from '../models/providers-catalog.hook';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, AiChat02Icon, CodeIcon, Download01Icon, TextIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import { Avatar, Button, Card, Checkbox, Fieldset, Input, Modal, Separator, Tabs, TextArea } from '@heroui/react';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';

type Props = {
  methods: MethodsWorkspaceState;
  attachedIds: string[];
  onToggleAttach: (id: string) => void;
  collections: { id: string; name: string }[];
  kind?: MethodDefinition['kind'];
  onKindChange?: (kind: MethodDefinition['kind']) => void;
  embedded?: boolean;
  startWithCreate?: boolean;
};

const emptyPreset = (): ModelPreset => ({
  id: crypto.randomUUID(),
  name: 'New agent',
  model: '',
  instructions: 'Help me work through my request. Be clear and practical, state uncertainty, and ask for missing information when needed.',
  settings: { temperature: 0.7, maxOutputTokens: 2048 },
  knowledgeCollectionIds: [],
  skillIds: [],
  toolIds: [],
  updatedAt: new Date().toISOString(),
});
const emptyPrompt = (): SavedPrompt => ({ id: crypto.randomUUID(), name: '', instructions: '', variables: [], updatedAt: new Date().toISOString() });
const emptySkill = (): ReusableSkill => ({ id: crypto.randomUUID(), name: '', description: '', instructions: '', updatedAt: new Date().toISOString() });

function readVariables(instructions: string): string[] {
  return [...new Set([...instructions.matchAll(/\{\{([a-z][a-z0-9_]*)\}\}/g)].map((match) => match[1]!))];
}

function emptyDraft(kind: MethodDefinition['kind']): MethodDefinition {
  if (kind === 'prompt') return { kind: 'prompt', value: emptyPrompt() };
  if (kind === 'skill') return { kind: 'skill', value: emptySkill() };
  return { kind: 'preset', value: emptyPreset() };
}

/**
 * Reusable-assistant definitions: list, editor, history, and import/export.
 * Nested under Settings when embedded; otherwise keeps a standalone page chrome.
 */
export function MethodsWorkspace({ methods, attachedIds, onToggleAttach, collections, kind, onKindChange, embedded = false, startWithCreate = false }: Props) {
  const descriptionId = useId();
  const importInput = useRef<HTMLInputElement>(null);
  const [localTab, setLocalTab] = useState<MethodDefinition['kind']>(kind ?? 'preset');
  const tab = kind ?? localTab;
  const [draft, setDraft] = useState<MethodDefinition>(() => emptyDraft(tab));
  const [editorMode, setEditorMode] = useState<'closed' | 'create' | 'edit'>(startWithCreate ? 'create' : 'closed');
  const previousKind = useRef(kind);
  const [selectedId, setSelectedId] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const client = useMemo(() => createServiceClient(), []);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const providerCatalog = useProviderCatalog();

  useEffect(() => {
    if (kind === undefined || kind === previousKind.current) return;
    previousKind.current = kind;
    setDraft(emptyDraft(kind));
    setEditorMode('closed');
    setSelectedId('');
    setExpandedId('');
  }, [kind]);

  const grouped = methods.definitions.filter((definition) => definition.kind === tab);

  useEffect(() => {
    void client
      .json<{ definitions: ToolDefinition[] }>('/api/v1/tools')
      .then((result) => setTools(result.definitions))
      .catch(() => setTools([]));
  }, [client]);

  function setTab(next: MethodDefinition['kind']) {
    if (onKindChange) onKindChange(next);
    else setLocalTab(next);
  }

  function closeEditor() {
    setEditorMode('closed');
    setSelectedId('');
    setDraft(emptyDraft(tab));
    setExpandedId('');
  }

  function switchKind(next: MethodDefinition['kind']) {
    setTab(next);
    setDraft(emptyDraft(next));
    setEditorMode('closed');
    setSelectedId('');
    setExpandedId('');
  }

  function startNew() {
    const next = emptyDraft(tab);
    const provider =
      providerCatalog.providers.find((provider) => provider.id === providerCatalog.selectedProvider) ??
      providerCatalog.providers.find((provider) => provider.id !== 'local-replay' && provider.models.length);
    if (next.kind === 'preset' && provider?.models.length) {
      next.value.provider = provider.id;
      next.value.model = provider.models.find((model) => model === providerCatalog.selectedModel) ?? provider.models[0] ?? next.value.model;
    }
    if (next.kind === 'preset' && next.value.provider && next.value.model)
      next.value.modelReference = { providerId: next.value.provider, modelId: next.value.model, role: 'chat' };
    setDraft(next);
    setEditorMode('create');
    setSelectedId('');
    setExpandedId('');
  }

  function edit(definition: MethodDefinition) {
    setTab(definition.kind);
    setDraft(definition);
    setEditorMode('edit');
    setSelectedId(definition.value.id);
    setExpandedId('');
  }

  async function submit() {
    const value = draft.value;
    if (!value.name.trim()) return;
    const normalized: MethodDefinition =
      draft.kind === 'prompt' ? { kind: 'prompt', value: { ...draft.value, variables: readVariables(draft.value.instructions) } } : draft;
    const saved = await methods.save(normalized);
    if (saved) closeEditor();
  }

  async function downloadBundle() {
    const json = await methods.exportBundle();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'air-office-methods.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function uploadBundle(file: File) {
    const raw = await file.text();
    await methods.importBundle(raw);
  }

  const kindLabel = tab === 'preset' ? 'agent' : tab;

  return (
    <div className={embedded ? 'methods-panel' : 'methods-surface'}>
      {!embedded && (
        <>
          <h2>Agents, prompts, and skills</h2>
          <p>
            Define an agent with a model and instructions, a prompt with <code>{'{{variables}}'}</code>, or a reusable skill.
          </p>
          <Tabs
            selectedKey={tab}
            onSelectionChange={(key) => {
              if (key === 'preset' || key === 'prompt' || key === 'skill') switchKind(key);
            }}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Definition kind">
                <Tabs.Tab id="preset" className="whitespace-nowrap">
                  Agents
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="prompt" className="whitespace-nowrap">
                  Prompts
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="skill" className="whitespace-nowrap">
                  Skills
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </>
      )}

      <div className="methods-layout">
        <Card variant="secondary" className="methods-list-panel rounded-2xl p-3" render={(props) => <section {...props} />} aria-label={`${tab} definitions`}>
          <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={tab === 'preset' ? AiChat02Icon : tab === 'prompt' ? TextIcon : CodeIcon} size={18} aria-hidden="true" />{tab === 'preset' ? 'Agents' : tab === 'prompt' ? 'Prompts' : 'Skills'}</Card.Title></Card.Header><Separator />
          <div className="methods-list-toolbar">
            <Button variant="secondary" size="sm" isIconOnly aria-label={`New ${kindLabel}`} onPress={startNew}>
              <HugeiconsIcon icon={Add01Icon} size={16} />
            </Button>
          </div>
          {grouped.length === 0 ? (
            <p className="methods-empty">No {tab === 'preset' ? 'agents' : tab === 'prompt' ? 'prompts' : 'skills'} saved yet.</p>
          ) : (
            <ul className="methods-list">
              {grouped.map((definition) => {
                const selected = editorMode === 'edit' && selectedId === definition.value.id;
                const attached = attachedIds.includes(definition.value.id);
                const meta =
                  definition.kind === 'preset'
                    ? `${definition.value.model || 'No model set'}${definition.value.provider && definition.value.provider !== definition.value.model ? ` · ${definition.value.provider}` : ''}`
                    : definition.kind === 'prompt'
                      ? definition.value.variables.length
                        ? `Variables: ${definition.value.variables.join(', ')}`
                        : 'No variables'
                      : definition.value.description || 'No description';
                return (
                  <li key={definition.value.id}>
                    <div className={`methods-row${selected ? ' selected' : ''}${attached ? ' attached' : ''}`}>
                      <button type="button" className="methods-row-main" onClick={() => edit(definition)}>
                        <Avatar size="md" aria-hidden="true"><Avatar.Fallback><MarbleBeamAvatar name={definition.value.name} size={40} shape={definition.kind === 'skill' ? 'app' : 'circle'}/></Avatar.Fallback></Avatar>
                        <span className="methods-row-copy">
                          <span className="methods-row-title">{definition.value.name}</span>
                          <span className="methods-row-meta">{meta}</span>
                        </span>
                      </button>
                      <div className="methods-row-actions">
                        <Button variant="tertiary" size="sm" onPress={() => onToggleAttach(definition.value.id)}>
                          {attached ? 'Detach' : 'Attach'}
                        </Button>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onPress={() => {
                            void methods.loadHistory(definition.value.id);
                            setExpandedId((open) => (open === definition.value.id ? '' : definition.value.id));
                          }}
                        >
                          {expandedId === definition.value.id ? 'Hide history' : 'History'}
                        </Button>
                      </div>
                    </div>
                    {expandedId === definition.value.id && (
                      <ul className="method-history" aria-label="Version history">
                        {methods.history.filter((version) => version.definitionId === definition.value.id).length === 0 && <li>No earlier versions.</li>}
                        {methods.history
                          .filter((version) => version.definitionId === definition.value.id)
                          .map((version) => (
                            <li key={version.id}>
                              <span>
                                Revision {version.revision} · {new Date(version.savedAt).toLocaleString()}
                              </span>
                              <Button variant="tertiary" size="sm" onPress={() => void methods.restore(version.id)}>
                                Restore
                              </Button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Modal.Backdrop
          isOpen={editorMode !== 'closed'}
          isDismissable={false}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
          className="method-dialog-backdrop"
        >
          <Modal.Container placement="center">
            <Modal.Dialog
              className="method-dialog"
              aria-label={editorMode === 'create' ? `New ${kindLabel}` : `Edit ${kindLabel}`}
              aria-describedby={descriptionId}
            >
              <section className="methods-editor" aria-label={editorMode === 'create' ? `New ${kindLabel}` : `Edit ${kindLabel}`}>
                <Modal.Heading className="methods-editor-title">
                  {editorMode === 'create' ? `New ${kindLabel}` : `Editing ${draft.value.name || kindLabel}`}
                </Modal.Heading>
                <p id={descriptionId} className="method-hint form-field-wide">
                  Set the name and instructions, then save your {kindLabel}.
                </p>
                <label className="method-field form-field-wide">
                  Name
                  <Input
                    aria-label="Name"
                    value={draft.value.name}
                    onChange={(event) => setDraft({ ...draft, value: { ...draft.value, name: event.target.value } } as MethodDefinition)}
                  />
                </label>
                {draft.kind === 'preset' && (
                  <>
                    <label className="method-field">
                      Model
                      <SelectField
                        aria-label="Model"
                        value={draft.value.model}
                        onValueChange={(selectedValue) =>
                          setDraft({
                            kind: 'preset',
                            value: {
                              ...draft.value,
                              model: selectedValue,
                              modelReference: draft.value.provider
                                ? { providerId: draft.value.provider, modelId: selectedValue, role: draft.value.modelReference?.role ?? 'chat' }
                                : undefined,
                            },
                          })
                        }
                      >
                        {!providerCatalog.providers.some((provider) => provider.id === draft.value.provider && provider.models.includes(draft.value.model)) && (
                          <option value={draft.value.model}>{draft.value.model ? `${draft.value.model} (unavailable)` : 'Choose a model'}</option>
                        )}
                        {providerCatalog.providers
                          .filter((provider) => provider.id === (draft.value.provider ?? providerCatalog.selectedProvider))
                          .flatMap((provider) =>
                            provider.models
                              .filter(
                                (model) =>
                                  !provider.modelFacts?.find((fact) => fact.modelId === model) ||
                                  provider.modelFacts.find((fact) => fact.modelId === model)?.roles.includes('chat'),
                              )
                              .map((model) => (
                                <option key={`${provider.id}:${model}`} value={model}>
                                  {provider.id === 'local-replay' ? 'Demo model' : model}
                                </option>
                              )),
                          )}
                      </SelectField>
                    </label>
                    <label className="method-field">
                      Provider
                      <SelectField
                        aria-label="Provider"
                        value={draft.value.provider ?? ''}
                        onValueChange={(selectedValue) => {
                          const provider = providerCatalog.providers.find((provider) => provider.id === selectedValue);
                          setDraft({
                            kind: 'preset',
                            value: {
                              ...draft.value,
                              provider: selectedValue || undefined,
                              model: provider?.models[0] ?? draft.value.model,
                              modelReference:
                                selectedValue && provider?.models[0]
                                  ? { providerId: selectedValue, modelId: provider.models[0], role: draft.value.modelReference?.role ?? 'chat' }
                                  : undefined,
                            },
                          });
                        }}
                      >
                        <option value="">Workspace provider</option>
                        {draft.value.provider && !providerCatalog.providers.some((provider) => provider.id === draft.value.provider) && (
                          <option value={draft.value.provider}>{draft.value.provider} (unavailable)</option>
                        )}
                        {providerCatalog.providers.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.id === 'local-replay' ? 'Local demo' : (provider.name ?? provider.id)}
                          </option>
                        ))}
                      </SelectField>
                    </label>
                    {draft.value.provider === 'local-replay' && (
                      <p className="method-hint form-field-wide">
                        The demo model lets you try the interface. Connect a local or cloud provider in Settings → Local or Settings → Cloud to use a real
                        model.
                      </p>
                    )}
                    <label className="method-field">
                      Temperature
                      <Input
                        aria-label="Temperature"
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={draft.value.settings.temperature ?? ''}
                        onChange={(event) =>
                          setDraft({
                            kind: 'preset',
                            value: {
                              ...draft.value,
                              settings: { ...draft.value.settings, temperature: event.target.value === '' ? undefined : Number(event.target.value) },
                            },
                          })
                        }
                      />
                      <span className="method-hint">Copilot uses the model default; this saved value is retained.</span>
                    </label>
                    <label className="method-field">
                      Maximum output tokens
                      <Input
                        aria-label="Maximum output tokens"
                        type="number"
                        step="1"
                        min="1"
                        value={draft.value.settings.maxOutputTokens ?? ''}
                        onChange={(event) =>
                          setDraft({
                            kind: 'preset',
                            value: {
                              ...draft.value,
                              settings: { ...draft.value.settings, maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) },
                            },
                          })
                        }
                      />
                    </label>
                    <Fieldset className="method-fieldset">
                      <Fieldset.Legend>Knowledge collections</Fieldset.Legend>
                      {collections.length === 0 && <p className="method-hint">No collections are available yet.</p>}
                      {collections.map((collection) => (
                        <Checkbox
                          className="method-check"
                          key={collection.id}
                          isSelected={draft.value.knowledgeCollectionIds.includes(collection.id)}
                          onChange={(checked) =>
                            setDraft({
                              kind: 'preset',
                              value: {
                                ...draft.value,
                                knowledgeCollectionIds: checked
                                  ? [...draft.value.knowledgeCollectionIds, collection.id]
                                  : draft.value.knowledgeCollectionIds.filter((id) => id !== collection.id),
                              },
                            })
                          }
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span>{collection.name}</span>
                          </Checkbox.Content>
                        </Checkbox>
                      ))}
                    </Fieldset>
                    <Fieldset className="method-fieldset">
                      <Fieldset.Legend>Skills attached with this agent</Fieldset.Legend>
                      {methods.definitions.filter((definition) => definition.kind === 'skill').length === 0 && (
                        <p className="method-hint">Create a skill to attach it to an agent.</p>
                      )}
                      {methods.definitions
                        .filter((definition) => definition.kind === 'skill')
                        .map((skill) => (
                          <Checkbox
                            className="method-check"
                            key={skill.value.id}
                            isSelected={draft.value.skillIds.includes(skill.value.id)}
                            onChange={(checked) =>
                              setDraft({
                                kind: 'preset',
                                value: {
                                  ...draft.value,
                                  skillIds: checked ? [...draft.value.skillIds, skill.value.id] : draft.value.skillIds.filter((id) => id !== skill.value.id),
                                },
                              })
                            }
                          >
                            <Checkbox.Content>
                              <Checkbox.Control>
                                <Checkbox.Indicator />
                              </Checkbox.Control>
                              <span>{skill.value.name}</span>
                            </Checkbox.Content>
                          </Checkbox>
                        ))}
                    </Fieldset>
                    <Fieldset className="method-fieldset">
                      <Fieldset.Legend>Tools available in this agent</Fieldset.Legend>
                      {tools.some((tool) => tool.enabled) && (
                        <Checkbox
                          className="method-check method-select-all"
                          isIndeterminate={
                            tools.some((tool) => tool.enabled && draft.value.toolIds.includes(tool.id)) &&
                            !tools.filter((tool) => tool.enabled).every((tool) => draft.value.toolIds.includes(tool.id))
                          }
                          isSelected={tools.filter((tool) => tool.enabled).every((tool) => draft.value.toolIds.includes(tool.id))}
                          onChange={(checked) => {
                            const enabledIds = tools.filter((tool) => tool.enabled).map((tool) => tool.id);
                            setDraft({
                              kind: 'preset',
                              value: {
                                ...draft.value,
                                toolIds: checked
                                  ? [...new Set([...draft.value.toolIds, ...enabledIds])]
                                  : draft.value.toolIds.filter((id) => !enabledIds.includes(id)),
                              },
                            });
                          }}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span>Select all enabled tools</span>
                          </Checkbox.Content>
                        </Checkbox>
                      )}
                      {tools.length === 0 && <p className="method-hint">Enable tools in Settings to add them to an agent.</p>}
                      {tools.map((tool) => (
                        <Checkbox
                          className="method-check"
                          key={tool.id}
                          isDisabled={!tool.enabled}
                          isSelected={draft.value.toolIds.includes(tool.id)}
                          onChange={(checked) =>
                            setDraft({
                              kind: 'preset',
                              value: {
                                ...draft.value,
                                toolIds: checked ? [...draft.value.toolIds, tool.id] : draft.value.toolIds.filter((id) => id !== tool.id),
                              },
                            })
                          }
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span>
                              {tool.name}
                              {tool.enabled ? '' : ' · disabled'}
                            </span>
                          </Checkbox.Content>
                        </Checkbox>
                      ))}
                    </Fieldset>
                  </>
                )}
                {draft.kind === 'skill' && (
                  <label className="method-field form-field-wide">
                    Description
                    <Input
                      aria-label="Description"
                      value={draft.value.description}
                      onChange={(event) => setDraft({ kind: 'skill', value: { ...draft.value, description: event.target.value } })}
                    />
                  </label>
                )}
                <label className="method-field form-field-wide">
                  Instructions
                  <TextArea
                    aria-label="Instructions"
                    value={draft.value.instructions}
                    onChange={(event) => setDraft({ ...draft, value: { ...draft.value, instructions: event.target.value } } as MethodDefinition)}
                  />
                </label>
                {draft.kind === 'prompt' && <p className="method-hint">Variables detected: {readVariables(draft.value.instructions).join(', ') || 'none'}</p>}
                <div className="method-editor-actions">
                  {methods.error && (
                    <p className="methods-status error" role="alert">
                      {methods.error}
                    </p>
                  )}
                  <Button variant="tertiary" size="sm" onPress={closeEditor}>
                    Cancel
                  </Button>
                  <Button size="sm" onPress={() => void submit()} isDisabled={!validateDefinition(draft)}>
                    Save
                  </Button>
                </div>
              </section>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </div>

      <div className="methods-transfer">
        <Button
          variant="tertiary"
          size="sm"
          aria-label="Export all definitions"
          onPress={() => void downloadBundle()}
          isDisabled={methods.definitions.length === 0}
        >
          <HugeiconsIcon icon={Download01Icon} size={16} />
          Export
        </Button>
        <Button variant="tertiary" size="sm" className="methods-import" onPress={() => importInput.current?.click()}>
          <HugeiconsIcon icon={Upload01Icon} size={16} />
          Import
        </Button>
        <input
          ref={importInput}
          aria-label="Import methods bundle"
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadBundle(file);
            event.currentTarget.value = '';
          }}
        />
      </div>
      {methods.status && (
        <p className="methods-status" role="status">
          {methods.status}
        </p>
      )}
      {methods.error && (
        <p className="methods-status error" role="alert">
          {methods.error}
        </p>
      )}
    </div>
  );
}
