import { Database } from 'bun:sqlite';
import { z } from 'zod';
import { craftPackageSchema, gyroscopicCraftPackage, humanMarkCraftPackage } from './craft-package.policy';
import type { CraftRecord } from './craft-package.policy';

const recordSchema = z.strictObject({ package: craftPackageSchema, bindings: z.record(z.string(), z.string()), enabled: z.boolean() });

export function createSqliteCraftStore(path: string) {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS method_crafts (id TEXT PRIMARY KEY, record_json TEXT NOT NULL)');
  const list = (): CraftRecord[] => db.query<{ record_json: string }, []>('SELECT record_json FROM method_crafts ORDER BY id').all().map(row => recordSchema.parse(JSON.parse(row.record_json)));
  const save = (record: CraftRecord): CraftRecord => {
    const parsed = recordSchema.parse(record);
    db.query('INSERT INTO method_crafts (id, record_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json').run(parsed.package.id, JSON.stringify(parsed));
    return parsed;
  };
  for (const craft of [gyroscopicCraftPackage(), humanMarkCraftPackage()]) if (!list().some(item => item.package.id === craft.id)) save({ package: craft, enabled: true, bindings: {} });
  return { list, save, remove: (id: string) => db.query('DELETE FROM method_crafts WHERE id = ?').run(id), clear: () => db.exec('DELETE FROM method_crafts'), close: () => db.close() };
}
