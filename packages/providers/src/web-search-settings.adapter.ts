import { Database } from 'bun:sqlite';
import type { WebSearchCheckRecord, WebSearchLoaderOptions, WebSearchSettingsStore } from './web-search-settings.service';

/**
 * Stores the web search endpoint and the loader controls for this workspace.
 * The table belongs to the providers module, which owns provider connections
 * and their settings. The endpoint is not a secret, so it is kept in plain
 * text next to the other provider configuration.
 *
 * The row survives a cleared endpoint: an empty endpoint selects the built-in
 * engine rather than switching search off, so the switch has its own column
 * and the two settings cannot drift apart.
 */
export function createWebSearchSettingsStore(path: string, seedEndpoint?: string): WebSearchSettingsStore {
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS provider_web_search (id INTEGER PRIMARY KEY CHECK (id = 1), endpoint TEXT, options_json TEXT NOT NULL DEFAULT '{}')`);
  const columns = db.query('PRAGMA table_info(provider_web_search)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'options_json')) db.exec("ALTER TABLE provider_web_search ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}'");
  if (!columns.some((column) => column.name === 'enabled')) db.exec('ALTER TABLE provider_web_search ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
  if (!columns.some((column) => column.name === 'last_check_json')) db.exec('ALTER TABLE provider_web_search ADD COLUMN last_check_json TEXT');
  const initialEndpoint = seedEndpoint?.trim();
  const endpoint = initialEndpoint && /^https?:\/\//i.test(initialEndpoint) && initialEndpoint.length <= 2000 ? initialEndpoint : null;
  db.query("INSERT OR IGNORE INTO provider_web_search (id, endpoint, options_json, enabled) VALUES (1, ?, '{}', 1)").run(endpoint);
  const readOptions = (raw: string | null): WebSearchLoaderOptions => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Partial<WebSearchLoaderOptions>;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch { return {}; }
  };
  const readCheck = (raw: string | null): WebSearchCheckRecord | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as WebSearchCheckRecord;
      return typeof parsed === 'object' && parsed !== null && typeof parsed.reachable === 'boolean' ? parsed : null;
    } catch { return null; }
  };
  return {
    read: () => {
      const row = db.query('SELECT endpoint, options_json, enabled, last_check_json FROM provider_web_search WHERE id = 1').get() as { endpoint: string | null; options_json: string | null; enabled: number; last_check_json: string | null } | null;
      return {
        endpoint: row?.endpoint ?? null,
        enabled: row ? row.enabled !== 0 : true,
        options: readOptions(row?.options_json ?? null),
        lastCheck: readCheck(row?.last_check_json ?? null)
      };
    },
    write: (endpoint, options, enabled) => {
      const current = db.query('SELECT enabled, last_check_json FROM provider_web_search WHERE id = 1').get() as { enabled: number; last_check_json: string | null } | null;
      const nextEnabled = enabled === undefined ? (current ? current.enabled !== 0 : true) : enabled;
      db.query('INSERT OR REPLACE INTO provider_web_search (id, endpoint, options_json, enabled, last_check_json) VALUES (1, ?, ?, ?, ?)').run(endpoint, JSON.stringify(options ?? {}), nextEnabled ? 1 : 0, current?.last_check_json ?? null);
    },
    writeCheck: (check) => {
      const current = db.query('SELECT endpoint, options_json, enabled FROM provider_web_search WHERE id = 1').get() as { endpoint: string | null; options_json: string | null; enabled: number } | null;
      db.query('INSERT OR REPLACE INTO provider_web_search (id, endpoint, options_json, enabled, last_check_json) VALUES (1, ?, ?, ?, ?)').run(
        current?.endpoint ?? null,
        current?.options_json ?? '{}',
        current?.enabled ?? 1,
        check ? JSON.stringify(check) : null
      );
    },
    close: () => db.close()
  };
}
