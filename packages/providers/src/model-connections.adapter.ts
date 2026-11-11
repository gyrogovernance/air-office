import { Database } from 'bun:sqlite';
import { parseModelConnection } from './providers.domain.public';
import type { ModelConnection } from './providers.domain.public';

/** Nonsecret settings only; provider credentials are stored independently in the OS keychain. */
export function createModelConnectionStore(path: string, seeds: ModelConnection[] = []) {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS provider_connections (id TEXT PRIMARY KEY, configuration TEXT NOT NULL)');
  const put = (value: ModelConnection) => db.query('INSERT INTO provider_connections VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET configuration = excluded.configuration').run(value.id, JSON.stringify(parseModelConnection(value)));
  for (const seed of seeds) if (!db.query('SELECT id FROM provider_connections WHERE id = ?').get(seed.id)) put(seed);
  return {
    list: (): ModelConnection[] => db.query<{ configuration: string }, []>('SELECT configuration FROM provider_connections ORDER BY rowid').all().map((row) => parseModelConnection(JSON.parse(row.configuration))),
    put,
    remove: (id: string) => db.query('DELETE FROM provider_connections WHERE id = ?').run(id),
    clearPersonalData: () => { db.query('DELETE FROM provider_connections').run(); },
    close: () => db.close(),
  };
}
