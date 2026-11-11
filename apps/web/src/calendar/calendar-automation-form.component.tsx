import type { ProviderDescriptor } from '../models/providers-catalog.hook';
import { useModelVisibility, visibleModelChoices } from '../models/model-visibility.hook';
import { useEffect, useState } from 'react';
import type { AutomationDefinition, ScheduledOccurrence, WorkflowStep } from '@office/automations/domain';
import type { CalendarList } from '@office/calendar/domain';
import type { ToolDefinition } from '@office/contracts/tool';
import { automationRelative, calendarPathForListId, defaultConversationPath } from '@office/vault/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { DateField } from '../shared/date-field.component';
import { SelectField } from '../shared/select-field.component';
import { useAppDialogs } from '../shared/app-dialogs.component';
import { Button, Checkbox, Fieldset, Input, Modal, TextArea } from '@heroui/react';

export function CalendarAutomationForm({ client, initial, action, date, title, lists, onSaved, onCancel }: { client: ServiceClient; initial?: AutomationDefinition; action?: Extract<WorkflowStep, { kind: 'action' }>; date: string; title: string; lists: CalendarList[]; onSaved: () => void; onCancel: () => void }) {
  const dialogs = useAppDialogs();
  const visibility = useModelVisibility();
  const promptSteps = initial?.steps.filter((step) => step.kind === 'prompt') ?? [];
  const promptStep = promptSteps[0];
  const actionStep = initial?.steps.find((step) => step.kind === 'action') ?? action;
  const toolStep = initial?.steps.find((step) => step.kind === 'tool');
  const output = initial?.steps.find((step) => step.kind === 'calendar-event' || step.kind === 'chat-message');
  const [name, setName] = useState(initial?.name ?? title);
  const [prompt, setPrompt] = useState(actionStep?.instructions ?? promptStep?.prompt ?? '');
  const [source, setSource] = useState(actionStep?.source ?? '');
  const [providerId, setProviderId] = useState(actionStep?.providerId ?? promptStep?.modelReference?.providerId ?? promptStep?.providerId ?? '');
  const [modelId, setModelId] = useState(actionStep?.modelId ?? promptStep?.modelReference?.modelId ?? promptStep?.modelId ?? '');
  const [startDate, setStartDate] = useState(initial?.recurrence.startDate ?? date);
  const [time, setTime] = useState(initial?.recurrence.localTime ?? '09:00');
  const [timezone, setTimezone] = useState(initial?.recurrence.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [frequency, setFrequency] = useState<'once' | 'daily' | 'weekly'>(initial?.recurrence.frequency ?? 'once');
  const [interval, setInterval] = useState(initial?.recurrence.interval ?? 1);
  const [weekdays, setWeekdays] = useState(initial?.recurrence.weekdays ?? [new Date(`${date}T00:00:00Z`).getUTCDay()]);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [missed, setMissed] = useState<'skip' | 'run-once'>(initial?.missedRunPolicy ?? 'skip');
  const [toolId, setToolId] = useState(toolStep?.toolId ?? '');
  const [toolInput, setToolInput] = useState(JSON.stringify(toolStep?.input ?? {}, null, 2));
  const [destination, setDestination] = useState<'history' | 'calendar-event' | 'chat-message'>(output?.kind ?? 'history');
  const [calendarId, setCalendarId] = useState(output?.kind === 'calendar-event' ? (lists.find((list) => calendarPathForListId(list.id) === output.calendarPath)?.id ?? lists[0]?.id ?? '') : lists[0]?.id ?? '');
  const [eventTitle, setEventTitle] = useState(output?.kind === 'calendar-event' ? output.title : title);
  const [daysAfterRun, setDaysAfterRun] = useState(output?.kind === 'calendar-event' ? output.daysAfterRun : 0);
  const [allDay, setAllDay] = useState(output?.kind === 'calendar-event' ? output.allDay : true);
  const [eventTime, setEventTime] = useState(output?.kind === 'calendar-event' ? output.time ?? '09:00' : '09:00');
  const [conversationId, setConversationId] = useState(output?.kind === 'chat-message' ? (output.conversationPath.split('/').filter(Boolean).at(-1) ?? '') : '');
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const selectedProvider = providers.find(provider => provider.id === providerId);
  const models = visibleModelChoices((selectedProvider?.models ?? []).filter(id => !selectedProvider?.modelFacts?.find(model => model.modelId === id) || selectedProvider.modelFacts.find(model => model.modelId === id)?.roles.includes('chat')).map(id => ({ key: `${providerId}:${id}`, label: id })), visibility, `${providerId}:${modelId}`).map(item => item.label);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [chats, setChats] = useState<{ id: string; title: string }[]>([]);
  const [history, setHistory] = useState<ScheduledOccurrence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unsupported = Boolean(initial && (promptSteps.length > 1 || initial.steps.filter((step) => step.kind === 'action').length > 1 || (actionStep && promptSteps.length > 0) || initial.steps.filter((step) => step.kind === 'tool').length > 1 || initial.steps.filter((step) => step.kind === 'calendar-event' || step.kind === 'chat-message').length > 1));
  useEffect(() => {
    let active = true;
    void Promise.all([
      client.json<{ providers: ProviderDescriptor[] }>('/api/v1/providers'),
      client.json<{ definitions: ToolDefinition[] }>('/api/v1/tools'),
      client.json<{ conversations: { id: string; title: string }[] }>('/api/v1/conversations'),
      initial ? client.json<{ history: ScheduledOccurrence[] }>(`/api/v1/automations/history?automationId=${encodeURIComponent(initial.id)}`) : Promise.resolve({ history: [] })
    ]).then(([p, t, c, h]) => { if (active) { setProviders(p.providers); setTools(t.definitions.filter((tool) => tool.enabled)); setChats(c.conversations); setHistory(h.history); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Automation options could not be loaded.'); });
    return () => { active = false; };
  }, [client, initial]);
  useEffect(() => {
    if (!initial) return;
    let active = true;
    const timer = globalThis.setInterval(() => {
      void client.json<{ history: ScheduledOccurrence[] }>(`/api/v1/automations/history?automationId=${encodeURIComponent(initial.id)}`).then((result) => { if (active) setHistory(result.history); }).catch(() => undefined);
    }, 3000);
    return () => { active = false; globalThis.clearInterval(timer); };
  }, [client, initial]);
  async function save() {
    setError('');
    if (unsupported) { setError('This workflow cannot be edited in this form.'); return; }
    const steps: WorkflowStep[] = [];
    if ((actionStep || prompt.trim()) && (!providerId || !modelId || !models.includes(modelId))) { setError('Choose an available model.'); return; }
    if (actionStep) {
      if (!source.trim()) { setError('Enter source material.'); return; }
      steps.push({ ...actionStep, source, instructions: prompt, providerId, modelId });
    } else if (prompt.trim()) steps.push({ kind: 'prompt', prompt: prompt.trim(), providerId, modelId, modelReference: { providerId, modelId, role: 'chat' } });
    let confirmed = false;
    if (toolId) {
      let input: unknown;
      try { input = JSON.parse(toolInput); } catch { setError('Tool input must be a JSON object.'); return; }
      if (typeof input !== 'object' || input === null || Array.isArray(input)) { setError('Tool input must be a JSON object.'); return; }
      const entries = Object.entries(input);
      steps.push({ kind: 'tool', toolId, input: Object.fromEntries(entries) });
      if (enabled && tools.find((tool) => tool.id === toolId)?.effect === 'mutate') {
        confirmed = await dialogs.confirm({ title: 'Allow this scheduled tool?', message: 'This tool can change data each time the automation runs.', confirmLabel: 'Allow scheduled runs' });
        if (!confirmed) return;
      }
    }
    if (steps.length === 0) { setError('Enter instructions or choose a tool.'); return; }
    if (destination === 'calendar-event') steps.push({ kind: 'calendar-event', calendarPath: calendarPathForListId(calendarId), title: eventTitle.trim() || name.trim(), daysAfterRun, allDay, ...(allDay ? {} : { time: eventTime }) });
    if (destination === 'chat-message') steps.push({ kind: 'chat-message', conversationPath: defaultConversationPath(conversationId) });
    const category = (step: WorkflowStep) => step.kind === 'action' || step.kind === 'prompt' ? 'input' : step.kind === 'calendar-event' || step.kind === 'chat-message' ? 'output' : 'tool';
    const ordered = initial ? initial.steps.flatMap(previous => steps.filter(step => category(step) === category(previous))) : [...steps];
    if (initial) for (const step of steps.filter(item => !initial.steps.some(previous => category(previous) === category(item)))) {
      const outputIndex = ordered.findIndex(item => category(item) === 'output');
      if (category(step) !== 'output' && outputIndex >= 0) ordered.splice(outputIndex, 0, step);
      else ordered.push(step);
    }
    const now = new Date().toISOString();
    const id = initial?.id ?? crypto.randomUUID();
    const definition: AutomationDefinition = { id, path: initial?.path ?? automationRelative(id), name: name.trim(), enabled, steps: ordered,
      recurrence: { frequency, interval, startDate, localTime: time, timezone, weekdays: frequency === 'weekly' ? weekdays : [] }, missedRunPolicy: missed,
      createdAt: initial?.createdAt ?? now, updatedAt: now };
    setBusy(true);
    try { await client.json('/api/v1/automations', { method: 'POST', body: JSON.stringify({ definition, confirmed }) }); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Automation could not be saved.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!initial || !await dialogs.confirm({ title: 'Delete automation', message: 'Stop future runs and delete this automation? Its history and generated events will be retained.', confirmLabel: 'Delete automation', destructive: true })) return;
    setBusy(true);
    try { await client.request(`/api/v1/automations/${encodeURIComponent(initial.id)}`, { method: 'DELETE' }); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Automation could not be deleted.'); }
    finally { setBusy(false); }
  }
  async function cancelRun(id: string) {
    try { await client.request(`/api/v1/automations/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); setHistory((await client.json<{ history: ScheduledOccurrence[] }>(`/api/v1/automations/history?automationId=${encodeURIComponent(initial?.id ?? '')}`)).history); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Run could not be cancelled.'); }
  }
  return <form className="app-dialog-content calendar-automation-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label className="app-dialog-field">Name<Input value={name} required maxLength={120} onChange={(event) => setName(event.target.value)}/></label>
    {actionStep && <label className="app-dialog-field">Source material<TextArea value={source} maxLength={200000} onChange={(event) => setSource(event.target.value)}/></label>}
    <label className="app-dialog-field">{actionStep ? 'Scope and constraints' : 'Instructions'}<TextArea value={prompt} placeholder="What should run at this time?" onChange={(event) => setPrompt(event.target.value)}/></label>
    <div className="calendar-dialog-grid">
      <label className="app-dialog-field">Provider<SelectField value={providerId} onValueChange={(id) => { setProviderId(id); setModelId(''); }}><option value="">Choose a connection</option>{providerId && !providers.some((provider) => provider.id === providerId) && <option value={providerId}>{providerId} (unavailable)</option>}{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.id}</option>)}</SelectField></label>
      <label className="app-dialog-field">Model<SelectField value={modelId} onValueChange={setModelId}><option value="">Choose a model</option>{modelId && !models.includes(modelId) && <option value={modelId}>{modelId} (unavailable)</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}</SelectField></label>
      <DateField label="Start date" value={startDate} onChange={setStartDate}/>
      <label className="app-dialog-field">Run time<Input type="time" required value={time} onChange={(event) => setTime(event.target.value)}/></label>
      <label className="app-dialog-field">Repeats<SelectField value={frequency} onValueChange={(next) => { if (next === 'once' || next === 'daily' || next === 'weekly') setFrequency(next); }}><option value="once">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></SelectField></label>
      {frequency !== 'once' && <label className="app-dialog-field">Every {frequency === 'daily' ? 'days' : 'weeks'}<Input type="number" min={1} max={365} required value={interval} onChange={(event) => setInterval(event.target.valueAsNumber)}/></label>}
    </div>
    {frequency === 'weekly' && <Fieldset className="calendar-weekdays"><Fieldset.Legend>On these days</Fieldset.Legend>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => <Checkbox key={day} isSelected={weekdays.includes(index)} onChange={(checked) => setWeekdays(checked ? [...weekdays, index] : weekdays.filter((value) => value !== index))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{day}</Checkbox.Content></Checkbox>)}</Fieldset>}
    <label className="app-dialog-field">Timezone<Input required value={timezone} onChange={(event) => setTimezone(event.target.value)}/></label>
    <label className="app-dialog-field">If a run is missed<SelectField value={missed} onValueChange={(next) => { if (next === 'skip' || next === 'run-once') setMissed(next); }}><option value="skip">Skip missed runs</option><option value="run-once">Run once after the service restarts</option></SelectField></label>
    <CollapsibleSection title={`Tool step ${toolId ? '· configured' : '(optional)'}`}><label className="app-dialog-field">Tool<SelectField value={toolId} onValueChange={setToolId}><option value="">No tool</option>{tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</SelectField></label>{toolId && <label className="app-dialog-field">Tool input JSON<TextArea value={toolInput} onChange={(event) => setToolInput(event.target.value)}/></label>}</CollapsibleSection>
    <label className="app-dialog-field">Save result to<SelectField value={destination} onValueChange={(next) => { if (next === 'history' || next === 'calendar-event' || next === 'chat-message') setDestination(next); }}><option value="history">Run history</option><option value="calendar-event">A new calendar event</option><option value="chat-message">An existing chat</option></SelectField></label>
    {destination === 'calendar-event' && <Fieldset className="calendar-result-fields"><Fieldset.Legend>Result event</Fieldset.Legend>
      <label className="app-dialog-field">Calendar<SelectField value={calendarId} onValueChange={setCalendarId}><option value="">Choose calendar</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</SelectField></label>
      <label className="app-dialog-field">Event title<Input value={eventTitle} maxLength={200} placeholder={name} onChange={(event) => setEventTitle(event.target.value)}/></label>
      <label className="app-dialog-field">Days after the scheduled run<Input type="number" min={0} max={365} required value={daysAfterRun} onChange={(event) => setDaysAfterRun(event.target.valueAsNumber)}/></label>
      <Checkbox className="method-check" isSelected={allDay} onChange={setAllDay}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>All day</Checkbox.Content></Checkbox>
      {!allDay && <label className="app-dialog-field">Event time<Input type="time" required value={eventTime} onChange={(event) => setEventTime(event.target.value)}/></label>}
      <p className="method-hint">Each successful run creates one event. Its description contains up to 5,000 characters of the last result; longer results remain in run history.</p>
    </Fieldset>}
    {destination === 'chat-message' && <label className="app-dialog-field">Chat<SelectField value={conversationId} onValueChange={setConversationId}><option value="">Choose chat</option>{chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</SelectField></label>}
    <Checkbox className="method-check" isSelected={enabled} onChange={setEnabled}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Automation enabled</Checkbox.Content></Checkbox>
    <p className="method-hint">Runs while AIR Office’s service is running. Results are always retained in run history.</p>
    {unsupported && <p role="alert">This workflow has multiple prompt, tool or result steps. Saving here is disabled to preserve those steps.</p>}
    {history.length > 0 && <CollapsibleSection className="slice-tool" title={`Run history · ${history.length}`}>{history.map((run) => <CollapsibleSection className="slice-tool" key={run.id} title={`${new Date(run.scheduledAt).toLocaleString()} · ${run.state}`}>{run.error && <p>{run.error}</p>}{run.completedSteps.map((step, index) => <pre key={index}>{typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}</pre>)}{run.state === 'started' && run.jobId && <Button variant="danger-soft" size="sm" onPress={() => void cancelRun(run.jobId!)}>Cancel run</Button>}</CollapsibleSection>)}</CollapsibleSection>}
    {error && <p role="alert" className="calendar-feedback">{error}</p>}
    <Modal.Footer>{initial && <Button variant="danger" isDisabled={busy} onPress={() => void remove()}>Delete</Button>}<Button variant="secondary" isDisabled={busy} onPress={onCancel}>Cancel</Button><Button type="submit" isDisabled={busy || unsupported}>{busy ? 'Saving…' : initial ? 'Save automation' : 'Create automation'}</Button></Modal.Footer>
  </form>;
}
