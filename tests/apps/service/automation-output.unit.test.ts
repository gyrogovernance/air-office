import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultCalendarStore } from '@office/calendar/store';
import { createVaultConversationStore } from '@office/chat/service';
import { createJobsService, createSqliteJobStore } from '@office/jobs/service';
import { createAutomationsService, createVaultAutomationStore } from '@office/automations/service';
import type { AutomationDefinition } from '@office/automations/domain';
import { automationRelative, calendarPathForListId, defaultConversationPath } from '@office/vault/domain';
import { writeAutomationOutput } from '../../../apps/service/src/automation-output.adapter';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'air-calendar-output-'));
  process.env.AIR_VAULT_ROOT = path;
  cleanup.push(() => rmSync(path, { recursive: true, force: true }));
  const calendar = createVaultCalendarStore(path);
  const conversations = createVaultConversationStore(path);
  const jobs = createJobsService(createSqliteJobStore(join(path, 'jobs.sqlite')));
  const store = createVaultAutomationStore({ vaultRoot: path, occurrencesPath: join(path, '.air', 'runtime', 'automations.sqlite') });
  cleanup.push(() => { store.close(); jobs.close(); conversations.close(); calendar.close(); });
  const at = '2026-10-15T22:30:00.000Z';
  calendar.saveList({ id: 'work', name: 'Work', color: '#3478db', visible: true, createdAt: at, updatedAt: at });
  return { path, calendar, conversations, jobs, store, at };
}

function definition(at: string): AutomationDefinition {
  return {
    id: 'workflow',
    path: automationRelative('workflow'),
    name: 'Review',
    enabled: true,
    recurrence: { frequency: 'daily', interval: 1, localTime: '01:30', timezone: 'Europe/Athens', startDate: '2026-10-16', weekdays: [] },
    missedRunPolicy: 'skip',
    steps: [
      { kind: 'prompt', prompt: 'Plan tomorrow.', providerId: 'selected-provider', modelId: 'selected-model' },
      { kind: 'calendar-event', calendarPath: calendarPathForListId('work'), title: 'Review result', daysAfterRun: 2, allDay: false, time: '15:00' },
    ],
    createdAt: at,
    updatedAt: at,
  };
}

test('a scheduled run publishes one durable calendar event with its result, local date and provenance', async () => {
  const f = fixture();
  const config = definition(f.at);
  let calls = 0;
  const service = createAutomationsService(f.store, f.jobs, { run: async (step, signal, context) => {
    expect(signal.aborted).toBe(false);
    if (step.kind === 'prompt') { calls++; expect(step.providerId).toBe('selected-provider'); expect(step.modelId).toBe('selected-model'); return 'Bring the report.'; }
    if (step.kind === 'calendar-event' || step.kind === 'chat-message') return writeAutomationOutput(step, context, f.calendar, f.conversations);
    throw new Error('Unexpected tool');
  } });
  const saved = service.save(config);
  const occurrence = f.store.ensureOccurrence(saved.path, f.at, f.at);
  await Promise.all([service.tick(new Date('2026-10-15T22:30:08Z')), service.tick(new Date('2026-10-15T22:30:08Z'))]);
  for (let attempt = 0; attempt < 100 && f.store.history().find((item) => item.id === occurrence.id)?.state !== 'succeeded'; attempt++) await Bun.sleep(5);
  expect(f.store.history().find((item) => item.id === occurrence.id)?.state).toBe('succeeded');
  expect(calls).toBe(1);
  const [event] = f.calendar.events();
  expect(f.calendar.events()).toHaveLength(1);
  expect(event).toMatchObject({ title: 'Review result', date: '2026-10-18', time: '15:00', timezone: 'Europe/Athens', description: 'Bring the report.', automationId: 'workflow', automationOccurrenceId: occurrence.id });
  const reopened = createVaultCalendarStore(f.path);
  expect(reopened.events()).toEqual(f.calendar.events());
  reopened.close();
  const reopenedAutomations = createVaultAutomationStore({ vaultRoot: f.path, occurrencesPath: join(f.path, '.air', 'runtime', 'automations.sqlite') });
  expect(reopenedAutomations.get(config.id)).toEqual(saved);
  reopenedAutomations.close();
  const step = config.steps[1];
  if (!step || step.kind !== 'calendar-event') throw new Error('Missing result step');
  writeAutomationOutput(step, { automation: saved, occurrence, stepIndex: 1, completedSteps: [{ step: config.steps[0]!, result: 'Duplicate attempt' }] }, f.calendar, f.conversations);
  expect(f.calendar.events()).toHaveLength(1);
  expect(f.calendar.events()[0]?.description).toBe('Bring the report.');
  expect(f.store.history().find((item) => item.id === occurrence.id)?.completedSteps.at(-1)?.result).toEqual({ eventId: event!.id, calendarPath: calendarPathForListId('work') });
});

