import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Chunk, Collection, EmbeddingIndex, EmbeddingIndexIdentity, RetrievalResult } from '@office/contracts/knowledge';
import { isCompatibleIndex } from '@office/contracts/knowledge';
import type { SourceAnchor } from '@office/contracts/document';
import type { KnowledgeStore, StoredEmbedding } from './knowledge-store.port';
import { fullTextQueryLadder } from './full-text-query.policy';
import { cosineSimilarity } from './knowledge.domain.public';

interface ChunkRow { chunk_id: string; source_version_id: string; collection_id: string; ordinal: number; text_content: string; anchor_json: string; chunker_version: string; }

const toChunk = (row: ChunkRow): Chunk => ({ id: row.chunk_id, sourceVersionId: row.source_version_id, collectionId: row.collection_id, ordinal: row.ordinal, text: row.text_content, anchor: JSON.parse(row.anchor_json) as SourceAnchor });

/**
 * SQLite knowledge store. Full-text search uses the built-in FTS5 index over
 * chunk text. Vectors are stored as raw Float32 bytes keyed by chunk and index
 * generation, so an incompatible generation is never loaded for ranking. All
 * writes for a source version in a collection are transactional.
 */
export function createSqliteKnowledgeStore(path: string): KnowledgeStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS knowledge_collections (collection_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      chunk_id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL, collection_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL, text_content TEXT NOT NULL, anchor_json TEXT NOT NULL, chunker_version TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_chunks_source ON knowledge_chunks (source_version_id);
    CREATE INDEX IF NOT EXISTS knowledge_chunks_collection ON knowledge_chunks (collection_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(chunk_id UNINDEXED, text_content);
    CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      chunk_id TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, metric TEXT NOT NULL,
      vector BLOB NOT NULL, PRIMARY KEY (chunk_id, model, dimensions, metric)
    );
    CREATE TABLE IF NOT EXISTS knowledge_indexes (
      collection_id TEXT PRIMARY KEY, index_id TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, metric TEXT NOT NULL, chunker_version TEXT NOT NULL, created_at TEXT NOT NULL
    );`);

  const indexColumns = db.query('PRAGMA table_info(knowledge_indexes)').all() as { name: string }[];
  if (!indexColumns.some((column) => column.name === 'revision')) db.exec("ALTER TABLE knowledge_indexes ADD COLUMN revision TEXT NOT NULL DEFAULT ''");
  const collectionColumns = db.query('PRAGMA table_info(knowledge_collections)').all() as { name: string }[];
  if (!collectionColumns.some((column) => column.name === 'description')) db.exec("ALTER TABLE knowledge_collections ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  // Old rows retain an unknown revision and therefore require rebuilding for a selected real revision.
  const vectorColumns = db.query('PRAGMA table_info(knowledge_embeddings)').all() as { name: string }[];
  if (!vectorColumns.some((column) => column.name === 'revision')) db.transaction(() => {
    db.exec(`ALTER TABLE knowledge_embeddings RENAME TO knowledge_embeddings_legacy;
      CREATE TABLE knowledge_embeddings (chunk_id TEXT NOT NULL, model TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '', dimensions INTEGER NOT NULL, metric TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY (chunk_id, model, revision, dimensions, metric));
      INSERT INTO knowledge_embeddings (chunk_id, model, dimensions, metric, vector) SELECT chunk_id, model, dimensions, metric, vector FROM knowledge_embeddings_legacy;
      DROP TABLE knowledge_embeddings_legacy;`);
  })();
  db.exec('CREATE TABLE IF NOT EXISTS knowledge_embedding_selection (id INTEGER PRIMARY KEY CHECK (id = 1), selection_json TEXT NOT NULL)');

  const toBlob = (vector: readonly number[]) => new Uint8Array(new Float32Array(vector).buffer);
  const fromBlob = (blob: Uint8Array) => Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));

  return {
    embeddingSelection: () => {
      const row = db.query('SELECT selection_json FROM knowledge_embedding_selection WHERE id = 1').get() as { selection_json: string } | null;
      return row ? JSON.parse(row.selection_json) : null;
    },
    saveEmbeddingSelection: (selection) => { db.query('INSERT OR REPLACE INTO knowledge_embedding_selection (id, selection_json) VALUES (1, ?)').run(JSON.stringify(selection)); },
    ensureCollection: (collection: Collection) => {
      db.query('INSERT OR IGNORE INTO knowledge_collections (collection_id, name, description, created_at) VALUES (?, ?, ?, ?)').run(collection.id, collection.name, collection.description ?? '', collection.createdAt);
      return collection;
    },
    getCollection: (collectionId: string) => {
      const row = db.query('SELECT collection_id, name, description, created_at FROM knowledge_collections WHERE collection_id = ?').get(collectionId) as { collection_id: string; name: string; description: string; created_at: string } | null;
      return row ? { id: row.collection_id, name: row.name, ...(row.description ? { description: row.description } : {}), createdAt: row.created_at } : null;
    },
    listCollections: () => (db.query('SELECT collection_id, name, description, created_at FROM knowledge_collections ORDER BY created_at').all() as { collection_id: string; name: string; description: string; created_at: string }[])
      .map((row): Collection => ({ id: row.collection_id, name: row.name, ...(row.description ? { description: row.description } : {}), createdAt: row.created_at })),
    updateCollection: (collectionId, name, description) => {
      const existing = db.query('SELECT collection_id, name, description, created_at FROM knowledge_collections WHERE collection_id = ?').get(collectionId) as { collection_id: string; name: string; description: string; created_at: string } | null;
      if (!existing) return null;
      db.query('UPDATE knowledge_collections SET name = ?, description = ? WHERE collection_id = ?').run(name, description, collectionId);
      return { id: existing.collection_id, name, ...(description ? { description } : {}), createdAt: existing.created_at };
    },
    deleteCollection: (collectionId: string) => {
      const existing = db.query('SELECT collection_id FROM knowledge_collections WHERE collection_id = ?').get(collectionId) as { collection_id: string } | null;
      if (!existing) return false;
      db.transaction(() => {
        const chunks = db.query('SELECT chunk_id FROM knowledge_chunks WHERE collection_id = ?').all(collectionId) as { chunk_id: string }[];
        for (const row of chunks) { db.query('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(row.chunk_id); db.query('DELETE FROM knowledge_embeddings WHERE chunk_id = ?').run(row.chunk_id); }
        db.query('DELETE FROM knowledge_chunks WHERE collection_id = ?').run(collectionId);
        db.query('DELETE FROM knowledge_indexes WHERE collection_id = ?').run(collectionId);
        db.query('DELETE FROM knowledge_collections WHERE collection_id = ?').run(collectionId);
      })();
      return true;
    },
    replaceChunks: (collectionId: string, sourceVersionId: string, chunkerVersion: string, chunks: Chunk[]) => {
      db.transaction(() => {
        const prior = db.query('SELECT chunk_id FROM knowledge_chunks WHERE source_version_id = ?').all(sourceVersionId) as { chunk_id: string }[];
        for (const row of prior) { db.query('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(row.chunk_id); db.query('DELETE FROM knowledge_embeddings WHERE chunk_id = ?').run(row.chunk_id); }
        db.query('DELETE FROM knowledge_chunks WHERE source_version_id = ?').run(sourceVersionId);
        const insert = db.query('INSERT INTO knowledge_chunks (chunk_id, source_version_id, collection_id, ordinal, text_content, anchor_json, chunker_version) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertFts = db.query('INSERT INTO knowledge_chunks_fts (chunk_id, text_content) VALUES (?, ?)');
        for (const chunk of chunks) { insert.run(chunk.id, chunk.sourceVersionId, collectionId, chunk.ordinal, chunk.text, JSON.stringify(chunk.anchor), chunkerVersion); insertFts.run(chunk.id, chunk.text); }
      })();
    },
    chunksOf: (sourceVersionId: string) => (db.query('SELECT chunk_id, source_version_id, collection_id, ordinal, text_content, anchor_json, chunker_version FROM knowledge_chunks WHERE source_version_id = ? ORDER BY ordinal').all(sourceVersionId) as ChunkRow[]).map(toChunk),
    chunkCount: (collectionId: string) => (db.query('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE collection_id = ?').get(collectionId) as { count: number }).count,
    sourceChunkCount: (sourceVersionId: string) => (db.query('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE source_version_id = ?').get(sourceVersionId) as { count: number }).count,
    commitCollectionGeneration: (index, sources) => {
      db.transaction(() => {
        const prior = db.query('SELECT chunk_id FROM knowledge_chunks WHERE collection_id = ?').all(index.collectionId) as { chunk_id: string }[];
        for (const row of prior) { db.query('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(row.chunk_id); db.query('DELETE FROM knowledge_embeddings WHERE chunk_id = ?').run(row.chunk_id); }
        db.query('DELETE FROM knowledge_chunks WHERE collection_id = ?').run(index.collectionId);
        const insertChunk = db.query('INSERT INTO knowledge_chunks (chunk_id, source_version_id, collection_id, ordinal, text_content, anchor_json, chunker_version) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertFts = db.query('INSERT INTO knowledge_chunks_fts (chunk_id, text_content) VALUES (?, ?)');
        const insertVector = db.query('INSERT INTO knowledge_embeddings (chunk_id, model, dimensions, metric, revision, vector) VALUES (?, ?, ?, ?, ?, ?)');
        for (const source of sources) {
          const sourceChunkIds = new Set(source.chunks.map((chunk) => chunk.id));
          for (const chunk of source.chunks) { insertChunk.run(chunk.id, source.sourceVersionId, index.collectionId, chunk.ordinal, chunk.text, JSON.stringify(chunk.anchor), index.chunkerVersion); insertFts.run(chunk.id, chunk.text); }
          for (const { chunkId, embedding } of source.vectors) {
            if (!sourceChunkIds.has(chunkId)) throw new Error('Embedding references a chunk outside the replacement generation.');
            if (embedding.length !== index.dimensions) throw new Error('Embedding dimensions do not match the index.');
            insertVector.run(chunkId, index.model, index.dimensions, index.metric, index.revision ?? '', toBlob(embedding));
          }
          if (source.vectors.length !== source.chunks.length) throw new Error('Every chunk must have an embedding in the replacement generation.');
        }
        db.query('INSERT OR REPLACE INTO knowledge_indexes (collection_id, index_id, model, dimensions, metric, chunker_version, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(index.collectionId, index.id, index.model, index.dimensions, index.metric, index.chunkerVersion, index.revision ?? '', index.createdAt);
      })();
    },
    storeEmbeddings: (index, vectors) => {
      db.transaction(() => {
        for (const { chunkId, embedding } of vectors) {
          if (embedding.length !== index.dimensions) throw new Error('Embedding dimensions do not match the index.');
          db.query('INSERT OR REPLACE INTO knowledge_embeddings (chunk_id, model, dimensions, metric, revision, vector) VALUES (?, ?, ?, ?, ?, ?)').run(chunkId, index.model, index.dimensions, index.metric, index.revision ?? '', toBlob(embedding));
        }
      })();
    },
    commitSourceGeneration: (index, sourceVersionId, chunks, vectors) => {
      db.transaction(() => {
        const priorIndex = db.query('SELECT model, revision, dimensions, metric, chunker_version FROM knowledge_indexes WHERE collection_id = ?').get(index.collectionId) as { model: string; revision: string; dimensions: number; metric: EmbeddingIndexIdentity['metric']; chunker_version: string } | null;
        if (priorIndex && !isCompatibleIndex(index, { model: priorIndex.model, revision: priorIndex.revision, dimensions: priorIndex.dimensions, metric: priorIndex.metric, chunkerVersion: priorIndex.chunker_version })) throw new Error('Rebuild the collection before indexing with a different embedding generation.');
        const prior = db.query('SELECT chunk_id FROM knowledge_chunks WHERE source_version_id = ?').all(sourceVersionId) as { chunk_id: string }[];
        for (const row of prior) { db.query('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(row.chunk_id); db.query('DELETE FROM knowledge_embeddings WHERE chunk_id = ?').run(row.chunk_id); }
        db.query('DELETE FROM knowledge_chunks WHERE source_version_id = ?').run(sourceVersionId);
        const insertChunk = db.query('INSERT INTO knowledge_chunks (chunk_id, source_version_id, collection_id, ordinal, text_content, anchor_json, chunker_version) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertFts = db.query('INSERT INTO knowledge_chunks_fts (chunk_id, text_content) VALUES (?, ?)');
        for (const chunk of chunks) { insertChunk.run(chunk.id, sourceVersionId, index.collectionId, chunk.ordinal, chunk.text, JSON.stringify(chunk.anchor), index.chunkerVersion); insertFts.run(chunk.id, chunk.text); }
        const insertVector = db.query('INSERT INTO knowledge_embeddings (chunk_id, model, dimensions, metric, revision, vector) VALUES (?, ?, ?, ?, ?, ?)');
        for (const { chunkId, embedding } of vectors) {
          if (!chunks.some((chunk) => chunk.id === chunkId)) throw new Error('Embedding references a chunk outside the replacement generation.');
          if (embedding.length !== index.dimensions) throw new Error('Embedding dimensions do not match the index.');
          insertVector.run(chunkId, index.model, index.dimensions, index.metric, index.revision ?? '', toBlob(embedding));
        }
        if (vectors.length !== chunks.length) throw new Error('Every chunk must have an embedding in the replacement generation.');
        db.query('INSERT OR REPLACE INTO knowledge_indexes (collection_id, index_id, model, dimensions, metric, chunker_version, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(index.collectionId, index.id, index.model, index.dimensions, index.metric, index.chunkerVersion, index.revision ?? '', index.createdAt);
      })();
    },
    indexIdentity: (collectionId: string) => {
      const row = db.query('SELECT model, revision, dimensions, metric, chunker_version FROM knowledge_indexes WHERE collection_id = ?').get(collectionId) as { model: string; revision: string; dimensions: number; metric: string; chunker_version: string } | null;
      return row ? { model: row.model, ...(row.revision ? { revision: row.revision } : {}), dimensions: row.dimensions, metric: row.metric as EmbeddingIndexIdentity['metric'], chunkerVersion: row.chunker_version } : null;
    },
    setIndexIdentity: (index: EmbeddingIndex) => {
      db.query('INSERT OR REPLACE INTO knowledge_indexes (collection_id, index_id, model, dimensions, metric, chunker_version, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(index.collectionId, index.id, index.model, index.dimensions, index.metric, index.chunkerVersion, index.revision ?? '', index.createdAt);
    },
    removeSourceVersion: (sourceVersionId: string) => {
      db.transaction(() => {
        const prior = db.query('SELECT chunk_id FROM knowledge_chunks WHERE source_version_id = ?').all(sourceVersionId) as { chunk_id: string }[];
        for (const row of prior) { db.query('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(row.chunk_id); db.query('DELETE FROM knowledge_embeddings WHERE chunk_id = ?').run(row.chunk_id); }
        db.query('DELETE FROM knowledge_chunks WHERE source_version_id = ?').run(sourceVersionId);
      })();
    },
    fullTextSearch: (collectionIds: readonly string[], query: string, limit: number, sourceVersionIds?: readonly string[], groupBySource = false) => {
      if (collectionIds.length === 0 || query.trim().length === 0) return [];
      const placeholders = collectionIds.map(() => '?').join(', ');
      // A search that names its source versions reads only those versions, so
      // attaching a single document brings that document and nothing else.
      const sourceClause = sourceVersionIds?.length ? ' AND c.source_version_id IN (SELECT value FROM json_each(?))' : '';
      const sourceArgs = sourceVersionIds?.length ? [JSON.stringify(sourceVersionIds)] : [];
      const select = (match: string) => {
        const rows = db.query<{ chunk_id: string; source_version_id: string; score: number }, (string | number)[]>(`SELECT c.chunk_id,c.source_version_id,f.rank AS score
        FROM knowledge_chunks_fts f JOIN knowledge_chunks c ON c.chunk_id = f.chunk_id
        WHERE knowledge_chunks_fts MATCH ? AND c.collection_id IN (${placeholders})${sourceClause}
        ORDER BY score`);
        const selected: { chunk_id: string; score: number }[] = [];
        const seen = new Set<string>();
        for (const row of rows.iterate(match, ...collectionIds, ...sourceArgs)) {
          const key = groupBySource ? row.source_version_id : row.chunk_id;
          if (seen.has(key)) continue;
          seen.add(key); selected.push(row);
          if (selected.length >= Math.max(1, limit)) break;
        }
        return selected;
      };
      // The query is rebuilt from its terms before it reaches the index. The
      // index grammar reads punctuation as operators, so an unescaped hyphen or
      // quote would abort the search instead of narrowing it.
      //
      // The strict query requires every term and is the precise answer. A
      // question written as a sentence cannot satisfy it, because it names
      // words the document does not contain. The relaxed query is therefore
      // the fallback: it requires any term, and the index ranking still puts
      // the chunk with the distinctive words first.
      const queries = fullTextQueryLadder(query);
      if (!queries.length) return [];
      let rows: { chunk_id: string; score: number }[] = [];
      for (const match of queries) {
        if (!match) continue;
        rows = select(match);
        if (rows.length) break;
      }
      return rows.flatMap(hit => {
        const row = db.query<ChunkRow, [string]>('SELECT * FROM knowledge_chunks WHERE chunk_id=?').get(hit.chunk_id);
        return row ? [{ chunkId: row.chunk_id, sourceVersionId: row.source_version_id, collectionId: row.collection_id, text: row.text_content, score: -hit.score, anchor: toChunk(row).anchor, resolved: false }] : [];
      });
    },
    vectorSearch: (collectionIds, identity, query, limit, sourceVersionIds, groupBySource = false) => {
      if (!collectionIds.length || limit <= 0 || query.length !== identity.dimensions) return [];
      const sourceClause = sourceVersionIds?.length ? ' AND c.source_version_id IN (SELECT value FROM json_each(?))' : '';
      const sourceArgs = sourceVersionIds?.length ? [JSON.stringify(sourceVersionIds)] : [];
      const rows = db.query<{ chunk_id: string; source_version_id: string; vector: Uint8Array }, (string | number)[]>(`SELECT c.chunk_id,c.source_version_id,e.vector
        FROM knowledge_embeddings e JOIN knowledge_chunks c ON c.chunk_id=e.chunk_id
        WHERE e.model=? AND e.dimensions=? AND e.metric=? AND e.revision=? AND c.chunker_version=? AND c.collection_id IN (${collectionIds.map(() => '?').join(',')})${sourceClause}`);
      const best: { id: string; key: string; score: number }[] = [];
      for (const row of rows.iterate(identity.model, identity.dimensions, identity.metric, identity.revision ?? '', identity.chunkerVersion, ...collectionIds, ...sourceArgs)) {
        const score = cosineSimilarity(query, fromBlob(row.vector));
        const key = groupBySource ? row.source_version_id : row.chunk_id;
        const found = best.findIndex(item => item.key === key);
        if (found >= 0 && best[found]!.score >= score) continue;
        if (found >= 0) best.splice(found, 1);
        if (best.length >= limit && best[best.length - 1]!.score >= score) continue;
        best.push({ id: row.chunk_id, key, score }); best.sort((a, b) => b.score - a.score);
        if (best.length > limit) best.pop();
      }
      return best.flatMap(item => {
        const row = db.query<ChunkRow, [string]>('SELECT * FROM knowledge_chunks WHERE chunk_id=?').get(item.id);
        if (!row) return [];
        return [{ chunkId: row.chunk_id, sourceVersionId: row.source_version_id, collectionId: row.collection_id, text: row.text_content, score: item.score, anchor: toChunk(row).anchor, resolved: false }];
      });
    },
    vectorEntries: (collectionIds: readonly string[], identity: EmbeddingIndexIdentity, sourceVersionIds?: readonly string[]) => {
      if (collectionIds.length === 0) return [];
      const placeholders = collectionIds.map(() => '?').join(', ');
      const sourceClause = sourceVersionIds?.length ? ' AND c.source_version_id IN (SELECT value FROM json_each(?))' : '';
      const sourceArgs = sourceVersionIds?.length ? [JSON.stringify(sourceVersionIds)] : [];
      const rows = db.query(`SELECT c.chunk_id, c.source_version_id, c.collection_id, c.ordinal, c.text_content, c.anchor_json, c.chunker_version, e.vector
        FROM knowledge_embeddings e JOIN knowledge_chunks c ON c.chunk_id = e.chunk_id
        WHERE e.model = ? AND e.dimensions = ? AND e.metric = ? AND e.revision = ? AND c.chunker_version = ? AND c.collection_id IN (${placeholders})${sourceClause}`)
        .all(identity.model, identity.dimensions, identity.metric, identity.revision ?? '', identity.chunkerVersion, ...collectionIds, ...sourceArgs) as (ChunkRow & { vector: Uint8Array })[];
      return rows.map((row): StoredEmbedding => ({ chunk: toChunk(row), embedding: fromBlob(row.vector), identity }));
    },
    collectionCount: () => (db.query('SELECT COUNT(*) AS count FROM knowledge_collections').get() as { count: number }).count,
    clearPersonalData: () => db.transaction(() => { db.exec('DELETE FROM knowledge_embeddings; DELETE FROM knowledge_chunks_fts; DELETE FROM knowledge_chunks; DELETE FROM knowledge_indexes; DELETE FROM knowledge_collections; DELETE FROM knowledge_embedding_selection;'); })(),
    close: () => db.close()
  };
}
