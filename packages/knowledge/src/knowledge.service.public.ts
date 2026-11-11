export { applyReranking } from './rerank.policy';
export { decideAutoIndex, estimateIndexBytes } from './auto-index.policy';
export type { AutoIndexDecision } from './auto-index.policy';
import type { Chunk, Collection, EmbeddingIndex, EmbeddingIndexIdentity, RetrievalResult } from '@office/contracts/knowledge';
import { isCompatibleIndex } from '@office/contracts/knowledge';
import type { ExtractionArtifact } from '@office/contracts/document';
import { applyAccessPolicy, chunkText, CHUNKER_VERSION, fuseRetrieval, newCollection, newIndex, type AccessPolicy, type RetrievalQuery } from './knowledge.domain.public';
import type { EmbeddingProvider, KnowledgeStore } from './knowledge-store.port';
import { createSqliteKnowledgeStore } from './knowledge-store.adapter';

export { createEmbeddingSelectionService, validateEmbeddingSelection } from './embedding-selection.service';
export type { EmbeddingSelection } from './knowledge-store.port';
export { createSqliteKnowledgeStore };
export { probeSqliteVec } from './vector-index.adapter';
export type { VectorProbeResult } from './vector-index.adapter';
export type { AccessPolicy, RetrievalQuery } from './knowledge.domain.public';
export type { EmbeddingProvider, KnowledgeStore, StoredEmbedding } from './knowledge-store.port';

export interface KnowledgeService {
  createCollection: (id: string, name: string, description?: string) => Collection;
  /** Renames a collection and records its description. Returns null when the collection is unknown. */
  updateCollection: (collectionId: string, name: string, description: string) => Collection | null;
  /** Removes a collection and the chunks and vectors derived from it. Returns false when the collection is unknown. */
  deleteCollection: (collectionId: string) => boolean;
  indexStatus: (collectionId: string) => { current: EmbeddingIndexIdentity | null; configured: EmbeddingIndexIdentity; rebuildRequired: boolean; chunks: number };
  /** Reports whether a source version is already indexed under the current embedding generation. */
  isSourceIndexed: (collectionId: string, sourceVersionId: string) => boolean;
  /** Number of stored chunks for a source, including full-text-only materializations. */
  sourceChunkCount: (sourceVersionId: string) => number;
  rebuildCollection: (input: { collectionId: string; sources: readonly { sourceVersionId: string; artifact: ExtractionArtifact }[]; isCancelled?: () => boolean; report?: (progress: number, checkpoint?: string | null) => void }) => Promise<{ chunks: number; index: EmbeddingIndex }>;
  restoreCollection: (collection: Collection) => Collection;
  collections: () => Collection[];
  indexSource: (input: { collectionId: string; sourceVersionId: string; artifact: ExtractionArtifact }) => Promise<{ chunks: number; index: EmbeddingIndex }>;
  indexSourceVersion: (input: IndexingInput) => Promise<{ chunks: number; index: EmbeddingIndex }>;
  /**
   * Writes searchable full-text chunks without embeddings. Used for shipped
   * seeds and any document that must be findable before a model is selected.
   */
  materializeFullText: (input: { collectionId: string; sourceVersionId: string; artifact: ExtractionArtifact }) => { chunks: number };
  retrieve: (input: { collectionIds: readonly string[]; query: RetrievalQuery; policy: AccessPolicy }) => Promise<RetrievalResult[]>;
  removeSource(sourceVersionId: string): void;
  clearPersonalData(): number;
}

export interface IndexingInput {
  collectionId: string;
  sourceVersionId: string;
  artifact: ExtractionArtifact;
  batchSize?: number;
  report?: (progress: number, checkpoint?: string | null) => void;
  isCancelled?: () => boolean;
  signal?: AbortSignal;
  representation?: 'exchange';
}

