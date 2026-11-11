import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultCalendarStore } from '@office/calendar/store';
import { createAutomationsService, createVaultAutomationStore } from '@office/automations/service';
import { createJobsService, createSqliteJobStore } from '@office/jobs/service';
import { calendarPathForListId } from '@office/vault/domain';
import { createCalendarExchange, calendarJsonTemplate } from '../../../apps/service/src/calendar-exchange.adapter';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'air-calendar-exchange-'));
  cleanup.push(() => rmSync(path, { recursive: true, force: true }));
  const calendar = createVaultCalendarStore(path);
  const jobs = createJobsService(createSqliteJobStore(join(path, 'jobs.sqlite')));
  const automations = createAutomationsService(createVaultAutomationStore({ vaultRoot: path, occurrencesPath: join(path, '.air', 'runtime', 'automations.sqlite') }), jobs, { run: async () => 'done' });
  cleanup.push(() => { automations.close(); jobs.close(); calendar.close(); });
  const exchange = createCalendarExchange(calendar, automations, (definition, ids) => {
    for (const step of definition.steps) {
      if (step.kind === 'calendar-event' && !ids.has(step.calendarPath)) throw new Error('Unknown result calendar.');
    }
  });
  return { path, calendar, automations, exchange };
}

test('calendar exchange imports new calendars, events and path-based automations', () => {
  const f = fixture();
  const template = calendarJsonTemplate('UTC');
  const imported = f.exchange.apply(template);
  expect(imported).toMatchObject({ calendars: 1, events: 1, automations: 1, skipped: 0 });
  expect(f.calendar.lists().map((list) => list.id)).toContain('ai-planning');
  expect(f.automations.list()[0]?.steps.some((step) => step.kind === 'calendar-event' && step.calendarPath === calendarPathForListId('ai-planning'))).toBe(true);
  const again = f.exchange.apply(template);
  expect(again.skipped).toBeGreaterThan(0);
});

test('calendar exchange rejects unknown calendar references', () => {
  const f = fixture();
  const template = calendarJsonTemplate('UTC');
  expect(() => f.exchange.apply({ ...template, events: [{ ...template.events[0], calendarId: 'missing' }] })).toThrow('unknown calendar');
  expect(() => f.exchange.apply({ ...template, automations: [{ ...template.automations[0], steps: [{ kind: 'calendar-event', calendarPath: 'calendar/missing.ics', title: 'Bad target', daysAfterRun: 0, allDay: true }] }] })).toThrow('Unknown result calendar');
});
