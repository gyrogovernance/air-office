import { Button, Card, Checkbox, Fieldset, Input, Modal, Separator, TextArea } from '@heroui/react';
import { useProviderCatalog } from '../models/providers-catalog.hook';
import { useModelVisibility, visibleModelChoices } from '../models/model-visibility.hook';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { SelectField } from '../shared/select-field.component';
import { useEffect, useState } from 'react';
import type { CalendarList, Recurrence } from '@office/calendar/domain';
import { CalendarAutomationForm } from './calendar-automation-form.component';
import type { AutomationDefinition, ScheduledOccurrence } from '@office/automations/domain';
import type { ToolDefinition } from '@office/contracts/tool';
import { createServiceClient } from '../shared/service-client.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';
import { DateField } from '../shared/date-field.component';
import { HugeiconsIcon } from '@hugeicons/react';
import { Calendar03Icon, HistoryIcon } from '@hugeicons/core-free-icons';

export function AutomationsWorkspace({ initialDate }: { initialDate?: string }) {
  const client = createServiceClient();
  const dialogs = useAppDialogs();
  const catalog = useProviderCatalog();
  const visibility = useModelVisibility();
  const [modelKey, setModelKey] = useState('');
  const modelChoices = visibleModelChoices(catalog.providers.flatMap((provider) => provider.models.filter((model) => !provider.modelFacts?.find((fact) => fact.modelId === model) || provider.modelFacts.find((fact) => fact.modelId === model)?.roles.includes('chat')).map((model) => ({ key: `${provider.id}:${model}`, providerId: provider.id, modelId: model, label: `${provider.name ?? provider.id} · ${model}` }))), visibility, modelKey);
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [history, setHistory] = useState<ScheduledOccurrence[]>([]);
  const [jobs, setJobs] = useState<{ id: string; state: string; progress: number }[]>([]);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(Boolean(initialDate));
  const [saving, setSaving] = useState(false);
  const [time, setTime] = useState('09:00');
  const [date, setDate] = useState(() => initialDate ?? new Date().toLocaleDateString('en-CA'));
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [missedRunPolicy, setMissedRunPolicy] = useState<'skip' | 'run-once'>('skip');
  const [includeTool, setIncludeTool] = useState(false);
  const [toolId, setToolId] = useState('');
  const [toolInput, setToolInput] = useState('{}');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AutomationDefinition | null>(null);
  const [calendarLists, setCalendarLists] = useState<CalendarList[]>([]);
  async function refresh() {
    try {
      const [a, h, j] = await Promise.all([
        client.json<{ automations: AutomationDefinition[] }>('/api/v1/automations'),
        client.json<{ history: ScheduledOccurrence[] }>('/api/v1/automations/history'),
        client.json<{ jobs: { id: string; state: string; progress: number }[] }>('/api/v1/automations/jobs')
      ]);
      setAutomations(a.automations); setHistory(h.history); setJobs(j.jobs); setError('');
    } catch { setError('Schedules could not be loaded.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); void client.json<{ definitions: ToolDefinition[] }>('/api/v1/tools').then((result) => setTools(result.definitions.filter((tool) => tool.enabled))).catch(() => setTools([])); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, []);
  async function save() {
    const selected = modelChoices.find((choice) => choice.key === modelKey);
    if (prompt.trim() && !selected) { setError('Choose an available model for this scheduled prompt.'); return; }
    let steps: AutomationDefinition['steps'] = selected && prompt.trim() ? [{ kind: 'prompt', prompt, providerId: selected.providerId, modelId: selected.modelId, modelReference: { providerId: selected.providerId, modelId: selected.modelId, role: 'chat' } }] : [];
    let confirmed = false;
    if (includeTool) {
      let input: unknown;
      try { input = JSON.parse(toolInput); } catch { setError('Enter valid JSON for the selected tool.'); return; }
      if (!toolId || typeof input !== 'object' || input === null || Array.isArray(input)) { setError('Choose a tool and enter an object of input values.'); return; }
      if (tools.find((tool) => tool.id === toolId)?.effect === 'mutate') {
        const approved = await dialogs.confirm({ title: 'Allow this scheduled tool?', message: 'This tool may change data when the schedule runs. You can turn off the schedule at any time.', confirmLabel: 'Allow scheduled runs' });
        if (!approved) return;
        confirmed = true;
      }
      steps = [...(prompt.trim() ? steps : []), { kind: 'tool', toolId, input: input as Record<string, unknown> }];
    }
    const recurrence: Recurrence = { frequency, interval: 1, weekdays: frequency === 'weekly' ? [new Date(`${date}T00:00:00Z`).getUTCDay()] : [], localTime: time, timezone, startDate: date };
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const value: AutomationDefinition = { id, path: `automations/${id}.automation.yaml`, name, enabled: true, recurrence, missedRunPolicy, steps, createdAt: now, updatedAt: now };
    setSaving(true);
    try { await client.json('/api/v1/automations', { method: 'POST', body: JSON.stringify({ definition: value, confirmed }) }); setCreating(false); setName(''); setPrompt(''); setIncludeTool(false); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The schedule could not be saved.'); }
    finally { setSaving(false); }
  }
  async function cancel(id: string) {
    try { await client.request(`/api/v1/automations/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The run could not be cancelled.'); }
  }
  async function edit(item: AutomationDefinition) {
    try { const result = await client.json<{ lists: CalendarList[] }>('/api/v1/calendar/lists'); setCalendarLists(result.lists); setEditing(item); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Calendar could not be loaded.'); }
  }
  async function runNow(item: AutomationDefinition) {
    const needsConfirmation = item.steps.some((step) => step.kind === 'tool' && tools.find((tool) => tool.id === step.toolId)?.effect === 'mutate');
    const confirmed = !needsConfirmation || await dialogs.confirm({ title: `Run ${item.name}?`, message: 'This action may change data.', confirmLabel: 'Run action' });
    if (!confirmed) return;
    try { await client.json(`/api/v1/automations/${encodeURIComponent(item.id)}/run`, { method: 'POST', body: JSON.stringify({ confirmed }) }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not run.'); }
  }
  return <div className="slice-workspace schedules-workspace">
    <div className="schedule-overview"><Button size="sm" onPress={() => setCreating(true)}>New schedule</Button></div>
    {creating && <Card variant="secondary" className="schedule-editor gap-3 p-3" aria-label="New schedule" render={(props) => <section {...props} />}><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Calendar03Icon} size={18} aria-hidden="true" />New schedule</Card.Title></Card.Header><Separator /><div className="slice-form">
      <Fieldset className="schedule-fields"><Fieldset.Legend>1. What should run?</Fieldset.Legend>
      <label className="form-field-wide">Name<Input placeholder="e.g. Morning research briefing" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-field-wide">Instructions<TextArea placeholder="Describe what you want the assistant to do." value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
      <label className="form-field-wide">Model<SelectField value={modelKey} onValueChange={setModelKey}><option value="">Choose a model</option>{modelKey && !modelChoices.some((choice) => choice.key === modelKey) && <option value={modelKey}>{modelKey} (unavailable)</option>}{modelChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</SelectField></label>
      <div className="method-check form-field-wide" title={tools.length === 0 ? 'Enable tools in Settings to add a tool step.' : undefined}><Checkbox isDisabled={tools.length === 0} isSelected={includeTool} onChange={setIncludeTool}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Add a tool step</Checkbox.Content></Checkbox></div>
      {includeTool && <><label>Tool<SelectField value={toolId} onValueChange={(selectedValue) => setToolId(selectedValue)}><option value="">Choose an enabled tool</option>{tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name} · {tool.effect === 'mutate' ? 'changes data' : 'read only'}</option>)}</SelectField></label><label className="form-field-wide">Tool input JSON<TextArea value={toolInput} onChange={(event) => setToolInput(event.target.value)} /></label></>}
      </Fieldset>
      <Fieldset className="schedule-fields"><Fieldset.Legend>2. When should it run?</Fieldset.Legend>
      <label>Repeats<SelectField value={frequency} onValueChange={(selectedValue) => setFrequency(selectedValue === 'weekly' ? 'weekly' : 'daily')}><option value="daily">Every day</option><option value="weekly">Every week on the start date’s weekday</option></SelectField></label>
      <DateField label="Start date" value={date} onChange={setDate}/>
      <label>Local time<Input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
      <label>Timezone<Input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
      <label>If a run is missed<SelectField value={missedRunPolicy} onValueChange={(selectedValue) => setMissedRunPolicy(selectedValue === 'run-once' ? 'run-once' : 'skip')}><option value="skip">Skip missed runs</option><option value="run-once">Run once after reopening</option></SelectField></label>
      </Fieldset>
      <p className="schedule-preview">{frequency === 'daily' ? 'Every day' : 'Every week'} at {time} ({timezone}), starting {date}. {missedRunPolicy === 'skip' ? 'Missed runs will be skipped.' : 'One missed run will run after the service restarts.'}</p>
      <div className="form-actions"><Button variant="tertiary" size="sm" isDisabled={saving} onPress={() => setCreating(false)}>Cancel</Button><Button size="sm" isDisabled={saving || !name.trim() || (!prompt.trim() && !includeTool) || !date || !time} onPress={() => void save()}>{saving ? 'Creating…' : 'Create schedule'}</Button></div>
    </div></Card>}
    {!loading && (!error || automations.length > 0) && <Card variant="secondary" className="gap-3 p-3" aria-label="Saved schedules" render={(props) => <section {...props} />}><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Calendar03Icon} size={18} aria-hidden="true" />Schedules</Card.Title></Card.Header><Separator />{automations.length === 0 && <p className="slice-empty">No schedules yet.</p>}{automations.map((item) => <div className="slice-row" key={item.id}><span><strong>{item.name}</strong><small>{item.recurrence.frequency === 'once' ? 'Once' : item.recurrence.frequency === 'daily' ? 'Daily' : 'Weekly'} · {item.recurrence.localTime} · {item.recurrence.timezone}</small><small>{item.missedRunPolicy === 'skip' ? 'Skip missed runs' : 'Run once after reopening'}</small></span><small>{item.enabled ? 'On' : 'Off'}</small><Button variant="tertiary" size="sm" onPress={() => void edit(item)}>Edit</Button><Button variant="secondary" size="sm" onPress={() => void runNow(item)}>Run now</Button></div>)}</Card>}
    {!loading && (!error || history.length > 0) && <Card variant="secondary" className="gap-3 p-3" aria-label="Run history" render={(props) => <section {...props} />}><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={HistoryIcon} size={18} aria-hidden="true" />Run history</Card.Title></Card.Header><Separator />{history.length === 0 && <p className="slice-empty">Scheduled run results will appear here.</p>}{history.map((entry) => <CollapsibleSection className="slice-tool" key={entry.id} title={<>{automations.find((item) => item.id === entry.automationId)?.name ?? 'Schedule'} · {new Date(entry.scheduledAt).toLocaleString()}<span className="history-status">{entry.state.replaceAll('-', ' ')}</span></>}>{entry.jobId && <p className="method-hint">Run: {entry.jobId}</p>}{entry.error && <p className="slice-feedback is-error" role="alert">{entry.error}</p>}{entry.completedSteps.map((step, index) => { const action = step.step; const label = action.kind === 'prompt' ? 'Prompt' : action.kind === 'action' ? 'Action' : action.kind === 'calendar-event' ? 'Calendar event' : action.kind === 'chat-message' ? 'Chat result' : tools.find((tool) => tool.id === action.toolId)?.name ?? 'Tool'; return <div key={`${entry.id}:${index}`}><p>Step {index + 1}: {label}</p><pre>{JSON.stringify(step.result, null, 2)}</pre></div>; })}</CollapsibleSection>)}</Card>}
    {jobs.filter((job) => ['queued', 'running', 'waiting-user'].includes(job.state)).map((job) => <div className="slice-row" key={job.id} role="status"><span><strong>{job.state === 'waiting-user' ? 'Waiting for input' : job.state === 'running' ? 'Running' : 'Queued'}</strong><small>{Math.round(job.progress * 100)}%</small></span><Button variant="tertiary" size="sm" onPress={() => void cancel(job.id)}>Cancel</Button></div>)}
    {editing && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open) setEditing(null); }}><Modal.Container><Modal.Dialog aria-labelledby="scheduled-action-edit-title"><Modal.Header><Modal.Heading id="scheduled-action-edit-title">Edit action</Modal.Heading></Modal.Header><Modal.Body><CalendarAutomationForm client={client} initial={editing} date={editing.recurrence.startDate} title={editing.name} lists={calendarLists} onSaved={() => { setEditing(null); void refresh(); }} onCancel={() => setEditing(null)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>}
    {loading && <p className="method-hint" role="status">Loading schedules…</p>}
    {error && <div className="slice-feedback is-error" role="alert"><p>{error}</p><Button variant="tertiary" size="sm" onPress={() => void refresh()}>Retry</Button></div>}
  </div>;
}
