import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ScheduledOccurrence, WorkflowStep } from './automations.domain.public';

/** Runtime SQLite for automation occurrences, keyed by vault automation path. */
export function createSqliteOccurrenceStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS automation_occurrences (occurrence_id TEXT PRIMARY KEY, automation_path TEXT NOT NULL, scheduled_at TEXT NOT NULL, state TEXT NOT NULL, job_id TEXT, updated_at TEXT NOT NULL, completed_steps_json TEXT NOT NULL DEFAULT '[]', error TEXT, UNIQUE(automation_path, scheduled_at));");
  // Legacy column name from pre-vault SQLite: rename when present.
  try {
    const columns = db.query("PRAGMA table_info(automation_occurrences)").all() as { name: string }[];
    if (columns.some((column) => column.name === 'automation_id') && !columns.some((column) => column.name === 'automation_path')) {
      db.exec('ALTER TABLE automation_occurrences RENAME COLUMN automation_id TO automation_path');
    }
  } catch {
    /* Fresh databases already use automation_path. */
  }
  try { db.exec("ALTER TABLE automation_occurrences ADD COLUMN completed_steps_json TEXT NOT NULL DEFAULT '[]'"); } catch { /* Existing databases already have the column. */ }
  try { db.exec('ALTER TABLE automation_occurrences ADD COLUMN error TEXT'); } catch { /* Existing databases already have the column. */ }

  const occurrence = (row: Record<string, unknown>): ScheduledOccurrence => ({
    id: String(row.occurrence_id),
    automationPath: String(row.automation_path ?? row.automation_id),
    scheduledAt: String(row.scheduled_at),
    state: row.state as ScheduledOccurrence['state'],
    jobId: typeof row.job_id === 'string' ? row.job_id : null,
    updatedAt: String(row.updated_at),
    completedSteps: typeof row.completed_steps_json === 'string' ? JSON.parse(row.completed_steps_json) as ScheduledOccurrence['completedSteps'] : [],
    error: typeof row.error === 'string' ? row.error : null,
  });

  const select = 'SELECT occurrence_id, automation_path, scheduled_at, state, job_id, updated_at, completed_steps_json, error FROM automation_occurrences';

  return {
    due: (now: string) => (db.query(`${select} WHERE state = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at`).all(now) as Record<string, unknown>[]).map(occurrence),
    ensureOccurrence: (automationPath: string, scheduledAt: string, at: string) => {
      const id = `${automationPath}:${scheduledAt}`;
      db.query("INSERT OR IGNORE INTO automation_occurrences (occurrence_id, automation_path, scheduled_at, state, job_id, updated_at) VALUES (?, ?, ?, 'pending', NULL, ?)").run(id, automationPath, scheduledAt, at);
      if (scheduledAt > at) db.query("UPDATE automation_occurrences SET state = 'pending', updated_at = ? WHERE occurrence_id = ? AND state = 'skipped'").run(at, id);
      const row = db.query(`${select} WHERE occurrence_id = ?`).get(id) as Record<string, unknown>;
      return occurrence(row);
    },
    createManualOccurrence: (automationPath: string, at: string) => db.transaction(() => {
      let timestamp = Date.parse(at);
      while (db.query('SELECT 1 FROM automation_occurrences WHERE automation_path = ? AND scheduled_at = ?').get(automationPath, new Date(timestamp).toISOString())) timestamp += 1;
      const scheduledAt = new Date(timestamp).toISOString();
      const id = `manual:${crypto.randomUUID()}`;
      db.query("INSERT INTO automation_occurrences (occurrence_id, automation_path, scheduled_at, state, job_id, updated_at) VALUES (?, ?, ?, 'pending', NULL, ?)").run(id, automationPath, scheduledAt, at);
      return occurrence(db.query(`${select} WHERE occurrence_id = ?`).get(id) as Record<string, unknown>);
    })(),
    startOccurrence: (id: string, jobId: string, at: string) => {
      db.query("UPDATE automation_occurrences SET state = 'started', job_id = ?, updated_at = ? WHERE occurrence_id = ? AND state = 'pending'").run(jobId, at, id);
      const row = db.query(`${select} WHERE occurrence_id = ?`).get(id) as Record<string, unknown> | null;
      if (!row) throw new Error('Unknown scheduled occurrence.');
      return occurrence(row);
    },
    skipOccurrence: (id: string, at: string) => {
      db.query("UPDATE automation_occurrences SET state = 'skipped', updated_at = ? WHERE occurrence_id = ? AND state = 'pending'").run(at, id);
      const row = db.query(`${select} WHERE occurrence_id = ?`).get(id) as Record<string, unknown> | null;
      if (!row) throw new Error('Unknown scheduled occurrence.');
      return occurrence(row);
    },
    skipPending: (automationPath: string) => {
      db.query("UPDATE automation_occurrences SET state = 'skipped' WHERE automation_path = ? AND state = 'pending'").run(automationPath);
    },
    recordOutcome: (id: string, state: 'started' | 'succeeded' | 'failed' | 'cancelled', completedSteps: { step: WorkflowStep; result: unknown }[], error: string | null, at: string) => {
      const retained: typeof completedSteps = [];
      let size = 2;
      for (const entry of completedSteps) {
        const normalized = JSON.stringify(entry).length > 32_000 ? { ...entry, result: 'The result exceeded the saved history limit.' } : entry;
        const length = JSON.stringify(normalized).length + 1;
        if (size + length > 250_000) break;
        retained.push(normalized);
        size += length;
      }
      db.query('UPDATE automation_occurrences SET state = ?, completed_steps_json = ?, error = ?, updated_at = ? WHERE occurrence_id = ?').run(state, JSON.stringify(retained), error, at, id);
      const row = db.query(`${select} WHERE occurrence_id = ?`).get(id) as Record<string, unknown> | null;
      if (!row) throw new Error('Unknown scheduled occurrence.');
      return occurrence(row);
    },
    history: (automationPath?: string, limit = 100) => {
      const rows = automationPath === undefined
        ? db.query(`${select} ORDER BY scheduled_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[]
        : db.query(`${select} WHERE automation_path = ? ORDER BY scheduled_at DESC LIMIT ?`).all(automationPath, limit) as Record<string, unknown>[];
      return rows.map(occurrence);
    },
    clear: () => { db.exec('DELETE FROM automation_occurrences;'); },
    close: () => db.close(),
  };
}

export type OccurrenceStore = ReturnType<typeof createSqliteOccurrenceStore>;
