/**
 * Knowledge and retrieval contracts. Chunks and embeddings are derived data that
 * can be rebuilt. An embedding index records its model, dimensions and distance
 * metric so vectors from incompatible embedding spaces are never mixed.
 */
import type { SourceAnchor } from './document.contracts.public';

export interface Collection {
  id: string;
  name: string;
  /** A short statement of what the collection holds. Optional, because collections created before descriptions existed carry none. */
  description?: string;
  createdAt: string;
}

export interface Chunk {
  id: string;
  sourceVersionId: string;
  collectionId: string;
  /** Chunk position within the source version, zero-based and stable for a given chunker config. */
  ordinal: number;
  text: string;
  anchor: SourceAnchor;
}

export type DistanceMetric = 'cosine' | 'l2';

/** Identity of one embedding generation. Changing any field starts a new generation rather than reusing old vectors. */
export interface EmbeddingIndexIdentity {
  model: string;
  /** Absent only for legacy indexes and explicitly constructed test fixtures. */
  revision?: string;
  dimensions: number;
  metric: DistanceMetric;
  chunkerVersion: string;
}

export interface EmbeddingIndex extends EmbeddingIndexIdentity {
  id: string;
  collectionId: string;
  createdAt: string;
}

/** True when two indexes could share a vector space. Different dimensions, model or metric never match. */
export function isCompatibleIndex(a: EmbeddingIndexIdentity, b: EmbeddingIndexIdentity): boolean {
  return a.model === b.model && a.dimensions === b.dimensions && a.metric === b.metric && (a.revision ?? '') === (b.revision ?? '') && a.chunkerVersion === b.chunkerVersion;
}

export interface RetrievalResult {
  chunkId: string;
  sourceVersionId: string;
  collectionId: string;
  text: string;
  score: number;
  anchor: SourceAnchor;
  /** False when the cited location could not be resolved back to the source and the caller must label it unresolved. */
  resolved: boolean;
}

export type RetrievalMode = 'vector' | 'full-text' | 'hybrid';
