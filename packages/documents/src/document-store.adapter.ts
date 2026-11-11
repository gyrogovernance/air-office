import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExtractedPage, ExtractionArtifact, SourceDocument, SourceVersion } from '@office/contracts/document';
import type { DocumentStore, RecordVersionInput } from './document-store.port';

interface DocumentRow { document_id: string; collection_id: string | null; name: string; kind: string; created_at: string; }
interface VersionRow { version_id: string; document_id: string; content_hash: string; byte_size: number; observed_at: string; }
interface ArtifactRow { version_id: string; extractor: string; extractor_version: string; extraction_version: string; text_content: string; page_count: number | null; pages_json: string | null; warnings_json: string; content_hash: string; created_at: string; }

const toDocument = (row: DocumentRow): SourceDocument => ({ id: row.document_id, collectionId: row.collection_id, name: row.name, kind: row.kind as SourceDocument['kind'], createdAt: row.created_at });
const toVersion = (row: VersionRow): SourceVersion => ({ id: row.version_id, documentId: row.document_id, contentHash: row.content_hash, byteSize: row.byte_size, observedAt: row.observed_at });
const toPages = (raw: string | null): ExtractedPage[] | undefined => {
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as ExtractedPage[];
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
};
const toArtifact = (row: ArtifactRow): ExtractionArtifact => {
  const pages = toPages(row.pages_json);
  return {
    extractor: row.extractor, extractorVersion: row.extractor_version, extractionVersion: row.extraction_version, text: row.text_content, pageCount: row.page_count,
    ...(pages ? { pages } : {}),
    warnings: JSON.parse(row.warnings_json) as ExtractionArtifact['warnings'], contentHash: row.content_hash, createdAt: row.created_at
  };
};

/**
 * SQLite-backed document store. A unique index over (document_id, content_hash)
 * makes recording a version idempotent: observing the same bytes twice returns
 * the original version. Extraction artifacts are keyed by version and are
 * overwritten only when the extractor identity changes, which the caller decides.
 */
