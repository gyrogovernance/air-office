import { useEffect, useRef, useState } from 'react';
import { Button, Card, Label, Modal, ScrollShadow, Separator, TextArea, TextField } from '@heroui/react';
import { GridViewIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { CalendarList } from '@office/calendar/domain';
import { actionDemoInput, actionStepPrompt, LAB_SOURCE_LIMIT } from '@office/lab-pack/domain';
import { useModelVisibility, visibleModelChoices } from '../models/model-visibility.hook';
import { AutomationsWorkspace } from '../calendar/automations-workspace.component';
import { CalendarAutomationForm } from '../calendar/calendar-automation-form.component';
import { Streamdown } from 'streamdown';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';
import type { ServiceClient } from '../shared/service-client.hook';
import { AppIcon } from '../shared/app-icon.component';
import { DashboardCatalog, DashboardViews, WorkspaceDashboard } from '../shared/collection-dashboard.component';
import { SelectField } from '../shared/select-field.component';
import type { ProviderCatalogState } from '../models/providers-catalog.hook';
import { streamRun } from '../chat/run-stream.adapter';
import { answerAgentQuestion, confirmToolPermission, useAppDialogs } from '../shared/app-dialogs.component';
import type { ProjectReview } from './app-review.policy';

type LabApp = {
  id: string;
  name: string;
  description: string;
  prompts: string[];
  runPrompts: string[];
  system: string;
  edited: boolean;
  icon?: string;
  custom?: boolean;
};
type StepResult = { text: string; done: boolean };

type AppDraft = { text: string; instructions: string; sourceVersions?: ProjectReview['sources'] };
function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString('en-CA');
}
function isAppDraft(value: unknown): value is AppDraft {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'text' in value &&
    typeof value.text === 'string' &&
    'instructions' in value &&
    typeof value.instructions === 'string' &&
    (!('sourceVersions' in value) ||
      (Array.isArray(value.sourceVersions) &&
        value.sourceVersions.every(
          (source: unknown) =>
            source &&
            typeof source === 'object' &&
            'name' in source &&
            typeof source.name === 'string' &&
            'versionId' in source &&
            typeof source.versionId === 'string',
        ))),
  );
}
function readDrafts(): Record<string, AppDraft> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem('air-office:app-source-drafts') ?? 'null');
    if (stored && typeof stored === 'object')
      return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, AppDraft] => isAppDraft(entry[1])));
    const legacy: unknown = JSON.parse(sessionStorage.getItem('air-office:app-source-draft') ?? 'null');
    if (isAppDraft(legacy)) return { legacy };
  } catch {
    /* Keep editing available when storage is unavailable. */
  }
  return {};
}

