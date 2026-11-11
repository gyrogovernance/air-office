import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { validateConnection, validateDefinition } from './tools.domain.public';
import type { ToolStore } from './tool-store.port';

export function createSqliteToolStore(path: string): ToolStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS tool_connections (connection_id TEXT PRIMARY KEY, value_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tool_definitions (tool_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, value_json TEXT NOT NULL);');
  return {
    connections: () => (db.query('SELECT value_json FROM tool_connections ORDER BY connection_id').all() as { value_json: string }[]).map(({ value_json }) => {
      const value: unknown = JSON.parse(value_json);
      if (!validateConnection(value)) throw new Error('Stored tool connection is invalid.');
      return value;
    }),
    saveConnection: (connection: ToolConnection) => {
      if (!validateConnection(connection)) throw new Error('Invalid tool connection.');
      db.query('INSERT INTO tool_connections (connection_id, value_json) VALUES (?, ?) ON CONFLICT(connection_id) DO UPDATE SET value_json = excluded.value_json').run(connection.id, JSON.stringify(connection));
    },
    definitions: (connectionId?: string) => {
      const rows = connectionId === undefined
        ? db.query('SELECT value_json FROM tool_definitions ORDER BY tool_id').all() as { value_json: string }[]
        : db.query('SELECT value_json FROM tool_definitions WHERE connection_id = ? ORDER BY tool_id').all(connectionId) as { value_json: string }[];
      return rows.map(({ value_json }) => {
        const value: unknown = JSON.parse(value_json);
        if (!validateDefinition(value)) throw new Error('Stored tool definition is invalid.');
        return value;
      });
    },
    saveDefinition: (definition: ToolDefinition) => {
      if (!validateDefinition(definition)) throw new Error('Invalid tool definition.');
      db.query('INSERT INTO tool_definitions (tool_id, connection_id, value_json) VALUES (?, ?, ?) ON CONFLICT(tool_id) DO UPDATE SET connection_id = excluded.connection_id, value_json = excluded.value_json').run(definition.id, definition.connectionId, JSON.stringify(definition));
    },
    removeDefinition: (toolId: string) => {
      db.query('DELETE FROM tool_definitions WHERE tool_id = ?').run(toolId);
    },
    removeConnection: db.transaction((connectionId: string) => {
      db.query('DELETE FROM tool_definitions WHERE connection_id = ?').run(connectionId);
      db.query('DELETE FROM tool_connections WHERE connection_id = ?').run(connectionId);
    }),
    clearPersonalData: () => { db.transaction(() => { db.exec('DELETE FROM tool_definitions; DELETE FROM tool_connections;'); })(); },
    close: () => db.close()
  };
}
