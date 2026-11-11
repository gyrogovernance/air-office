import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteText } from '@office/vault/atomic';
import { parseCalendarIcs, serializeCalendarIcs } from '@office/vault/ics';
import { calendarRelative, normalizeVaultRelative } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot } from '@office/vault/host';
import { ensureVaultLayout } from '@office/vault/service';
import type { CalendarEvent, CalendarList } from './calendar.domain.public';
import { validateCalendarEvent, validateCalendarList } from './calendar.domain.public';
import type { CalendarStore } from './calendar-store.port';

export type { CalendarStore } from './calendar-store.port';

function listPath(root: string, listId: string): string {
  return resolveUnderVault(root, calendarRelative(listId));
}

function readListFile(absolute: string, relative: string): { list: CalendarList; events: CalendarEvent[] } {
  try {
    const raw = readFileSync(absolute, 'utf8');
    const parsed = parseCalendarIcs(raw);
    if (!validateCalendarList(parsed.list)) throw new Error('Calendar list failed domain validation.');
    if (!parsed.events.every((event) => validateCalendarEvent(event))) {
      throw new Error('Calendar event failed domain validation.');
    }
    return { list: parsed.list, events: parsed.events };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid calendar at ${relative}: ${detail}`);
  }
}

function writeListFile(root: string, list: CalendarList, events: readonly CalendarEvent[]): void {
  if (!validateCalendarList(list)) throw new Error('Invalid calendar list.');
  for (const event of events) {
    if (!validateCalendarEvent(event)) throw new Error('Invalid calendar event.');
    if (event.calendarId !== list.id) throw new Error('Event calendarId must match the list id.');
  }
  atomicWriteText(listPath(root, list.id), serializeCalendarIcs(list, events));
}

/** Calendar lists and events as vault `calendar/<list-slug>.ics` files. */
export function createVaultCalendarStore(vaultRoot = resolveVaultRoot()): CalendarStore {
  const root = resolveVaultRoot(vaultRoot);
  ensureVaultLayout(root);
  const calendarDir = resolveUnderVault(root, 'calendar');

  function allFiles(): { absolute: string; relative: string }[] {
    if (!existsSync(calendarDir)) return [];
    return readdirSync(calendarDir)
      .filter((name) => name.endsWith('.ics'))
      .map((name) => ({ absolute: join(calendarDir, name), relative: normalizeVaultRelative(`calendar/${name}`) }));
  }

  function loadAll(): { list: CalendarList; events: CalendarEvent[]; absolute: string }[] {
    return allFiles().map((file) => ({ ...readListFile(file.absolute, file.relative), absolute: file.absolute }));
  }

  return {
    lists: () => loadAll().map((row) => row.list).sort((a, b) => a.id.localeCompare(b.id)),
    saveList: (value) => {
      if (!validateCalendarList(value)) throw new Error('Invalid calendar list.');
      const existing = loadAll().find((row) => row.list.id === value.id);
      const events = existing?.events ?? [];
      if (existing && existing.absolute !== listPath(root, value.id) && existsSync(existing.absolute)) {
        unlinkSync(existing.absolute);
      }
      writeListFile(root, value, events);
      return value;
    },
    deleteList: (id) => {
      const absolute = listPath(root, id);
      if (existsSync(absolute)) unlinkSync(absolute);
      for (const row of loadAll()) {
        if (row.list.id === id && existsSync(row.absolute)) unlinkSync(row.absolute);
      }
    },
    events: (calendarId) => {
      const rows = loadAll();
      const events = calendarId === undefined
        ? rows.flatMap((row) => row.events)
        : rows.find((row) => row.list.id === calendarId)?.events ?? [];
      return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    },
    saveEvent: (value) => {
      if (!validateCalendarEvent(value)) throw new Error('Invalid calendar event.');
      const rows = loadAll();
      const target = rows.find((row) => row.list.id === value.calendarId);
      if (!target) throw new Error('Unknown calendar list.');
      const events = target.events.filter((event) => event.id !== value.id);
      for (const row of rows) {
        if (row.list.id === value.calendarId) continue;
        if (!row.events.some((event) => event.id === value.id)) continue;
        writeListFile(root, row.list, row.events.filter((event) => event.id !== value.id));
      }
      events.push(value);
      writeListFile(root, target.list, events);
      return value;
    },
    deleteEvent: (id) => {
      for (const row of loadAll()) {
        if (!row.events.some((event) => event.id === id)) continue;
        writeListFile(root, row.list, row.events.filter((event) => event.id !== id));
      }
    },
    clearPersonalData: () => {
      for (const file of allFiles()) {
        if (existsSync(file.absolute)) unlinkSync(file.absolute);
      }
    },
    close: () => undefined,
  };
}
