import type {
  Chunk,
  Collection,
  DistanceMetric,
  EmbeddingIndex,
  EmbeddingIndexIdentity,
  RetrievalResult,
  RetrievalMode
} from '@office/contracts/knowledge';
import { isCompatibleIndex } from '@office/contracts/knowledge';
import type { SourceAnchor } from '@office/contracts/document';

export type {
  Chunk,
  Collection,
  DistanceMetric,
  EmbeddingIndex,
  EmbeddingIndexIdentity,
  RetrievalResult,
  RetrievalMode
} from '@office/contracts/knowledge';
export { isCompatibleIndex } from '@office/contracts/knowledge';

export const CHUNKER_VERSION = 'utf8-window-v2';

/**
 * Splits normalized text into bounded chunks and records a UTF-8 byte-range
 * anchor for each. The byte offsets are computed on the encoded text so they
 * match the anchor representation the documents module stores, never JavaScript
 * UTF-16 indices.
 */
export function chunkText(sourceVersionId: string, collectionId: string, extractionVersion: string, text: string, options: { size?: number; overlap?: number } = {}): Chunk[] {
  const size = options.size ?? 1200;
  const overlap = options.overlap ?? 200;
  if (size <= 0 || overlap < 0 || overlap >= size) throw new Error('Chunk size and overlap are invalid.');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const chunks: Chunk[] = [];
  let ordinal = 0;
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + size, bytes.length);
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    if (end <= start) throw new Error('Chunk size is too small for a UTF-8 character.');
    const slice = new TextDecoder().decode(bytes.slice(start, end));
    if (slice.trim().length) {
      const anchor: SourceAnchor = { sourceVersionId, extractionVersion, kind: 'text-range', startByte: start, endByte: end };
      chunks.push({ id: `${sourceVersionId}:${ordinal}`, sourceVersionId, collectionId, ordinal, text: slice, anchor });
      ordinal += 1;
    }
    if (end >= bytes.length) break;
    let next = Math.max(start + 1, end - overlap);
    while (next < end && (bytes[next]! & 0xc0) === 0x80) next += 1;
    start = next;
  }
  return chunks;
}

/** Cosine similarity in [-1, 1]. Returns 0 for a zero vector so a missing embedding does not score as a match. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index]! * b[index]!; normA += a[index]! ** 2; normB += b[index]! ** 2; }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ranks chunks by a query embedding. Chunks whose embedding is absent or from an
 * incompatible index are skipped rather than scored as zero, so an incompatible
 * generation never silently dominates or dilutes results.
 */
export function rankByVector(index: EmbeddingIndexIdentity, query: readonly number[], entries: readonly { chunk: Chunk; embedding: readonly number[]; identity: EmbeddingIndexIdentity }[], limit: number): RetrievalResult[] {
  return entries
    .filter((entry) => isCompatibleIndex(entry.identity, index) && entry.embedding.length === index.dimensions)
    .map((entry) => ({ entry, score: cosineSimilarity(query, entry.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ entry, score }) => ({ chunkId: entry.chunk.id, sourceVersionId: entry.chunk.sourceVersionId, collectionId: entry.chunk.collectionId, text: entry.chunk.text, score, anchor: entry.chunk.anchor, resolved: false }));
}

/**
 * Retrieval access policy. It returns only results whose source version is still
 * permitted, so a revoked source cannot be surfaced through a cached index. The
 * final check re-runs when a result is opened, which the caller performs.
 */
export interface AccessPolicy {
  canRead(collectionId: string, sourceVersionId: string): boolean;
}

export function applyAccessPolicy(results: readonly RetrievalResult[], policy: AccessPolicy): RetrievalResult[] {
  return results.filter((result) => policy.canRead(result.collectionId, result.sourceVersionId));
}

export function newCollection(id: string, name: string, createdAt = new Date().toISOString(), description = ''): Collection {
  return { id, name, ...(description ? { description } : {}), createdAt };
}

export function newIndex(id: string, collectionId: string, identity: EmbeddingIndexIdentity, createdAt = new Date().toISOString()): EmbeddingIndex {
  return { id, collectionId, ...identity, createdAt };
}

export interface RetrievalQuery {
  mode: RetrievalMode;
  text: string;
  embedding?: readonly number[];
  limit: number;
  index?: EmbeddingIndexIdentity;
  /**
   * The source versions a search may read. When it is empty the search reads
   * every indexed chunk of the given collections; when it is set the search
   * reads only those versions, which is what attaching a single document
   * means.
   */
  sourceVersionIds?: readonly string[];
  groupBySource?: boolean;
}

/** Reciprocal rank fusion keeps lexical and vector ranks on a common scale. */
export function fuseRetrieval(lexical: readonly RetrievalResult[], vector: readonly RetrievalResult[], limit: number, groupBySource = false): RetrievalResult[] {
  const ranked = new Map<string, { result: RetrievalResult; score: number }>();
  for (const list of [lexical, vector]) {
    const seen = new Set<string>();
    let rank = 0;
    for (const result of list) {
      const id = groupBySource ? result.sourceVersionId : result.chunkId;
      if (seen.has(id)) continue;
      seen.add(id); rank += 1;
      const existing = ranked.get(id);
      ranked.set(id, { result: existing?.result ?? result, score: (existing?.score ?? 0) + 1 / (60 + rank) });
    }
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(item => ({ ...item.result, score: item.score }));
}
