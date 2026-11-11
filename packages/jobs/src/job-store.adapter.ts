import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Job, JobEvent, JobKind, JobState } from '@office/contracts/job';
import { assertTransition, newJob } from './jobs.domain.public';
import type { JobStore, StartJobInput } from './job-store.port';

interface JobRow { job_id: string; kind: string; state: string; idempotency_key: string; progress: number; checkpoint: string | null; attempt: number; created_at: string; updated_at: string; error: string | null; }

const toJob = (row: JobRow): Job => ({
  id: row.job_id, kind: row.kind as JobKind, state: row.state as JobState, idempotencyKey: row.idempotency_key,
  progress: row.progress, checkpoint: row.checkpoint, attempt: row.attempt, createdAt: row.created_at, updatedAt: row.updated_at, error: row.error
});

/**
 * SQLite-backed job store. The idempotency key is unique, so starting the same
 * unit of work twice returns the existing job. Every transition is validated
 * against the state machine and recorded as an event, so job history is
 * inspectable and a restart cannot silently re-run a terminal job.
 */
export function createSqliteJobStore(path: string): JobStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS job_jobs (
      job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      progress REAL NOT NULL DEFAULT 0, checkpoint TEXT, attempt INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS job_events (
      job_id TEXT NOT NULL REFERENCES job_jobs(job_id), sequence INTEGER NOT NULL,
      state TEXT NOT NULL, at TEXT NOT NULL, detail TEXT, PRIMARY KEY (job_id, sequence)
    );`);

  const get = (jobId: string): Job | null => {
    const row = db.query('SELECT job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error FROM job_jobs WHERE job_id = ?').get(jobId) as JobRow | null;
    return row ? toJob(row) : null;
  };
  const record = (jobId: string, state: JobState, detail: string | null, at: string) => {
    const sequence = (db.query('SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM job_events WHERE job_id = ?').get(jobId) as { next: number }).next;
    db.query('INSERT INTO job_events (job_id, sequence, state, at, detail) VALUES (?, ?, ?, ?, ?)').run(jobId, sequence, state, at, detail);
  };

  // One idempotent migration. Original rows remain recoverable beside untouched events and files.
  db.exec('CREATE TABLE IF NOT EXISTS job_retired_downloads (job_id TEXT PRIMARY KEY, original_json TEXT NOT NULL)');
  db.transaction(() => {
    const rows = db.query("SELECT * FROM job_jobs WHERE kind IN ('acquire-model', 'acquire-engine')").all() as JobRow[];
    for (const row of rows) {
      db.query('INSERT OR IGNORE INTO job_retired_downloads VALUES (?, ?)').run(row.job_id, JSON.stringify(row));
      const active = ['queued', 'running', 'waiting-user', 'interrupted'].includes(row.state);
      db.query("UPDATE job_jobs SET kind='download-history', state=?, error=? WHERE job_id=?").run(active ? 'interrupted' : row.state, active ? 'Transfer outcome is unverified. Original files and records are preserved.' : row.error, row.job_id);
    }
  })();

  return {
    clearPersonalData: () => { db.transaction(() => { db.exec('DELETE FROM job_events; DELETE FROM job_jobs; DELETE FROM job_retired_downloads;'); })(); },
    start: (input: StartJobInput) => {
      const existing = db.query('SELECT job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error FROM job_jobs WHERE idempotency_key = ?').get(input.idempotencyKey) as JobRow | null;
      if (existing) return { job: toJob(existing), created: false };
      const job = newJob(input.id, input.kind, input.idempotencyKey);
      db.transaction(() => {
        db.query('INSERT INTO job_jobs (job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(job.id, job.kind, job.state, job.idempotencyKey, job.progress, job.checkpoint, job.attempt, job.createdAt, job.updatedAt, job.error);
        record(job.id, 'queued', null, job.createdAt);
      })();
      return { job, created: true };
    },
    get,
    findByKey: (idempotencyKey: string) => {
      const row = db.query('SELECT job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error FROM job_jobs WHERE idempotency_key = ?').get(idempotencyKey) as JobRow | null;
      return row ? toJob(row) : null;
    },
    list: (states?: JobState[]) => {
      const rows = states && states.length
        ? db.query(`SELECT job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error FROM job_jobs WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at`).all(...states) as JobRow[]
        : db.query('SELECT job_id, kind, state, idempotency_key, progress, checkpoint, attempt, created_at, updated_at, error FROM job_jobs ORDER BY created_at').all() as JobRow[];
      return rows.map(toJob);
    },
    transition: (jobId: string, to: JobState, detail: string | null) => {
      const current = get(jobId);
      if (!current) throw new Error('Unknown job.');
      if (current.kind === 'download-history') throw new Error('Legacy acquisition history is read-only.');
      assertTransition(current.state, to);
      const at = new Date().toISOString();
      db.transaction(() => {
        db.query('UPDATE job_jobs SET state = ?, updated_at = ?, error = ?, attempt = attempt + ? WHERE job_id = ?')
          .run(to, at, to === 'failed' ? detail : null, to === 'running' ? 1 : 0, jobId);
        record(jobId, to, detail, at);
      })();
      return get(jobId)!;
    },
    setProgress: (jobId: string, progress: number, checkpoint: string | null) => {
      const current = get(jobId);
      if (current?.kind === 'download-history') throw new Error('Legacy acquisition history is read-only.');
      const bounded = Math.min(1, Math.max(0, progress));
      db.query('UPDATE job_jobs SET progress = ?, checkpoint = COALESCE(?, checkpoint), updated_at = ? WHERE job_id = ?').run(bounded, checkpoint, new Date().toISOString(), jobId);
      return get(jobId)!;
    },
    events: (jobId: string) => (db.query('SELECT job_id, sequence, state, at, detail FROM job_events WHERE job_id = ? ORDER BY sequence').all(jobId) as { job_id: string; sequence: number; state: string; at: string; detail: string | null }[])
      .map((row): JobEvent => ({ jobId: row.job_id, sequence: row.sequence, state: row.state as JobState, at: row.at, detail: row.detail })),
    interrupt: () => {
      const running = db.query("SELECT job_id, checkpoint FROM job_jobs WHERE state = 'running'").all() as { job_id: string; checkpoint: string | null }[];
      db.transaction(() => {
        for (const row of running) {
          const at = new Date().toISOString();
          db.query("UPDATE job_jobs SET state = 'interrupted', updated_at = ? WHERE job_id = ?").run(at, row.job_id);
          record(row.job_id, 'interrupted', 'Service restart while the job was running.', at);
        }
      })();
    },
    close: () => db.close()
  };
}
