/**
 * Migration coordinator. Migrations run in order and record which module owns
 * each one, so a schema change can always be traced back to its manifest. A
 * migration marked irreversible copies the SQLite file before it runs; restore
 * then never depends on inverting SQL, only on putting the copy back.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Database } from 'bun:sqlite';

export interface MigrationStep {
  /** Stable identifier recorded in the journal; never rewritten once applied. */
  id: string;
  /** Owning module id, so the journal maps every change to its manifest. */
  owner: string;
  sql: string;
  /** A step whose effects cannot be reversed by running its inverse. */
  irreversible?: boolean;
}

export interface MigrationResult {
  applied: string[];
  /** Path of the pre-migration backup when one was taken, otherwise null. */
  backupPath: string | null;
  journal: { id: string; owner: string; appliedAt: string }[];
}

export interface CoordinatorOptions {
  /** Directory that holds pre-migration backups. Defaults to the database directory. */
  backupDir?: string;
}

const JOURNAL_TABLE = 'CREATE TABLE IF NOT EXISTS migration_journal (id TEXT PRIMARY KEY, owner TEXT NOT NULL, applied_at TEXT NOT NULL)';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

/**
 * Runs every pending migration in order. Before an irreversible step the
 * database file is copied once per run, so a failed step can be recovered by
 * restoring the copy instead of trusting a partially applied transaction. The
 * journal records id, owner, and application time for each applied step.
 */
export function runMigrations(dbPath: string, steps: MigrationStep[], options: CoordinatorOptions = {}): MigrationResult {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  const applied: string[] = [];
  let backupPath: string | null = null;
  try {
    db.run(JOURNAL_TABLE);
    const done = new Set((db.query('SELECT id FROM migration_journal').all() as { id: string }[]).map((row) => row.id));
    for (const step of steps) {
      if (done.has(step.id)) continue;
      if (step.irreversible && backupPath === null && existsSync(dbPath)) {
        const dir = options.backupDir ?? dirname(dbPath);
        mkdirSync(dir, { recursive: true });
        backupPath = join(dir, `${stamp()}.pre-${step.id}.bak`);
        copyFileSync(dbPath, backupPath);
      }
      db.transaction(() => {
        db.run(step.sql);
        db.query('INSERT INTO migration_journal (id, owner, applied_at) VALUES (?, ?, ?)').run(step.id, step.owner, new Date().toISOString());
      })();
      applied.push(step.id);
    }
    const journal = db.query('SELECT id, owner, applied_at FROM migration_journal ORDER BY applied_at').all() as { id: string; owner: string; applied_at: string }[];
    return { applied, backupPath, journal: journal.map((row) => ({ id: row.id, owner: row.owner, appliedAt: row.applied_at })) };
  } finally {
    db.close();
  }
}
