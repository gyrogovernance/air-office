import { Database } from 'bun:sqlite';

/**
 * The model the workspace uses when nothing else specifies one.
 *
 * A user who picks a chat model expects that choice to hold. When the choice
 * lives only in the renderer, every restart asks for it again, which is a
 * small annoyance that repeats forever. The default is therefore a service
 * setting, stored beside the other provider configuration.
 */
export interface WorkspaceDefaults {
  /** The provider that serves the default chat model. */
  chatProvider: string | null;
  /** The model that serves the default chat turn. */
  chatModel: string | null;
  /** The embedding model used to build and search the vector index. */
  embeddingModel: string | null;
  /** The exact revision of the embedding model. */
  embeddingRevision: string | null;
  /** The vector dimensions of the embedding model. */
  embeddingDimensions: number | null;
}

export const EMPTY_WORKSPACE_DEFAULTS: WorkspaceDefaults = {
  chatProvider: null,
  chatModel: null,
  embeddingModel: null,
  embeddingRevision: null,
  embeddingDimensions: null
};

export interface WorkspaceDefaultsStore {
  read(): WorkspaceDefaults;
  write(value: Partial<WorkspaceDefaults>): WorkspaceDefaults;
  clear(): void;
  close(): void;
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * Stores the workspace defaults in the providers database.
 *
 * The row holds the defaults for the whole workspace, so they apply to every
 * chat and to the vector index, not to one window.
 */
export function createWorkspaceDefaultsStore(path: string): WorkspaceDefaultsStore {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS provider_workspace_defaults (id INTEGER PRIMARY KEY CHECK (id = 1), defaults_json TEXT NOT NULL)');
  const parse = (raw: string | null): WorkspaceDefaults => {
    if (!raw) return { ...EMPTY_WORKSPACE_DEFAULTS };
    try {
      const parsed = JSON.parse(raw) as Partial<WorkspaceDefaults>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_WORKSPACE_DEFAULTS };
      return {
        chatProvider: text(parsed.chatProvider),
        chatModel: text(parsed.chatModel),
        embeddingModel: text(parsed.embeddingModel),
        embeddingRevision: text(parsed.embeddingRevision),
        embeddingDimensions: count(parsed.embeddingDimensions)
      };
    } catch { return { ...EMPTY_WORKSPACE_DEFAULTS }; }
  };
  return {
    read: () => {
      const row = db.query('SELECT defaults_json FROM provider_workspace_defaults WHERE id = 1').get() as { defaults_json: string } | null;
      return parse(row?.defaults_json ?? null);
    },
    write: (value) => {
      const current = parse((db.query('SELECT defaults_json FROM provider_workspace_defaults WHERE id = 1').get() as { defaults_json: string } | null)?.defaults_json ?? null);
      const next: WorkspaceDefaults = {
        chatProvider: value.chatProvider === undefined ? current.chatProvider : text(value.chatProvider),
        chatModel: value.chatModel === undefined ? current.chatModel : text(value.chatModel),
        embeddingModel: value.embeddingModel === undefined ? current.embeddingModel : text(value.embeddingModel),
        embeddingRevision: value.embeddingRevision === undefined ? current.embeddingRevision : text(value.embeddingRevision),
        embeddingDimensions: value.embeddingDimensions === undefined ? current.embeddingDimensions : count(value.embeddingDimensions)
      };
      db.query('INSERT OR REPLACE INTO provider_workspace_defaults (id, defaults_json) VALUES (1, ?)').run(JSON.stringify(next));
      return next;
    },
    clear: () => db.query('DELETE FROM provider_workspace_defaults WHERE id = 1').run(),
    close: () => db.close()
  };
}
