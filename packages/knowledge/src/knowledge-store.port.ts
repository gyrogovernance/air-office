import type { Chunk, Collection, EmbeddingIndex, EmbeddingIndexIdentity, RetrievalMode, RetrievalResult } from '@office/contracts/knowledge';

export interface StoredEmbedding {
  chunk: Chunk;
  embedding: number[];
  identity: EmbeddingIndexIdentity;
}

/**
 * Persistence and retrieval boundary for knowledge. The store owns chunk rows,
 * embedding rows and full-text search; ranking policy lives in the domain file.
 * A retrieval call never returns a result the caller cannot filter by access.
 */
export interface EmbeddingSelection {
  model: string;
  revision: string;
  dimensions: number;
  mode: 'runtime' | 'demo';
  rerankModel?: string;
  inputTokenLimit?: number;
  rerankTokenLimit?: number;
}

export interface KnowledgeStore {
  embeddingSelection(): EmbeddingSelection | null;
  saveEmbeddingSelection(selection: EmbeddingSelection): void;
  ensureCollection(collection: Collection): Collection;
  getCollection(collectionId: string): Collection | null;
  listCollections(): Collection[];
  /** Renames a collection and stores its description. Returns null when the collection is unknown. */
  updateCollection(collectionId: string, name: string, description: string): Collection | null;
  /** Removes a collection together with its chunks, vectors and index identity. Returns false when the collection is unknown. */
  deleteCollection(collectionId: string): boolean;
  /** Replaces all chunks for a source version in a collection. Idempotent for a given chunker version. */
  replaceChunks(collectionId: string, sourceVersionId: string, chunkerVersion: string, chunks: Chunk[]): void;
  chunksOf(sourceVersionId: string): Chunk[];
  /** Number of indexed chunks a collection holds. A collection with no chunks has nothing to search. */
  chunkCount(collectionId: string): number;
  /** Number of indexed chunks a source version holds. A source with chunks is already indexed. */
  sourceChunkCount(sourceVersionId: string): number;
  /** Atomically replaces every source in a collection and commits its identity last. */
  commitCollectionGeneration(index: EmbeddingIndex, sources: readonly { sourceVersionId: string; chunks: Chunk[]; vectors: { chunkId: string; embedding: number[] }[] }[]): void;
  /** Stores vectors under a generation. */
  storeEmbeddings(index: EmbeddingIndex, vectors: { chunkId: string; embedding: number[] }[]): void;
  /** Atomically replaces source chunks and vectors, committing the collection identity last. */
  commitSourceGeneration(index: EmbeddingIndex, sourceVersionId: string, chunks: Chunk[], vectors: { chunkId: string; embedding: number[] }[]): void;
  indexIdentity(collectionId: string): EmbeddingIndexIdentity | null;
  setIndexIdentity(index: EmbeddingIndex): void;
  removeSourceVersion(sourceVersionId: string): void;
  collectionCount(): number;
  clearPersonalData(): void;
  /** Full-text search over chunk text, bounded to a set of collection ids. */
  fullTextSearch(collectionIds: readonly string[], query: string, limit: number, sourceVersionIds?: readonly string[], groupBySource?: boolean): RetrievalResult[];
  /** Returns stored embeddings for vector ranking, bounded to collection ids and an index generation. */
  vectorEntries(collectionIds: readonly string[], identity: EmbeddingIndexIdentity, sourceVersionIds?: readonly string[]): StoredEmbedding[];
  vectorSearch(collectionIds: readonly string[], identity: EmbeddingIndexIdentity, query: readonly number[], limit: number, sourceVersionIds?: readonly string[], groupBySource?: boolean): RetrievalResult[];
  close(): void;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly revision?: string;
  /** Reject a completed batch if its selected generation was superseded. */
  assertCurrent?(): void;
  readonly dimensions: number;
  readonly metric?: EmbeddingIndexIdentity['metric'];
  readonly chunkerVersion?: string;
  readonly maxInputBytes?: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

export type { RetrievalMode };