test('chat results append once to the chosen conversation and mark it unread', () => {
  const f = fixture();
  const config = definition(f.at);
  f.conversations.ensure('chosen-chat');
  const occurrence = f.store.ensureOccurrence(config.path, f.at, f.at);
  const context = { automation: config, occurrence, stepIndex: 1, completedSteps: [{ step: config.steps[0]!, result: 'Scheduled briefing' }] };
  const step = { kind: 'chat-message' as const, conversationPath: defaultConversationPath('chosen-chat') };
  writeAutomationOutput(step, context, f.calendar, f.conversations);
  writeAutomationOutput(step, context, f.calendar, f.conversations);
  expect(f.conversations.load('chosen-chat')?.messages.map((message) => message.content)).toEqual(['Scheduled briefing']);
  expect(f.conversations.load('chosen-chat')?.conversation.unreadAt).not.toBeNull();
});

test('editing, pausing and deleting schedules retire pending occurrences and retain generated events', () => {
  const f = fixture();
  const config = definition(f.at);
  f.store.save(config);
  const old = f.store.ensureOccurrence(config.path, '2026-10-18T22:30:00Z', f.at);
  f.store.save({ ...config, recurrence: { ...config.recurrence, localTime: '12:00' } });
  expect(f.store.history().find((item) => item.id === old.id)?.state).toBe('skipped');
  const next = f.store.ensureOccurrence(config.path, '2026-10-19T09:00:00Z', f.at);
  f.store.save({ ...config, enabled: false });
  expect(f.store.history().find((item) => item.id === next.id)?.state).toBe('skipped');
  f.store.save(config);
  const resumed = f.store.ensureOccurrence(config.path, next.scheduledAt, f.at);
  expect(resumed.state).toBe('pending');
  const output = config.steps[1];
  if (!output || output.kind !== 'calendar-event') throw new Error('Missing output');
  writeAutomationOutput(output, { automation: config, occurrence: resumed, stepIndex: 1, completedSteps: [{ step: config.steps[0]!, result: 'Keep this event' }] }, f.calendar, f.conversations);
  f.store.remove(config.id);
  expect(f.store.list()).toEqual([]);
  expect(f.store.history().find((item) => item.id === resumed.id)?.state).toBe('skipped');
  expect(f.calendar.events()[0]?.description).toBe('Keep this event');
});

test('missing destinations fail visibly rather than discarding the generated result', () => {
  const f = fixture();
  const config = definition(f.at);
  const occurrence = f.store.ensureOccurrence(config.path, f.at, f.at);
  const context = { automation: config, occurrence, stepIndex: 1, completedSteps: [] };
  expect(() => writeAutomationOutput({ kind: 'chat-message', conversationPath: defaultConversationPath('missing') }, context, f.calendar, f.conversations)).toThrow('no longer exists');
  expect(() => writeAutomationOutput({ kind: 'calendar-event', calendarPath: 'calendar/missing.ics', title: 'Result', daysAfterRun: 0, allDay: true }, context, f.calendar, f.conversations)).toThrow('no longer exists');
});

test('one-time automations require a future time and run only once', async () => {
  const f = fixture();
  let calls = 0;
  const service = createAutomationsService(f.store, f.jobs, { run: async () => { calls++; return 'Done'; } });
  const config = definition(f.at);
  expect(() => service.save({ ...config, recurrence: { ...config.recurrence, frequency: 'once', startDate: '2000-01-01' } })).toThrow('future date and time');
  const future = new Date(Date.now() + 120_000);
  future.setUTCSeconds(0, 0);
  const once: AutomationDefinition = { ...config, steps: [{ kind: 'prompt', prompt: 'Run once' }], recurrence: { frequency: 'once', startDate: future.toISOString().slice(0, 10), localTime: future.toISOString().slice(11, 16), timezone: 'UTC', interval: 1, weekdays: [] } };
  service.save(once);
  await service.tick(new Date(future.getTime() + 8000));
  for (let attempt = 0; attempt < 100 && !service.history().some((run) => run.state === 'succeeded'); attempt++) await Bun.sleep(5);
  await service.tick(new Date(future.getTime() + 60_000));
  expect(calls).toBe(1);
  expect(service.history()).toHaveLength(1);
  expect(service.history()[0]?.state).toBe('succeeded');
});
