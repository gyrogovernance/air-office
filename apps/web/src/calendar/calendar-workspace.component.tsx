import { useCallback, useEffect, useMemo, useState } from 'react';
import { monthGridDays, weekDays, eventsOnDays, validateCalendarEvent, validCalendarDate } from '@office/calendar/domain';
import type { CalendarEvent, CalendarList } from '@office/calendar/domain';
import type { AutomationDefinition } from '@office/automations/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';
import { DateField } from '../shared/date-field.component';
import { SelectField } from '../shared/select-field.component';
import { CalendarAutomationForm } from './calendar-automation-form.component';
import { Button, Checkbox, ColorSwatchPicker, Dropdown, Input, Modal, Switch, Tabs, TextArea } from '@heroui/react';

/**
 * The Calendar stage surface (CHAT-196..200).
 *
 * Lists, events and reminders live in the service store; the grid is a view
 * over it. Automation schedules surface as read-only events through their
 * automation id (CHAT-200), so editing a schedule stays in one place.
 */

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  const minute = String((index % 4) * 15).padStart(2, '0');
  return `${hour}:${minute}`;
});
const REMINDER_OPTIONS = [
  { value: '', label: 'No reminder' },
  { value: '0', label: 'At time of event' },
  { value: '5', label: '5 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '1440', label: '1 day before' }
];
const CALENDAR_COLORS = ['#3478db', '#168879', '#bd7520', '#8457c6', '#b14b4b'];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}

/** Shared request error text so every failure names the recovery path. */
function describe(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/** A draft is what the dialog edits; `null` closes it. */
type EventDraft = {
  id: string | null;
  calendarId: string;
  title: string;
  date: string;
  allDay: boolean;
  time: string;
  location: string;
  description: string;
  recurrence: 'none' | 'daily' | 'weekly';
  recurrenceInterval: number;
  reminderMinutes: string;
  automationId?: string;
};

type DialogState =
  | { mode: 'closed' }
  | { mode: 'event'; draft: EventDraft; isAutomation: boolean }
  | { mode: 'calendar-list'; name: string; color: string; editingId: string | null };

function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    date: event.date,
    allDay: event.allDay,
    time: event.time ?? '09:00',
    location: event.location ?? '',
    description: event.description ?? '',
    recurrence: event.recurrence && event.recurrence.frequency !== 'once' ? event.recurrence.frequency : 'none',
    recurrenceInterval: event.recurrence?.interval ?? 1,
    reminderMinutes: event.reminderMinutes === undefined ? '' : String(event.reminderMinutes),
    automationId: event.automationId
  };
}

function blankDraft(calendarId: string, date: string): EventDraft {
  return {
    id: null, calendarId, title: '', date, allDay: false, time: '09:00',
    location: '', description: '', recurrence: 'none', recurrenceInterval: 1, reminderMinutes: ''
  };
}

/** Projects an event onto a visible day, resolving recurring events to that day. */
function eventOnDay(event: CalendarEvent, day: string): CalendarEvent {
  if (!event.recurrence || event.date === day) return event;
  return { ...event, date: day };
}