export function createKnowledgeService(store: KnowledgeStore, embedder: EmbeddingProvider): KnowledgeService {
  const identity: EmbeddingIndexIdentity = { model: embedder.model, ...(embedder.revision ? { revision: embedder.revision } : {}), dimensions: embedder.dimensions, metric: embedder.metric ?? 'cosine', chunkerVersion: embedder.chunkerVersion ?? CHUNKER_VERSION };
  const makeIndex = (collectionId: string) => newIndex(`${collectionId}:${identity.model}:${identity.revision ?? ''}:${identity.dimensions}:${identity.metric}:${identity.chunkerVersion}`, collectionId, identity);
  const defaultSize = Math.min(1200, embedder.maxInputBytes ?? 1200);
  const chunkOptions = { size: defaultSize, overlap: Math.min(200, Math.floor(defaultSize / 8)) };
  const embed = async (chunks: Chunk[], batchSize: number, isCancelled?: () => boolean, report?: (progress: number, checkpoint?: string | null) => void, checkpointPrefix?: string, signal?: AbortSignal) => {
    const vectors: { chunkId: string; embedding: number[] }[] = [];
    for (let start = 0; start < chunks.length; start += batchSize) {
      if (isCancelled?.()) throw new Error('Indexing was cancelled.');
      const batch = chunks.slice(start, start + batchSize);
      signal?.throwIfAborted();
      const embedded = await embedder.embed(batch.map((chunk) => chunk.text), signal);
      if (embedded.length !== batch.length) throw new Error('Embedding provider returned a mismatched vector count.');
      batch.forEach((chunk, position) => vectors.push({ chunkId: chunk.id, embedding: embedded[position]! }));
      report?.(chunks.length === 0 ? 1 : Math.min(1, (start + batch.length) / chunks.length), checkpointPrefix ? `${checkpointPrefix}:${start + batch.length}` : `${start + batch.length}`);
    }
    embedder.assertCurrent?.();
    if (isCancelled?.()) throw new Error('Indexing was cancelled.');
    return vectors;
  };
  const commitBatch = async (index: EmbeddingIndex, sourceVersionId: string, chunks: Chunk[], batchSize: number, isCancelled?: () => boolean, report?: (progress: number, checkpoint?: string | null) => void, signal?: AbortSignal) => {
    const vectors = await embed(chunks, batchSize, isCancelled, report, sourceVersionId, signal);
    signal?.throwIfAborted();
    embedder.assertCurrent?.();
    store.commitSourceGeneration(index, sourceVersionId, chunks, vectors);
    report?.(1, `${sourceVersionId}:done`);
    return { chunks: chunks.length, index };
  };

  return {
    createCollection: (id, name, description = '') => store.ensureCollection(newCollection(id, name, undefined, description)),
    updateCollection: (collectionId, name, description) => store.updateCollection(collectionId, name, description),
    deleteCollection: (collectionId) => store.deleteCollection(collectionId),
    indexStatus: (collectionId) => {
      const current = store.indexIdentity(collectionId);
      const rebuildRequired = !!current && (current.model !== identity.model || (current.revision ?? '') !== (identity.revision ?? '') || current.dimensions !== identity.dimensions || current.metric !== identity.metric || current.chunkerVersion !== identity.chunkerVersion);
      // The chunk count and the identity say more than "indexed": a collection
      // can carry an identity and still hold nothing to search.
      return { current, configured: identity, rebuildRequired, chunks: store.chunkCount(collectionId) };
    },
    rebuildCollection: async ({ collectionId, sources, isCancelled, report }) => {
      const uniqueSourceIds = new Set(sources.map((source) => source.sourceVersionId));
      if (uniqueSourceIds.size !== sources.length) throw new Error('A collection rebuild cannot contain duplicate source versions.');
      const prepared = sources.map(({ sourceVersionId, artifact }) => ({ sourceVersionId, chunks: chunkText(sourceVersionId, collectionId, artifact.extractionVersion, artifact.text, chunkOptions) }));
      const allChunks = prepared.flatMap((source) => source.chunks);
      // A collection whose sources carry no readable text has nothing to index.
      // Committing an empty generation would report the collection as indexed
      // while a search over it can never return a result.
      if (sources.length > 0 && allChunks.length === 0) throw new Error('None of the collection sources produced readable text, so there is nothing to index. Re-import the documents or repair the extraction step.');
      const allVectors = await embed(allChunks, 32, isCancelled, report);
      const index = makeIndex(collectionId);
      embedder.assertCurrent?.();
      store.commitCollectionGeneration(index, prepared.map((source) => ({ sourceVersionId: source.sourceVersionId, chunks: source.chunks, vectors: allVectors.filter((vector) => source.chunks.some((chunk) => chunk.id === vector.chunkId)) })));
      report?.(1, 'done');
      return { chunks: allChunks.length, index };
    },
    restoreCollection: (collection) => store.ensureCollection(collection),
    collections: () => store.listCollections(),
    isSourceIndexed: (collectionId, sourceVersionId) => {
      // A source is indexed when it holds chunks and the collection carries
      // the current generation. A collection that still carries an older
      // generation is rebuilt as a whole, so its sources count as pending.
      const current = store.indexIdentity(collectionId);
      if (!current || !isCompatibleIndex(current, identity)) return false;
      return store.sourceChunkCount(sourceVersionId) > 0;
    },
    sourceChunkCount: (sourceVersionId) => store.sourceChunkCount(sourceVersionId),
    indexSource: ({ collectionId, sourceVersionId, artifact }) => {
      const chunks = chunkText(sourceVersionId, collectionId, artifact.extractionVersion, artifact.text, chunkOptions);
      return commitBatch(makeIndex(collectionId), sourceVersionId, chunks, 32);
    },
    indexSourceVersion: ({ collectionId, sourceVersionId, artifact, batchSize = 32, report, isCancelled, signal, representation }) => {
      if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Batch size must be a positive integer.');
      const size = representation === 'exchange' ? embedder.maxInputBytes ?? 1200 : Math.min(1200, embedder.maxInputBytes ?? 1200);
      const chunks = chunkText(sourceVersionId, collectionId, artifact.extractionVersion, artifact.text, { size, overlap: Math.min(200, Math.floor(size / 8)) });
      return commitBatch(makeIndex(collectionId), sourceVersionId, chunks, batchSize, isCancelled, report, signal);
    },
    materializeFullText: ({ collectionId, sourceVersionId, artifact }) => {
      const chunks = chunkText(sourceVersionId, collectionId, artifact.extractionVersion, artifact.text, chunkOptions);
      store.replaceChunks(collectionId, sourceVersionId, identity.chunkerVersion, chunks);
      return { chunks: chunks.length };
    },
    retrieve: async ({ collectionIds, query, policy }) => {
      if (collectionIds.length === 0) return [];
      // A search that names its source versions reads only those versions, so
      // attaching one document brings that document and nothing else.
      const sources = query.sourceVersionIds?.length ? query.sourceVersionIds : undefined;
      let results: RetrievalResult[];
      if (query.mode === 'full-text' || !query.embedding || !query.index) {
        results = store.fullTextSearch(collectionIds, query.text, query.limit, sources, query.groupBySource);
      } else if (query.mode === 'vector') {
        results = store.vectorSearch(collectionIds, query.index, query.embedding, query.limit, sources, query.groupBySource);
      } else {
        const lexical = store.fullTextSearch(collectionIds, query.text, query.limit, sources, query.groupBySource);
        const vector = store.vectorSearch(collectionIds, query.index, query.embedding, query.limit, sources, query.groupBySource);
        results = fuseRetrieval(lexical, vector, query.limit, query.groupBySource);
      }
      return applyAccessPolicy(results, policy);
    },
    removeSource: (sourceVersionId) => store.removeSourceVersion(sourceVersionId),
    clearPersonalData: () => { const count = store.collectionCount(); store.clearPersonalData(); return count; }
  };
}

export function createDeterministicEmbeddingProvider(dimensions = 64, model = 'deterministic-hash'): EmbeddingProvider {
  return {
    model,
    dimensions,
    embed: async (texts) => texts.map((text) => {
      const vector = new Array<number>(dimensions).fill(0);
      for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 0;
        for (let index = 0; index < token.length; index++) hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
        vector[hash % dimensions] += 1;
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    })
  };
}

export function chunkCount(store: KnowledgeStore, sourceVersionId: string): number {
  return store.chunksOf(sourceVersionId).length;
}

export type { Chunk };