export function AppsWorkspace({
  client,
  provider,
  model,
  initialAppId,
  focusRequestId = 0,
  catalog,
  onSettings,
  onNewApp,
  onModels,
  appearance = 'light',
  projectReview,
  onOpenProject,
  onSaveProjectReview,
}: {
  client: ServiceClient;
  provider: string;
  model: string;
  initialAppId?: string;
  focusRequestId?: number;
  appearance?: 'light' | 'dark';
  catalog?: ProviderCatalogState;
  onSettings?: () => void;
  onNewApp?: () => void;
  onModels?: () => void;
  projectReview?: ProjectReview;
  onOpenProject?: (scopeId: string) => void;
  onSaveProjectReview?: (review: ProjectReview, markdown: string, appName: string) => Promise<void>;
}) {
  const dialogs = useAppDialogs();
  const visibility = useModelVisibility();
  const [apps, setApps] = useState<LabApp[]>([]);
  const [selectedId, setSelectedId] = useState(initialAppId ?? '');
  const [drafts, setDrafts] = useState(readDrafts);
  const [review, setReview] = useState<ProjectReview | undefined>();
  const handledReview = useRef<string | undefined>(undefined);
  const draftId = review ? `${selectedId}:${review.scopeId}` : selectedId;
  const draft = drafts[draftId] ?? (!review ? drafts.legacy : undefined) ?? { text: '', instructions: '' };
  const { text, instructions } = draft;
  const setText = (value: string) => setDrafts((current) => ({ ...current, [draftId]: { ...draft, text: value, instructions } }));
  const setInstructions = (value: string) => setDrafts((current) => ({ ...current, [draftId]: { ...draft, text, instructions: value } }));
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [appQuery, setAppQuery] = useState('');
  const [view, setView] = useState<'apps' | 'schedules'>('apps');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [calendarLists, setCalendarLists] = useState<CalendarList[]>([]);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runReview, setRunReview] = useState<{ review: ProjectReview; demo: boolean } | undefined>();
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!projectReview || projectReview.id === handledReview.current || abort.current || saving) return;
    handledReview.current = projectReview.id;
    setReview(projectReview);
    setSelectedId(projectReview.appId);
    setSteps([]);
    setStatus('');
    setError('');
    setRunReview(undefined);
    setSaved(false);
    const key = `${projectReview.appId}:${projectReview.scopeId}`;
    setDrafts((current) => ({
      ...current,
      [key]: current[key] ?? { text: projectReview.text, instructions: projectReview.instructions, sourceVersions: projectReview.sources },
    }));
  }, [projectReview, running, saving]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void client
        .json<{ apps: LabApp[] }>('/api/v1/lab/apps')
        .then((result) => {
          if (!alive) return;
          setApps(result.apps);
          setSelectedId((current) => current || result.apps[0]?.id || '');
        })
        .catch((reason: unknown) => {
          if (alive) setError(reason instanceof Error ? reason.message : 'Apps unavailable.');
        });
    };
    refresh();
    window.addEventListener('office-apps-changed', refresh);
    window.addEventListener('air-office:crafts-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('office-apps-changed', refresh);
      window.removeEventListener('air-office:crafts-changed', refresh);
      abort.current?.abort();
    };
  }, [client]);

  useEffect(() => {
    try {
      sessionStorage.setItem('air-office:app-source-drafts', JSON.stringify(drafts));
    } catch {
      /* Editing remains available when session storage is full. */
    }
  }, [drafts]);

  useEffect(() => {
    if (selectedId)
      setDrafts((current) => {
        if (!current.legacy) return current;
        const { legacy, ...rest } = current;
        return { ...rest, [selectedId]: current[selectedId] ?? legacy };
      });
  }, [selectedId]);

  useEffect(() => {
    if (!focusRequestId || abort.current) return;
    setView('apps');
    if (initialAppId) {
      setSelectedId(initialAppId);
      setSteps([]);
      setStatus('');
      setError('');
      setRunReview(undefined);
      setSaved(false);
      setCopied(false);
    }
  }, [focusRequestId, initialAppId]);

  const selected = apps.find((app) => app.id === selectedId) ?? null;
  const demoModel = provider === 'local-replay';
  const modelMissing = !provider || !model || model === 'unassigned';
  const runBlocked = modelMissing;

  function resetRun() {
    setSteps([]);
    setStatus('');
    setError('');
    setRunReview(undefined);
    setSaved(false);
  }

  async function run() {
    if (!selected || abort.current) return;
    if (!text.trim()) {
      setError('Paste the source text to review.');
      return;
    }
    if (text.length > LAB_SOURCE_LIMIT) {
      setError('Source text must be 200,000 characters or fewer.');
      return;
    }
    if (runBlocked) {
      setError('Choose a model before running an action.');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    resetRun();
    setRunReview(review ? { review: { ...review, text, instructions, sources: draft.sourceVersions ?? [] }, demo: demoModel } : undefined);
    setCopied(false);
    setRunning(true);
    const runPrompts = selected.runPrompts;
    try {
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: selected.system }];
      for (const [index, basePrompt] of runPrompts.entries()) {
        setStatus(`Running step ${index + 1} of ${runPrompts.length}...`);
        const prompt = actionStepPrompt({ prompt: basePrompt, index, source: text, instructions });
        messages.push({ role: 'user', content: prompt });
        let passText = '';
        let failure = '';
        setSteps((current) => [...current.slice(0, index), { text: '', done: false }]);
        const result = await streamRun({
          request: {
            runId: crypto.randomUUID(),
            provider,
            model,
            messages: demoModel
              ? [{ role: 'user', content: actionDemoInput({ source: text, instructions }) }]
              : [...messages],
          },
          signal: controller.signal,
          onApproval: (request) => confirmToolPermission(dialogs, request),
          onUserInput: (request) => answerAgentQuestion(dialogs, request),
          onEvent: (event) => {
            if (event.type === 'text-delta') {
              passText += event.payload.text;
              const captured = passText;
              setSteps((current) => [...current.slice(0, index), { text: captured, done: false }]);
            }
            if (event.type === 'failure') failure = event.payload.message;
          },
        });
        if (failure || result.state.failure) throw new Error(failure || result.state.failure?.message || 'The model request failed.');
        if (result.cancelled) {
          setStatus('Cancelled. Completed steps are kept.');
          return;
        }
        if (!passText.trim()) throw new Error('The model returned no text for this step.');
        messages.push({ role: 'assistant', content: passText });
        setSteps((current) => [...current.slice(0, index), { text: passText, done: true }]);
      }
      setStatus(
        demoModel
          ? 'Demo finished. Your input was echoed in each step; no AI review was performed.'
          : 'Run finished. Verify the findings against your source material.',
      );
    } catch (reason) {
      setStatus('Run stopped.');
      setError(reason instanceof Error ? reason.message : 'The action could not finish.');
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }

  function download() {
    const body = steps
      .filter((step) => step.done)
      .map((step, index) => `## Step ${index + 1}\n\n${step.text}`)
      .join('\n\n');
    if (!body) return;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected?.id ?? 'app'}-results.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyAll() {
    const body = steps
      .filter((step) => step.done)
      .map((step, index) => `## Step ${index + 1}\n\n${step.text}`)
      .join('\n\n');
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
    } catch {
      setError('Copy failed. You can download the results instead.');
    }
  }

  async function saveReview() {
    if (!runReview || !onSaveProjectReview || saving || saved || !selected) return;
    setSaving(true);
    setError('');
    try {
      const body = `${runReview.demo ? 'Demo output. No AI review was performed.' : 'AI-assisted review. Verify findings against the source material.'}\n\n${steps
        .filter((step) => step.done)
        .map((step, index) => `## Step ${index + 1}\n\n${step.text}`)
        .join('\n\n')}`;
      await onSaveProjectReview(runReview.review, body, selected.name);
      setSaved(true);
      setStatus('Review saved in the project.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The review could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const visibleApps = apps.filter((app) => `${app.name} ${app.description}`.toLowerCase().includes(appQuery.trim().toLowerCase()));
  const stepCount = selected?.runPrompts.length ?? 0;

  return (
    <WorkspaceDashboard
      title="Actions"
      hero={{
        icon: <HugeiconsIcon icon={GridViewIcon} size={48} aria-hidden="true" />,
        subtitle: 'Turn source material into useful results.',
      }}
    >
      <DashboardViews
        label="Action views"
        selectedKey={view}
        onSelect={setView}
        views={[
          {
            id: 'apps',
            label: 'Actions',
            actions: (
              <>
                {onNewApp && (
                  <Button isDisabled={running} onPress={onNewApp}>
                    New action
                  </Button>
                )}
                {onSettings && (
                  <Button variant="secondary" isDisabled={running} onPress={onSettings}>
                    Manage actions
                  </Button>
                )}
              </>
            ),
            content: (
              <div className="collection-dashboard__columns">
                <DashboardCatalog
                  listLabel="Available actions"
                  search={{ value: appQuery, onChange: setAppQuery, label: 'Find an action', placeholder: 'Find an action…' }}
                  items={visibleApps.map((app) => ({
                    id: app.id,
                    title: app.name,
                    description: app.runPrompts.length + (app.runPrompts.length === 1 ? ' step' : ' steps') + (app.edited ? ' · Edited' : ''),
                    icon: <AppIcon name={app.id} emoji={app.icon} size={32} appearance={appearance} />,
                  }))}
                  selectedId={selected?.id ?? null}
                  isDisabled={running}
                  onSelect={(id) => {
                    if (id === selectedId) return;
                    setSelectedId(id);
                    if (review)
                      setDrafts((current) => ({
                        ...current,
                        [id + ':' + review.scopeId]: current[id + ':' + review.scopeId] ?? {
                          text: review.text,
                          instructions: review.instructions,
                          sourceVersions: review.sources,
                        },
                      }));
                    resetRun();
                    setCopied(false);
                  }}
                  emptyDescription={apps.length ? 'No matching actions.' : error || 'Loading actions…'}
                />
                <Card className="collection-dashboard__preview gap-3 p-3" role="region" aria-label={selected?.name ?? 'Action details'}>
                  <ScrollShadow className="collection-dashboard__scroll" tabIndex={0} role="region" aria-label="Action workspace">
                    {selected ? (
                      <Card.Content className="collection-dashboard__details">
                        {review && (
                          <div className="lab-apps-notice" aria-label="Review project">
                            <span>Project: {review.scopeName}</span>
                            <Button variant="secondary" size="sm" isDisabled={running || saving} onPress={() => onOpenProject?.(review.scopeId)}>
                              Open project
                            </Button>
                            <Button
                              variant="tertiary"
                              size="sm"
                              isDisabled={running || saving}
                              onPress={() => {
                                setReview(undefined);
                                resetRun();
                              }}
                            >
                              Use without project
                            </Button>
                            {(text !== review.text || instructions !== review.instructions) && (
                              <Button
                                variant="tertiary"
                                size="sm"
                                isDisabled={running || saving}
                                onPress={() => {
                                  setDrafts((current) => ({
                                    ...current,
                                    [draftId]: { text: review.text, instructions: review.instructions, sourceVersions: review.sources },
                                  }));
                                  resetRun();
                                }}
                              >
                                Use refreshed sources
                              </Button>
                            )}
                          </div>
                        )}
                        <Card variant="tertiary" className="settings-section-intro collection-preview-bubble p-3"><Card.Header className="collection-dashboard__profile">
                            <div className="collection-dashboard__item-copy">
                              <Card.Title render={(props) => <h2 {...props} />} className="text-lg">
                                {selected.name}
                              </Card.Title>
                              <Card.Description>{selected.description}</Card.Description>
                            </div>
                          </Card.Header></Card>
                        <Card variant="secondary" className="collection-preview-content p-3 lab-apps-form">
                          <TextField value={text} onChange={setText} isDisabled={running}>
                            <Label>Source material</Label>
                            <TextArea aria-label="Source material" maxLength={200000} rows={8} placeholder="Paste the document or excerpt to review..." />
                          </TextField>
                          <TextField value={instructions} onChange={setInstructions} isDisabled={running}>
                            <Label>Scope and constraints</Label>
                            <TextArea
                              aria-label="Optional scope"
                              maxLength={20000}
                              rows={2}
                              placeholder="Audience, sections to focus on, or revision constraints..."
                            />
                          </TextField>
                          <div className="lab-apps-run-row">
                            <Button size="sm" isDisabled={running || !text.trim() || runBlocked} onPress={() => void run()}>
                              {running ? 'Running...' : `Run action (${stepCount} ${stepCount === 1 ? 'step' : 'steps'})`}
                            </Button>
                            <Button variant="secondary" size="sm" isDisabled={running || !text.trim() || runBlocked} onPress={() => {
                              void client.json<{ lists: CalendarList[] }>('/api/v1/calendar/lists').then((result) => { setCalendarLists(result.lists); setScheduleOpen(true); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Calendar could not be loaded.'));
                            }}>Schedule</Button>
                            {running && (
                              <Button variant="tertiary" size="sm" onPress={() => abort.current?.abort()}>
                                Cancel
                              </Button>
                            )}
                            {catalog ? (
                              <SelectField aria-label="Action model" disabled={running} searchable value={`${provider}:${model}`} onValueChange={catalog.selectModel}>
                                {visibleModelChoices(catalog.providers.flatMap(connection => connection.models.filter(id => {
                                  const fact = connection.modelFacts?.find(item => item.modelId === id);
                                  return !fact || fact.roles.includes('chat') || connection.id === provider && id === model;
                                }).map(id => ({ key: `${connection.id}:${id}`, label: connection.id === 'local-replay' ? 'Demo model' : connection.id === 'managed-local' ? id : `${connection.name ?? connection.id} · ${id}` }))), visibility, `${provider}:${model}`).map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
                              </SelectField>
                            ) : (
                              <span className="lab-apps-model">{demoModel ? 'Demo model' : modelMissing ? 'No model chosen' : `${provider} · ${model}`}</span>
                            )}
                          </div>
                          {demoModel && (
                            <p className="lab-apps-notice">Demo mode echoes your input in each step so you can test the app without an AI model.</p>
                          )}
                          {runBlocked && (
                            <div className="lab-apps-notice">
                              <span>{catalog ? 'Choose an AI model above to run this action.' : 'Choose a model in chat before running an action.'}</span>
                              {onModels && (
                                <Button variant="secondary" size="sm" onPress={onModels}>
                                  Connect a model
                                </Button>
                              )}
                            </div>
                          )}
                          {error && (
                            <p className="sidebar-error" role="alert">
                              {error}
                            </p>
                          )}
                        </Card>
                        <Card variant="secondary" className="collection-preview-content p-3 lab-apps-results" aria-label="Results">
                          <div className="lab-apps-results-head">
                            <h3>Results</h3>
                            {status && (
                              <span className="lab-apps-status" role="status">
                                {status}
                              </span>
                            )}
                            {!!steps.filter((step) => step.done).length && !running && (
                              <div className="lab-apps-result-actions">
                                <Button variant="tertiary" size="sm" onPress={() => void copyAll()}>
                                  {copied ? 'Copied' : 'Copy'}
                                </Button>
                                <Button variant="tertiary" size="sm" onPress={download}>
                                  Download
                                </Button>
                                {runReview && onSaveProjectReview && (
                                  <Button variant="secondary" size="sm" isDisabled={saving || saved} onPress={() => void saveReview()}>
                                    {saving ? 'Saving…' : saved ? 'Saved in project' : 'Save in project'}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          {!steps.length && !error && <p className="lab-apps-empty">Results appear here one step at a time after you run the action.</p>}
                          {steps.map((step, index) => (
                            <article className="lab-app-result-step" key={index} aria-label={`Step ${index + 1}`}>
                              <div className="lab-app-result-step-head">
                                <span>
                                  Step {index + 1} of {stepCount}
                                </span>
                                {step.done && <span className="lab-app-result-step-state">Done</span>}
                              </div>
                              {step.text ? (
                                <Streamdown components={MARKDOWN_COMPONENTS} className="prose">{step.text}</Streamdown>
                              ) : (
                                <p className="lab-apps-empty">{running && index === steps.length - 1 ? 'Waiting for the model...' : 'No output.'}</p>
                              )}
                            </article>
                          ))}
                        </Card>
                      </Card.Content>
                    ) : (
                      <Card.Content>
                        <p role={error ? 'alert' : 'status'}>{error || 'Choose an action to get started.'}</p>
                      </Card.Content>
                    )}
                  </ScrollShadow>
                </Card>
              </div>
            ),
          },
          { id: 'schedules', label: 'Scheduled', actions: null, content: <AutomationsWorkspace /> },
        ]}
      />
      {scheduleOpen && selected && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) setScheduleOpen(false); }}>
        <Modal.Container><Modal.Dialog aria-labelledby="action-schedule-title"><Modal.Header><Modal.Heading id="action-schedule-title">Schedule {selected.name}</Modal.Heading></Modal.Header><Modal.Body>
          <CalendarAutomationForm client={client} date={tomorrow()} title={selected.name} lists={calendarLists} action={{ kind: 'action', actionPath: `actions/${selected.id}.md`, source: text, instructions, providerId: provider, modelId: model, ...(selected.id.startsWith('craft-action-') ? { definition: { name: selected.name, system: selected.system, runPrompts: selected.runPrompts } } : {}) }} onSaved={() => { setScheduleOpen(false); setView('schedules'); }} onCancel={() => setScheduleOpen(false)} />
        </Modal.Body></Modal.Dialog></Modal.Container>
      </Modal.Backdrop>}
    </WorkspaceDashboard>
  );
}