export function CalendarWorkspace({ client, initialDate, appearance: _appearance }: {
  client: ServiceClient;
  initialDate?: string;
  appearance: 'light' | 'dark';
}) {
  const dialogs = useAppDialogs();
  const [lists, setLists] = useState<CalendarList[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [automations, setAutomations] = useState<AutomationDefinition[]>([]);
  const [view, setView] = useState<'month' | 'week' | 'year'>('month');
  const safeInitialDate = initialDate && validCalendarDate(initialDate) ? initialDate : undefined;
  const [cursor, setCursor] = useState<string>(() => safeInitialDate ?? todayIso());
  const [selectedDate, setSelectedDate] = useState<string>(() => safeInitialDate ?? todayIso());
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (safeInitialDate) { setCursor(safeInitialDate); setSelectedDate(safeInitialDate); } }, [safeInitialDate]);

  const refresh = useCallback(async () => {
    try {
      const [listsResult, eventsResult, automationsResult] = await Promise.all([
        client.json<{ lists: CalendarList[] }>('/api/v1/calendar/lists'),
        client.json<{ events: CalendarEvent[] }>('/api/v1/calendar/events'),
        client.json<{ automations: AutomationDefinition[] }>('/api/v1/automations')
      ]);
      setLists(listsResult.lists);
      setEvents(eventsResult.events);
      setAutomations(automationsResult.automations);
      setError('');
    } catch (reason) { setError(describe(reason, 'The calendar could not be loaded.')); }
    finally { setLoading(false); }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (dialog.mode !== 'closed') return;
    const reload = () => { if (!document.hidden) void refresh(); };
    const timer = globalThis.setInterval(reload, 10_000);
    window.addEventListener('focus', reload);
    return () => { globalThis.clearInterval(timer); window.removeEventListener('focus', reload); };
  }, [refresh, dialog.mode]);

  const visibleEvents = useMemo(() => {
    const personal = events.filter((event) => (!event.automationId || event.automationOccurrenceId || !automations.some((item) => item.id === event.automationId)) && lists.find((list) => list.id === event.calendarId)?.visible !== false);
    const projected: CalendarEvent[] = automations.filter((item) => item.enabled).map((item) => ({
      id: `automation:${item.id}`, automationId: item.id, calendarId: 'automation-schedules', title: item.name,
      date: item.recurrence.startDate, time: item.recurrence.localTime, timezone: item.recurrence.timezone,
      allDay: false, recurrence: item.recurrence, createdAt: item.createdAt, updatedAt: item.updatedAt,
      description: item.steps.map((step) => step.kind === 'prompt' ? step.prompt : step.kind === 'action' ? 'Action' : step.kind === 'tool' ? `Tool: ${step.toolId}` : step.kind === 'calendar-event' ? `Creates event: ${step.title}` : 'Saves result to a chat').join('\n')
    }));
    return [...personal, ...projected];
  }, [events, lists, automations]);

  const days: { date: string; inMonth: boolean }[] = useMemo(() => view === 'month' ? monthGridDays(...monthOf(cursor)) : weekDays(cursor).map((date) => ({ date, inMonth: true })), [view, cursor]);
  const placed = useMemo(() => eventsOnDays(visibleEvents, days.map((day) => day.date)), [visibleEvents, days]);

  const monthTitle = useMemo(() => {
    const [year, month] = monthOf(cursor);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [cursor]);

  const weekTitle = useMemo(() => {
    const dates = weekDays(cursor);
    const format = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${format(dates[0]!)} – ${format(dates[6]!)}, ${monthOf(dates[6]!)[0]}`;
  }, [cursor]);

  const selectedEvents = useMemo(() => eventsOnDays(visibleEvents, [selectedDate]).get(selectedDate) ?? [], [visibleEvents, selectedDate]);

  async function saveList(name: string, color: string, editingId: string | null) {
    const now = new Date().toISOString();
    const existing = editingId ? lists.find((list) => list.id === editingId) : undefined;
    const list: CalendarList = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      color,
      visible: existing?.visible ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (!validateCalendarListLocal(list)) { setError('Enter a calendar name.'); return; }
    try {
      await client.json('/api/v1/calendar/lists', { method: 'POST', body: JSON.stringify({ list }) });
      setDialog({ mode: 'closed' });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The calendar could not be saved.')); }
  }

  async function toggleList(list: CalendarList) {
    const now = new Date().toISOString();
    try {
      await client.json('/api/v1/calendar/lists', { method: 'POST', body: JSON.stringify({ list: { ...list, visible: !list.visible, updatedAt: now } }) });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The calendar could not be updated.')); }
  }

  async function toggleAutomation(item: AutomationDefinition, enabled: boolean) {
    let confirmed = false;
    if (enabled && item.steps.some((step) => step.kind === 'tool')) {
      confirmed = await dialogs.confirm({
        title: 'Allow this scheduled tool?',
        message: 'This tool can change data each time the automation runs.',
        confirmLabel: 'Allow scheduled runs'
      });
      if (!confirmed) return;
    }
    const definition: AutomationDefinition = { ...item, enabled, updatedAt: new Date().toISOString() };
    try {
      await client.json('/api/v1/automations', { method: 'POST', body: JSON.stringify({ definition, confirmed }) });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The automation could not be updated.')); }
  }

  async function removeList(list: CalendarList) {
    const approved = await dialogs.confirm({
      title: 'Delete calendar',
      message: `Delete "${list.name}" and its events? This cannot be undone.`,
      confirmLabel: 'Delete calendar',
      destructive: true
    });
    if (!approved) return;
    try {
      await client.request(`/api/v1/calendar/lists/${encodeURIComponent(list.id)}`, { method: 'DELETE' });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The calendar could not be deleted.')); }
  }

  async function saveEvent(draft: EventDraft) {
    const now = new Date().toISOString();
    const existing = draft.id ? events.find((event) => event.id === draft.id) : undefined;
    if (existing?.automationId && !existing.automationOccurrenceId) return;
    if (!draft.title.trim()) { setError('Enter a title for the event.'); return; }
    if (!validCalendarDate(draft.date)) { setError('Enter a valid date.'); return; }
    const timezone = existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const event: CalendarEvent = {
      id: existing?.id ?? crypto.randomUUID(),
      calendarId: draft.calendarId,
      title: draft.title.trim(),
      date: draft.date,
      allDay: draft.allDay,
      time: draft.allDay ? undefined : draft.time,
      timezone,
      location: draft.location.trim() || undefined,
      description: draft.description.trim() || undefined,
      recurrence: draft.recurrence === 'none' ? undefined : {
        frequency: draft.recurrence,
        interval: Math.max(1, Math.min(365, Math.floor(draft.recurrenceInterval) || 1)),
        weekdays: draft.recurrence === 'weekly' ? [new Date(`${draft.date}T00:00:00Z`).getUTCDay()] : [],
        localTime: draft.allDay ? (existing?.recurrence?.localTime ?? draft.time) : draft.time,
        timezone,
        startDate: existing?.recurrence?.startDate ?? draft.date
      },
      reminderMinutes: draft.reminderMinutes === '' ? undefined : Number(draft.reminderMinutes),
      automationId: existing?.automationId,
      automationOccurrenceId: existing?.automationOccurrenceId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    try {
      await client.json('/api/v1/calendar/events', { method: 'POST', body: JSON.stringify({ event }) });
      setDialog({ mode: 'closed' });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The event could not be saved.')); }
  }

  async function removeEvent(event: CalendarEvent) {
    if (event.automationId && !event.automationOccurrenceId) {
      openEdit(event);
      return;
    }
    const approved = await dialogs.confirm({ title: 'Delete event', message: `Delete "${event.title}"?`, confirmLabel: 'Delete event', destructive: true });
    if (!approved) return;
    try {
      await client.request(`/api/v1/calendar/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' });
      setDialog({ mode: 'closed' });
      await refresh();
    } catch (reason) { setError(describe(reason, 'The event could not be deleted.')); }
  }

  function openCreate(day: string) {
    const calendarId = lists.find((list) => list.visible)?.id ?? lists[0]?.id ?? '';
    setDialog({ mode: 'event', draft: blankDraft(calendarId, day), isAutomation: false });
  }

  function openEdit(event: CalendarEvent) {
    setDialog({ mode: 'event', draft: draftFromEvent(event), isAutomation: Boolean(event.automationId && !event.automationOccurrenceId) });
  }

  function shift(days: number) {
    const base = new Date(`${cursor}T00:00:00Z`);
    if (view === 'week') base.setUTCDate(base.getUTCDate() + days * 7);
    else {
      base.setUTCDate(1);
      base.setUTCMonth(base.getUTCMonth() + days * (view === 'year' ? 12 : 1));
    }
    setCursor(base.toISOString().slice(0, 10));
  }

  return <section className="calendar-workspace" aria-label="Calendar">
    <header className="calendar-header">
      <h2>{view === 'year' ? monthOf(cursor)[0] : view === 'week' ? weekTitle : monthTitle}</h2>
      <Tabs className="calendar-view-tabs" selectedKey={view} onSelectionChange={(key) => { if (key === 'week' || key === 'month' || key === 'year') setView(key); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Calendar view">
            <Tabs.Tab id="week" className="whitespace-nowrap">Week<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="month" className="whitespace-nowrap">Month<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="year" className="whitespace-nowrap">Year<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      <Button className="calendar-create-button" size="sm" onPress={() => openCreate(selectedDate)}>New event</Button>
    </header>
      <div className="calendar-title-group">
        <div className="calendar-nav" role="group" aria-label="Calendar navigation">
          <Button isIconOnly variant="tertiary" size="sm" aria-label="Previous period" onPress={() => shift(-1)}><ChevronIcon flip/></Button>
          <Button variant="tertiary" size="sm" aria-label="Jump to today" onPress={() => { setCursor(todayIso()); setSelectedDate(todayIso()); }}>Today</Button>
          <Button isIconOnly variant="tertiary" size="sm" aria-label="Next period" onPress={() => shift(1)}><ChevronIcon/></Button>
        </div>
      </div>
    {error && <div className="calendar-feedback" role="alert">{error}<Button isIconOnly variant="ghost" size="sm" aria-label="Dismiss calendar error" onPress={() => setError('')}>×</Button></div>}
    <div className="calendar-layout">
      <aside className="calendar-sidebar" aria-label="Calendar lists">
        <h3>Calendars</h3>
        {lists.map((list) => <div className="calendar-list-row" key={list.id}>
          <Checkbox aria-label={`Show ${list.name}`} isSelected={list.visible} onChange={() => void toggleList(list)}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
          <span className="calendar-dot" style={{ background: list.color }} aria-hidden="true"/>
          <span className="calendar-list-name">{list.name}</span>
          <Dropdown>
            <Button className="calendar-list-actions" isIconOnly variant="ghost" size="sm" aria-label={`Actions for ${list.name}`}>⋯</Button>
            <Dropdown.Popover className="calendar-list-menu-popover" placement="bottom end">
              <Dropdown.Menu aria-label={`Actions for ${list.name}`} onAction={(key) => {
                if (key === 'edit') setDialog({ mode: 'calendar-list', name: list.name, color: list.color, editingId: list.id });
                if (key === 'delete') void removeList(list);
              }}>
                <Dropdown.Item id="edit" textValue="Edit calendar">Edit calendar</Dropdown.Item>
                <Dropdown.Item id="delete" textValue="Delete calendar">Delete calendar</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>)}
        {lists.length === 0 && !loading && <p className="calendar-empty">Create a calendar to start scheduling.</p>}
        <Button variant="secondary" size="sm" onPress={() => setDialog({ mode: 'calendar-list', name: '', color: CALENDAR_COLORS[0]!, editingId: null })}>New calendar</Button>
        {automations.length > 0 && <section className="calendar-saved-automations" aria-label="Automations"><h3>Automations</h3>{automations.map((item) => <div className="calendar-automation-row" key={item.id}>
          <button type="button" className="calendar-automation-open" onClick={() => setDialog({ mode: 'event', draft: { ...blankDraft('', item.recurrence.startDate), automationId: item.id }, isAutomation: true })}>
            <span className="calendar-automation-name">{item.name}</span>
          </button>
          <div className="calendar-automation-meta">
            <small>{item.recurrence.localTime}</small>
            <Switch size="sm" aria-label={item.enabled ? `Pause ${item.name}` : `Resume ${item.name}`} isSelected={item.enabled} onChange={(next) => void toggleAutomation(item, next)}>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch>
          </div>
        </div>)}</section>}
        <div className="calendar-sidebar-month">
          <MiniMonth year={monthOf(cursor)[0]} month={monthOf(cursor)[1]} selectedDate={selectedDate} onSelect={(date) => { setCursor(date); setSelectedDate(date); if (view === 'year') setView('month'); }}/>
        </div>
      </aside>
      <div className="calendar-main">
        {view !== 'year' && <div className="calendar-grid-head" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>}
        {view === 'year' ? <div className="calendar-year" aria-label={`${monthOf(cursor)[0]} calendar`}>
          {Array.from({ length: 12 }, (_, index) => {
            const year = monthOf(cursor)[0];
            return <MiniMonth key={index} year={year} month={index + 1} selectedDate={selectedDate} onSelect={(date) => { setCursor(date); setSelectedDate(date); setView('month'); }}/>;
          })}
        </div> : view === 'month' ? <div className="calendar-grid" role="grid" aria-label={`${monthTitle} events`}>
          {days.map(({ date, inMonth }) => <CalendarDayCell
            key={date} date={date} inMonth={inMonth} selected={date === selectedDate} today={date === todayIso()}
            events={placed.get(date) ?? []} lists={lists}
            onSelect={() => setSelectedDate(date)} onCreate={() => openCreate(date)} onOpen={openEdit}
          />)}
        </div> : <div className="calendar-week" role="grid" aria-label="Week events">
          {days.map(({ date }) => <CalendarWeekColumn
            key={date} date={date} selected={date === selectedDate} today={date === todayIso()}
            events={placed.get(date) ?? []} lists={lists}
            onSelect={() => setSelectedDate(date)} onCreate={() => openCreate(date)} onOpen={openEdit}
          />)}
        </div>}
        <section className="calendar-day-panel" aria-label={`Events on ${selectedDate}`}>
          <h3>{new Date(`${selectedDate}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}</h3>
          {selectedEvents.length === 0 && <p className="calendar-empty">No events on this day.</p>}
          {selectedEvents.map((event) => <EventRow key={`${event.id}:${event.date}`} event={event} list={lists.find((list) => list.id === event.calendarId)} onOpen={() => openEdit(event)} onDelete={() => void removeEvent(event)}/>)}
          <Button variant="secondary" size="sm" onPress={() => openCreate(selectedDate)}>Add event on this day</Button>
        </section>
      </div>
    </div>
    {dialog.mode === 'event' && <EventDialog
      draft={dialog.draft} isAutomation={dialog.isAutomation} lists={lists}
      onCancel={() => setDialog({ mode: 'closed' })}
      client={client} automations={automations}
      onSaved={() => { setDialog({ mode: 'closed' }); void refresh(); }}
      onSave={(draft) => void saveEvent(draft)} onDelete={(event) => void removeEvent(event)}
      events={events}
    />}
    {dialog.mode === 'calendar-list' && <CalendarListDialog
      name={dialog.name} color={dialog.color} editingId={dialog.editingId}
      onCancel={() => setDialog({ mode: 'closed' })}
      onSave={(name, color) => void saveList(name, color, dialog.editingId)}
    />}
  </section>;
}

function MiniMonth({ year, month, selectedDate, onSelect }: { year: number; month: number; selectedDate: string; onSelect: (date: string) => void }) {
  const title = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
  const firstDate = `${year}-${String(month).padStart(2, '0')}-01`;
  return <section className="calendar-year-month" aria-label={`${title} ${year}`}>
    <button type="button" className="calendar-month-title" onClick={() => onSelect(firstDate)}>{title}</button>
    <div className="calendar-mini-grid">
      {WEEKDAY_LABELS.map((label) => <span className="calendar-mini-weekday" key={label} aria-hidden="true">{label.slice(0, 1)}</span>)}
      {monthGridDays(year, month).map(({ date, inMonth }) => <button type="button" key={date} className={`calendar-mini-day${inMonth ? '' : ' is-outside'}${date === todayIso() ? ' is-today' : ''}${date === selectedDate ? ' is-selected' : ''}`} aria-label={date} aria-pressed={date === selectedDate} aria-current={date === todayIso() ? 'date' : undefined} onClick={() => onSelect(date)}>{Number(date.slice(-2))}</button>)}
    </div>
  </section>;
}

function monthOf(iso: string): [number, number] {
  const [year, month] = iso.split('-').map(Number);
  return [year!, month!];
}

function CalendarDayCell({ date, inMonth, selected, today, events, lists, onSelect, onCreate, onOpen }: {
  date: string; inMonth: boolean; selected: boolean; today: boolean;
  events: CalendarEvent[]; lists: CalendarList[];
  onSelect: () => void; onCreate: () => void; onOpen: (event: CalendarEvent) => void;
}) {
  return <div role="gridcell" className={`calendar-cell ${inMonth ? '' : 'is-outside'} ${selected ? 'is-selected' : ''} ${today ? 'is-today' : ''}`} aria-selected={selected} aria-label={`${new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}, ${events.length} event${events.length === 1 ? '' : 's'}`}>
    <button type="button" className="calendar-cell-day" onClick={onSelect} onDoubleClick={onCreate} aria-label={`Select ${date}`}>{Number(date.slice(-2))}</button>
    {events.slice(0, 3).map((event) => <EventChip key={`${event.id}:${event.date}`} event={event} list={lists.find((list) => list.id === event.calendarId)} onOpen={onOpen}/>)}
    {events.length > 3 && <span className="calendar-more">+{events.length - 3} more</span>}
  </div>;
}

function CalendarWeekColumn({ date, selected, today, events, lists, onSelect, onCreate, onOpen }: {
  date: string; selected: boolean; today: boolean;
  events: CalendarEvent[]; lists: CalendarList[];
  onSelect: () => void; onCreate: () => void; onOpen: (event: CalendarEvent) => void;
}) {
  const day = new Date(`${date}T00:00:00Z`);
  return <div role="gridcell" className={`calendar-week-col ${selected ? 'is-selected' : ''} ${today ? 'is-today' : ''}`} aria-selected={selected}>
    <button type="button" className="calendar-week-heading" onClick={onSelect} onDoubleClick={onCreate} aria-label={`Select ${date}`}>
      <span className="calendar-cell-day">{day.getUTCDate()}</span>
      <span className="calendar-week-weekday">{day.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</span>
    </button>
    {events.map((event) => <EventChip key={`${event.id}:${event.date}`} event={event} list={lists.find((list) => list.id === event.calendarId)} onOpen={onOpen}/>)}
    <button type="button" className="calendar-week-add" aria-label={`Add event on ${date}`} onClick={onCreate}>+</button>
  </div>;
}

function EventChip({ event, list, onOpen }: { event: CalendarEvent; list?: CalendarList; onOpen: (event: CalendarEvent) => void }) {
  return <button type="button" className="calendar-chip" style={{ borderColor: list?.color }} onClick={() => onOpen(event)} title={`${event.title}${event.location ? ` · ${event.location}` : ''}`}>
    <span className="calendar-chip-dot" style={{ background: list?.color }} aria-hidden="true"/>
    <span className="calendar-chip-label">{event.allDay ? 'All day' : event.time} · {event.title}</span>
    {event.automationId && <span className="calendar-chip-badge" aria-label="Automation schedule">auto</span>}
  </button>;
}

function EventRow({ event, list, onOpen, onDelete }: { event: CalendarEvent; list?: CalendarList; onOpen: () => void; onDelete: () => void }) {
  return <div className="calendar-event-row">
    <span className="calendar-dot" style={{ background: list?.color }} aria-hidden="true"/>
    <button type="button" className="calendar-event-main" onClick={onOpen} aria-label={`Edit ${event.title}`}>
      <span className="calendar-event-time">{event.allDay ? 'All day' : `${event.time}${event.reminderMinutes !== undefined ? ` · reminder ${REMINDER_OPTIONS.find((option) => option.value === String(event.reminderMinutes))?.label ?? `${event.reminderMinutes} min before`}` : ''}`}</span>
      <span className="calendar-event-title">{event.title}{event.recurrence ? ' · repeats' : ''}{event.automationId ? ' · automation' : ''}</span>
      {event.location && <span className="calendar-event-location">{event.location}</span>}
      {event.description && <span className="calendar-event-description">{event.description}</span>}
    </button>
    {(!event.automationId || event.automationOccurrenceId) && <Button variant="ghost" size="sm" aria-label={`Delete ${event.title}`} onPress={onDelete}>Delete</Button>}
  </div>;
}

/** Regular events and automation definitions retain separate drafts in one dialog. */
function EventDialog({ draft, isAutomation, lists, events, onSave, onDelete, onCancel, client, automations, onSaved }: {
  draft: EventDraft; isAutomation: boolean; lists: CalendarList[]; events: CalendarEvent[];
  onSave: (draft: EventDraft) => void; onDelete: (event: CalendarEvent) => void; onCancel: () => void;
  client: ServiceClient; automations: AutomationDefinition[]; onSaved: () => void;
}) {
  const [value, setValue] = useState(isAutomation ? { ...draft, id: null, automationId: undefined, calendarId: lists[0]?.id ?? '' } : draft);
  const [mode, setMode] = useState<'regular' | 'automations'>(isAutomation ? 'automations' : 'regular');
  const existing = draft.id ? events.find((event) => event.id === draft.id) : undefined;
  const patch = (next: Partial<EventDraft>) => setValue((current) => ({ ...current, ...next }));
  return <Modal isOpen onOpenChange={(open) => { if (!open) onCancel(); }}><Modal.Backdrop><Modal.Container><Modal.Dialog aria-labelledby="calendar-dialog-title">
    <header className="calendar-modal-header"><Modal.Heading id="calendar-dialog-title">{mode === 'automations' ? draft.automationId ? 'Edit automation' : 'New automation' : value.id ? 'Edit event' : 'New event'}</Modal.Heading>
      <Tabs selectedKey={mode} onSelectionChange={(key) => { if (key === 'regular' || key === 'automations') setMode(key); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Event type">
            <Tabs.Tab id="regular" className="whitespace-nowrap">Regular<Tabs.Indicator /></Tabs.Tab>
            <Tabs.Tab id="automations" className="whitespace-nowrap">Automations<Tabs.Indicator /></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </header>
    <div hidden={mode !== 'regular'}>
    <form className="app-dialog-content" onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
      {lists.length === 0 && <p role="alert">Create a calendar from the sidebar to save a regular event.</p>}
      <label className="app-dialog-field" htmlFor="event-title">Title
        <Input id="event-title" value={value.title} onChange={(event) => patch({ title: event.target.value })}/>
      </label>
      <div className="calendar-dialog-grid">
        <DateField label="Date" value={value.date} onChange={(date) => patch({ date })}/>
        <label className="app-dialog-field" htmlFor="event-time">Time
          <Input id="event-time" type="time" value={value.allDay ? '' : value.time} disabled={value.allDay} onChange={(event) => patch({ time: event.target.value })}/>
        </label>
      </div>
      <div className="method-check" title="An all-day event has no specific time."><Checkbox isSelected={value.allDay} onChange={(checked) => patch({ allDay: checked })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>All day</Checkbox.Content></Checkbox></div>
      <div className="calendar-dialog-grid">
        <label className="app-dialog-field" htmlFor="event-recurrence">Repeats
          <SelectField id="event-recurrence" value={value.recurrence} onValueChange={(recurrence) => { if (recurrence === 'none' || recurrence === 'daily' || recurrence === 'weekly') patch({ recurrence }); }}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </SelectField>
        </label>
        <label className="app-dialog-field" htmlFor="event-reminder">Reminder
          <SelectField id="event-reminder" value={value.reminderMinutes} onValueChange={(reminderMinutes) => patch({ reminderMinutes })}>
            {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
        </label>
      </div>
      <label className="app-dialog-field" htmlFor="event-location">Location
        <Input id="event-location" value={value.location} onChange={(event) => patch({ location: event.target.value })}/>
      </label>
      <label className="app-dialog-field" htmlFor="event-description">Description
        <TextArea id="event-description" value={value.description} onChange={(event) => patch({ description: event.target.value })}/>
      </label>
      <label className="app-dialog-field" htmlFor="event-calendar">Calendar
        <SelectField id="event-calendar" value={value.calendarId} onValueChange={(calendarId) => patch({ calendarId })}>
          {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
        </SelectField>
      </label>
      <Modal.Footer>
        {existing && !isAutomation && <Button variant="danger" onPress={() => onDelete(existing)}>Delete</Button>}
        <Button variant="secondary" onPress={onCancel}>Cancel</Button>
        <Button type="submit" isDisabled={!value.calendarId}>{value.id ? 'Save' : 'Create'}</Button>
      </Modal.Footer>
    </form></div>
    <div hidden={mode !== 'automations'}><CalendarAutomationForm client={client} initial={automations.find((item) => item.id === draft.automationId)} date={value.date} title={value.title} lists={lists} onSaved={onSaved} onCancel={onCancel}/></div>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function CalendarListDialog({ name, color, editingId, onSave, onCancel }: {
  name: string; color: string; editingId: string | null;
  onSave: (name: string, color: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState({ name, color });
  return <Modal isOpen onOpenChange={(open) => { if (!open) onCancel(); }}><Modal.Backdrop><Modal.Container size="sm" placement="center"><Modal.Dialog className="calendar-list-dialog" aria-labelledby="calendar-list-title">
    <form onSubmit={(event) => { event.preventDefault(); onSave(value.name, value.color); }}>
      <Modal.Header><Modal.Heading id="calendar-list-title">{editingId ? 'Edit calendar' : 'New calendar'}</Modal.Heading></Modal.Header>
      <Modal.Body className="calendar-list-dialog-body">
        <label className="app-dialog-field" htmlFor="calendar-list-name">Name
          <Input id="calendar-list-name" value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))}/>
        </label>
        <div className="app-dialog-field calendar-colors">
          <span id="calendar-list-color-label">Color</span>
          <ColorSwatchPicker
            aria-labelledby="calendar-list-color-label"
            className="calendar-color-swatches"
            size="md"
            value={value.color}
            onChange={(next) => setValue((current) => ({ ...current, color: next.toString('hex') }))}
          >
            {CALENDAR_COLORS.map((option) => <ColorSwatchPicker.Item key={option} color={option}>
              <ColorSwatchPicker.Swatch />
              <ColorSwatchPicker.Indicator />
            </ColorSwatchPicker.Item>)}
          </ColorSwatchPicker>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onPress={onCancel}>Cancel</Button>
        <Button type="submit">{editingId ? 'Save' : 'Create'}</Button>
      </Modal.Footer>
    </form>
  </Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>;
}

function ChevronIcon({ flip }: { flip?: boolean }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}><path d="m9 6 6 6-6 6"/></svg>;
}

/** Local mirror of list validation so a fresh dialog reports before a round trip. */
function validateCalendarListLocal(list: CalendarList): boolean {
  return list.name.length > 0 && list.name.length <= 120 && /^#[0-9a-fA-F]{6}$/.test(list.color);
}
