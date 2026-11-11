import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEventEnvelope, type ChatRunRequest } from '@office/contracts/chat';
import { initialChatRunState, reduceChatEvent } from './chat.domain.public';
import type { ChatRunStore, StoredChatRun, StoredRunStatus } from './chat-run.port';

export function createSqliteChatRunStore(path: string): ChatRunStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS chat_runs (
      run_id TEXT PRIMARY KEY, request_json TEXT NOT NULL, state_json TEXT NOT NULL,
      status TEXT NOT NULL, last_sequence INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS chat_events (
      run_id TEXT NOT NULL REFERENCES chat_runs(run_id), sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL, PRIMARY KEY (run_id, sequence)
    );
    CREATE TABLE IF NOT EXISTS chat_run_execution (
      run_id TEXT PRIMARY KEY REFERENCES chat_runs(run_id), identity TEXT NOT NULL
    );`);
  const get = (runId: string): StoredChatRun | null => {
    const row = db.query('SELECT r.request_json, r.state_json, r.status, e.identity FROM chat_runs r LEFT JOIN chat_run_execution e ON e.run_id = r.run_id WHERE r.run_id = ?').get(runId) as { request_json: string; state_json: string; status: StoredRunStatus; identity: string | null } | null;
    return row ? { request: JSON.parse(row.request_json), state: JSON.parse(row.state_json), status: row.status, ...(row.identity === null ? {} : { executionIdentity: row.identity }) } : null;
  };
  const append = db.transaction((event: ChatEventEnvelope) => {
    const run = get(event.runId);
    if (!run || run.status !== 'running' || event.protocolVersion !== CHAT_PROTOCOL_VERSION || event.sequence !== run.state.lastSequence + 1) throw new Error('Invalid chat event transition');
    const state = reduceChatEvent(run.state, event);
    const status: StoredRunStatus = event.type === 'completion' && event.payload.reason !== 'tool' ? (event.payload.reason === 'cancelled' ? 'cancelled' : 'complete') : event.type === 'failure' ? (event.payload.code === 'run-interrupted' ? 'interrupted' : 'failed') : 'running';
    db.query('INSERT INTO chat_events VALUES (?, ?, ?)').run(event.runId, event.sequence, JSON.stringify(event));
    db.query('UPDATE chat_runs SET state_json = ?, status = ?, last_sequence = ? WHERE run_id = ?').run(JSON.stringify(state), status, event.sequence, event.runId);
  });
  return {
    create: db.transaction((request: ChatRunRequest, executionIdentity?: string) => {
      const inserted = db.query('INSERT OR IGNORE INTO chat_runs (run_id, request_json, state_json, status) VALUES (?, ?, ?, ?)').run(request.runId, JSON.stringify(request), JSON.stringify(initialChatRunState()), 'running').changes === 1;
      if (inserted && executionIdentity !== undefined) db.query('INSERT INTO chat_run_execution (run_id, identity) VALUES (?, ?)').run(request.runId, executionIdentity);
      return inserted;
    }),
    get,
    events(runId, after, limit = 256) {
      const rows = db.query('SELECT event_json FROM chat_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?').all(runId, after, Math.min(Math.max(limit, 1), 256)) as { event_json: string }[];
      return rows.map((row) => JSON.parse(row.event_json) as ChatEventEnvelope);
    },
    append,
    interrupt: db.transaction(() => {
      const rows = db.query("SELECT run_id, last_sequence FROM chat_runs WHERE status = 'running'").all() as { run_id: string; last_sequence: number }[];
      for (const row of rows) {
        const sequence = row.last_sequence + 1;
        append({ protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${row.run_id}:${sequence}`, runId: row.run_id, correlationId: row.run_id, sequence, timestamp: new Date().toISOString(), type: 'failure', payload: { code: 'run-interrupted', message: 'Generation was interrupted by a service restart. Start a new attempt to continue.', retryable: true } });
      }
    }),
    close() { db.close(); }
  };
}