export function createSqliteDocumentStore(path: string): DocumentStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS document_documents (
      document_id TEXT PRIMARY KEY, collection_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_versions (
      version_id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES document_documents(document_id),
      content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL, observed_at TEXT NOT NULL,
      UNIQUE (document_id, content_hash)
    );
    CREATE TABLE IF NOT EXISTS document_bytes (
      version_id TEXT PRIMARY KEY REFERENCES document_versions(version_id), content BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_artifacts (
      version_id TEXT PRIMARY KEY REFERENCES document_versions(version_id),
      extractor TEXT NOT NULL, extractor_version TEXT NOT NULL, extraction_version TEXT NOT NULL, text_content TEXT NOT NULL,
      page_count INTEGER, pages_json TEXT, warnings_json TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  const artifactColumns = db.query('PRAGMA table_info(document_artifacts)').all() as Array<{ name: string }>;
  if (!artifactColumns.some((column) => column.name === 'pages_json')) db.exec('ALTER TABLE document_artifacts ADD COLUMN pages_json TEXT');

  return {
    ensureDocument: (document: SourceDocument) => {
      db.query('INSERT OR IGNORE INTO document_documents (document_id, collection_id, name, kind, created_at) VALUES (?, ?, ?, ?, ?)').run(document.id, document.collectionId, document.name, document.kind, document.createdAt);
      return toDocument(db.query('SELECT document_id, collection_id, name, kind, created_at FROM document_documents WHERE document_id = ?').get(document.id) as DocumentRow);
    },
    getDocument: (documentId: string) => {
      const row = db.query('SELECT document_id, collection_id, name, kind, created_at FROM document_documents WHERE document_id = ?').get(documentId) as DocumentRow | null;
      return row ? toDocument(row) : null;
    },
    listDocuments: (collectionId: string | null) => {
      const rows = collectionId === null
        ? db.query('SELECT document_id, collection_id, name, kind, created_at FROM document_documents ORDER BY created_at').all() as DocumentRow[]
        : db.query('SELECT document_id, collection_id, name, kind, created_at FROM document_documents WHERE collection_id = ? ORDER BY created_at').all(collectionId) as DocumentRow[];
      return rows.map(toDocument);
    },
    recordVersion: (input: RecordVersionInput) => {
      const existing = db.query('SELECT version_id, document_id, content_hash, byte_size, observed_at FROM document_versions WHERE document_id = ? AND content_hash = ?').get(input.documentId, input.contentHash) as VersionRow | null;
      if (existing) return { version: toVersion(existing), created: false };
      const versionId = `${input.documentId}:${input.contentHash.slice(0, 16)}`;
      db.query('INSERT INTO document_versions (version_id, document_id, content_hash, byte_size, observed_at) VALUES (?, ?, ?, ?, ?)').run(versionId, input.documentId, input.contentHash, input.byteSize, input.observedAt);
      return { version: { id: versionId, documentId: input.documentId, contentHash: input.contentHash, byteSize: input.byteSize, observedAt: input.observedAt }, created: true };
    },
    getVersion: (versionId: string) => {
      const row = db.query('SELECT version_id, document_id, content_hash, byte_size, observed_at FROM document_versions WHERE version_id = ?').get(versionId) as VersionRow | null;
      return row ? toVersion(row) : null;
    },
    versionsOf: (documentId: string) => (db.query('SELECT version_id, document_id, content_hash, byte_size, observed_at FROM document_versions WHERE document_id = ? ORDER BY observed_at').all(documentId) as VersionRow[]).map(toVersion),
    saveBytes: (versionId, bytes) => { db.query('INSERT OR IGNORE INTO document_bytes (version_id, content) VALUES (?, ?)').run(versionId, bytes); },
    readBytes: (versionId) => {
      const row = db.query('SELECT content FROM document_bytes WHERE version_id = ?').get(versionId) as { content: Uint8Array } | null;
      return row?.content ?? null;
    },
    saveArtifact: (versionId: string, artifact: ExtractionArtifact) => {
      db.query(`INSERT INTO document_artifacts (version_id, extractor, extractor_version, extraction_version, text_content, page_count, pages_json, warnings_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(version_id) DO UPDATE SET extractor=excluded.extractor, extractor_version=excluded.extractor_version, extraction_version=excluded.extraction_version, text_content=excluded.text_content, page_count=excluded.page_count, pages_json=excluded.pages_json, warnings_json=excluded.warnings_json, content_hash=excluded.content_hash, created_at=excluded.created_at`)
        .run(versionId, artifact.extractor, artifact.extractorVersion, artifact.extractionVersion, artifact.text, artifact.pageCount, artifact.pages ? JSON.stringify(artifact.pages) : null, JSON.stringify(artifact.warnings), artifact.contentHash, artifact.createdAt);
      return artifact;
    },
    getArtifact: (versionId: string) => {
      const row = db.query('SELECT version_id, extractor, extractor_version, extraction_version, text_content, page_count, pages_json, warnings_json, content_hash, created_at FROM document_artifacts WHERE version_id = ?').get(versionId) as ArtifactRow | null;
      return row ? toArtifact(row) : null;
    },
    clearPersonalData: () => {
      const count = (db.query('SELECT COUNT(*) AS count FROM document_documents').get() as { count: number }).count;
      db.transaction(() => { db.exec('DELETE FROM document_bytes; DELETE FROM document_artifacts; DELETE FROM document_versions; DELETE FROM document_documents;'); })();
      return count;
    },
    deleteDocument: (documentId: string) => {
      db.transaction(() => {
        db.query('DELETE FROM document_bytes WHERE version_id IN (SELECT version_id FROM document_versions WHERE document_id = ?)').run(documentId);
        db.query('DELETE FROM document_artifacts WHERE version_id IN (SELECT version_id FROM document_versions WHERE document_id = ?)').run(documentId);
        db.query('DELETE FROM document_versions WHERE document_id = ?').run(documentId);
        db.query('DELETE FROM document_documents WHERE document_id = ?').run(documentId);
      })();
    },
    close: () => db.close()
  };
}
