import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type DownloadActivity = { id: string; instanceId: string; generation: number; jobId: string; kind: string; state: string; percent: number | null; running: boolean | null; createdAt: string; observedAt: string; lastAction: string | null };
type Identity = { instanceId: string; generation: number };
const terminal = new Set(['completed', 'cancelled', 'error']);
const states = new Set(['downloading', 'paused', 'completed', 'cancelled', 'error']);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
// Only opaque runtime identities are retained. Paths, checkpoints, error text and credentials are excluded.
const safeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[a-zA-Z0-9._:-]+$/.test(value);

export function createLemonadeActivityJournal(path: string, identity: Identity | null, limit = 500) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('Invalid activity retention limit.');
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS lemonade_activity (id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, generation INTEGER NOT NULL, job_id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, percent REAL, running INTEGER, created_at TEXT NOT NULL, observed_at TEXT NOT NULL, last_action TEXT);
    CREATE INDEX IF NOT EXISTS lemonade_activity_identity ON lemonade_activity(instance_id, generation, job_id);`);
  const all = () => db.query<DownloadActivity, []>(`SELECT id, instance_id AS instanceId, generation, job_id AS jobId, kind, state, percent, running, created_at AS createdAt, observed_at AS observedAt, last_action AS lastAction FROM lemonade_activity ORDER BY rowid DESC`).all().map((row) => ({ ...row, running: row.running === null ? null : Boolean(row.running) }));
  const prune = () => db.query('DELETE FROM lemonade_activity WHERE id IN (SELECT id FROM lemonade_activity ORDER BY rowid DESC LIMIT -1 OFFSET ?)').run(limit);
  // A new service session reconciles nonterminal work for this runtime instance only.
  if (identity && safeId(identity.instanceId) && Number.isSafeInteger(identity.generation)) {
    db.query("UPDATE lemonade_activity SET state='interrupted', running=NULL WHERE instance_id<>? AND state NOT IN ('completed','cancelled','error')").run(identity.instanceId);
    db.query("UPDATE lemonade_activity SET state='interrupted', running=NULL WHERE instance_id=? AND generation<>? AND state NOT IN ('completed','cancelled','error')").run(identity.instanceId, identity.generation);
    db.query("UPDATE lemonade_activity SET state='interrupted', running=NULL WHERE instance_id=? AND generation=? AND state NOT IN ('completed','cancelled','error')").run(identity.instanceId, identity.generation);
  }
  const observe = db.transaction((value: unknown, completeList = false) => {
    if (!identity || !safeId(identity.instanceId) || !Number.isSafeInteger(identity.generation)) return;
    // The first observation in a generation also closes active work from earlier generations.
    db.query("UPDATE lemonade_activity SET state='interrupted', running=NULL WHERE instance_id=? AND generation<>? AND state NOT IN ('completed','cancelled','error')").run(identity.instanceId, identity.generation);
    const container = object(value);
    if (completeList && !Array.isArray(value) && !Array.isArray(container?.downloads)) return;
    const rows = Array.isArray(value) ? value : Array.isArray(container?.downloads) ? container.downloads : [value];
    const seen = new Set<string>();
    for (const candidate of rows.slice(0, 5000)) {
      const item = object(candidate);
      if (!item || !safeId(item.id) || typeof item.status !== 'string' || !states.has(item.status) || typeof item.running !== 'boolean') continue;
      seen.add(item.id);
      const existing = all().find((row) => row.instanceId === identity.instanceId && row.generation === identity.generation && row.jobId === item.id);
      const now = new Date().toISOString();
      // Terminal state requires a stopped upstream worker; a completion progress event alone is insufficient.
      const state = terminal.has(item.status) && item.running ? 'downloading' : item.status;
      const fresh = !existing || (terminal.has(existing.state) && !terminal.has(state));
      const percent = typeof item.percent === 'number' && Number.isFinite(item.percent) && item.percent >= 0 && item.percent <= 100 ? item.percent : null;
      if (fresh) db.query('INSERT INTO lemonade_activity VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(randomUUID(), identity.instanceId, identity.generation, item.id, item.type === 'backend' ? 'backend' : 'model', state, percent, Number(item.running), now, now);
      else if (existing && (!terminal.has(existing.state) || terminal.has(state))) db.query('UPDATE lemonade_activity SET state=?, percent=?, running=?, observed_at=? WHERE id=?').run(state, percent, Number(item.running), now, existing.id);
    }
    if (completeList) for (const row of all()) {
      if (row.instanceId === identity.instanceId && row.generation === identity.generation && !seen.has(row.jobId) && !terminal.has(row.state)) db.query("UPDATE lemonade_activity SET state='unknown', running=NULL WHERE id=?").run(row.id);
    }
    prune();
  });
  return {
    list: all,
    importHistorical(jobs: readonly { id: string; kind: string; state: string; progress: number; createdAt: string; updatedAt: string }[]) {
      db.transaction(() => {
        for (const job of jobs) {
          if (job.kind !== 'download-history' || !safeId(job.id)) continue;
          const id = `historical:${job.id}`;
          const state = job.state === 'succeeded' ? 'completed' : job.state === 'cancelled' ? 'cancelled' : job.state === 'failed' ? 'error' : 'interrupted';
          db.query('INSERT OR IGNORE INTO lemonade_activity VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(id, 'historical', 0, job.id, 'model', state, Math.max(0, Math.min(100, job.progress * 100)), 0, job.createdAt, job.updatedAt);
        }
        prune();
      })();
    },
    observe,
    control(jobId: unknown, action: unknown) {
      if (!identity || !safeId(jobId) || !['pause', 'cancel', 'remove'].includes(String(action))) return;
      const row = all().find((entry) => entry.instanceId === identity.instanceId && entry.generation === identity.generation && entry.jobId === jobId);
      if (row) db.query('UPDATE lemonade_activity SET last_action=? WHERE id=?').run(String(action), row.id);
    },
    close: () => db.close()
  };
}
