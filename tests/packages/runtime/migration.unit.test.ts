import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, copyFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations, type MigrationStep } from '../../../packages/runtime/src/migration.adapter';

let dir: string;
let dbPath: string;

beforeEach(() => {
  mkdirSync('.tmp', { recursive: true });
  dir = mkdtempSync(join('.tmp', 'migration-'));
  dbPath = join(dir, 'office.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const createNotes: MigrationStep = { id: '2026-10-11-notes', owner: 'files', sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)' };
const dropLegacy: MigrationStep = { id: '2026-10-11-drop-legacy', owner: 'exports', sql: 'DROP TABLE legacy_notes', irreversible: true };

describe('migration coordinator', () => {
  test('applies pending migrations once and records module ownership', () => {
    const first = runMigrations(dbPath, [createNotes]);
    expect(first.applied).toEqual(['2026-10-11-notes']);
    expect(first.journal).toEqual([{ id: '2026-10-11-notes', owner: 'files', appliedAt: expect.any(String) }]);

    const second = runMigrations(dbPath, [createNotes, { id: '2026-10-11-more', owner: 'chat', sql: 'CREATE TABLE threads (id TEXT PRIMARY KEY)' }]);
    expect(second.applied).toEqual(['2026-10-11-more']);
    expect(second.journal.map((entry) => entry.owner)).toEqual(['files', 'chat']);
  });

  test('T-016: an irreversible step takes a restorable pre-migration backup', () => {
    runMigrations(dbPath, [createNotes]);
    const db = new Database(dbPath);
    db.query("INSERT INTO notes (id, body) VALUES ('n1', 'kept text')").run();
    db.run('CREATE TABLE legacy_notes (id TEXT PRIMARY KEY)');
    db.close();

    const result = runMigrations(dbPath, [dropLegacy]);
    expect(result.applied).toEqual(['2026-10-11-drop-legacy']);
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath!)).toBe(true);

    const after = new Database(dbPath);
    expect(after.query("SELECT name FROM sqlite_master WHERE name = 'legacy_notes'").all()).toHaveLength(0);
    after.close();

    copyFileSync(result.backupPath!, dbPath);
    const restored = new Database(dbPath);
    expect(restored.query("SELECT body FROM notes WHERE id = 'n1'").get()).toEqual({ body: 'kept text' });
    expect(restored.query("SELECT name FROM sqlite_master WHERE name = 'legacy_notes'").all()).toHaveLength(1);
    restored.close();
  });

  test('T-016: a failing irreversible step leaves only applied entries and a backup on disk', () => {
    runMigrations(dbPath, [createNotes]);
    const broken: MigrationStep = { id: '2026-10-11-broken', owner: 'knowledge', sql: 'DROP TABLE does_not_exist', irreversible: true };
    expect(() => runMigrations(dbPath, [broken])).toThrow();

    const backups = readdirSync(dir).filter((name) => name.includes('pre-2026-10-11-broken'));
    expect(backups).toHaveLength(1);

    const db = new Database(dbPath);
    expect(db.query("SELECT id FROM migration_journal WHERE id = '2026-10-11-broken'").all()).toHaveLength(0);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'notes'").all()).toHaveLength(1);
    db.close();

    const fixed: MigrationStep = { id: '2026-10-11-broken', owner: 'knowledge', sql: 'CREATE TABLE knowledge_terms (id TEXT PRIMARY KEY)', irreversible: true };
    const recovered = runMigrations(dbPath, [createNotes, fixed]);
    expect(recovered.applied).toEqual(['2026-10-11-broken']);
    expect(recovered.journal.map((entry) => entry.owner)).toEqual(['files', 'knowledge']);
  });

  test('reversible steps do not create backups', () => {
    const result = runMigrations(dbPath, [createNotes]);
    expect(result.backupPath).toBeNull();
    expect(readdirSync(dir).filter((name) => name.endsWith('.bak'))).toHaveLength(0);
  });
});
