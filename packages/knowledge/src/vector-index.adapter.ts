import { Database } from 'bun:sqlite';

export interface VectorProbeResult {
  available: boolean;
  /** Human-readable detail for an evidence record; never contains secrets. */
  detail: string;
}

/**
 * Compatibility probe for the sqlite-vec extension. It attempts to load the
 * extension into a fresh in-memory database and run a bounded vector query. When
 * the extension is unavailable the probe reports it honestly so the caller can
 * keep the pure-SQLite vector adapter rather than treating vector retrieval as
 * verified. The probe never writes to the application database.
 */
export function probeSqliteVec(extensionPath: string | null = Bun.env.OFFICE_SQLITE_VEC_PATH ?? null): VectorProbeResult {
  if (!extensionPath) return { available: false, detail: 'No sqlite-vec extension path is configured (OFFICE_SQLITE_VEC_PATH).' };
  let db: Database | null = null;
  try {
    db = new Database(':memory:');
    db.loadExtension(extensionPath);
    db.exec('CREATE VIRTUAL TABLE probe USING vec0(embedding float[3]);');
    db.query('INSERT INTO probe (rowid, embedding) VALUES (1, ?), (2, ?)').run(new Uint8Array(new Float32Array([1, 0, 0]).buffer), new Uint8Array(new Float32Array([0, 1, 0]).buffer));
    const rows = db.query('SELECT rowid, distance FROM probe WHERE embedding MATCH ? ORDER BY distance LIMIT 1').all(new Uint8Array(new Float32Array([1, 0, 0]).buffer)) as { rowid: number; distance: number }[];
    return rows.length === 1 ? { available: true, detail: `sqlite-vec loaded; nearest rowid ${rows[0]!.rowid} at distance ${rows[0]!.distance}.` } : { available: false, detail: 'sqlite-vec loaded but the probe query returned no rows.' };
  } catch (error) {
    return { available: false, detail: `sqlite-vec probe failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  } finally { db?.close(); }
}
