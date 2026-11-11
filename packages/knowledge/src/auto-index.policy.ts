/**
 * Whether a document that entered a collection is indexed without the user
 * asking for it.
 *
 * A document in a collection is there to be found. A user who puts a document
 * into a collection and then has to discover that it is invisible to search
 * has been given a collection that does not do what it says. The cost of
 * indexing is small and bounded, and it is paid once per document version.
 *
 * The one exception is a document that was removed from its collection: a
 * document that no longer belongs to a collection is not indexed into it.
 */

export interface AutoIndexDecision {
  /** True when the source version should be indexed into its collection. */
  index: boolean;
  /** The reason the decision was made, for the job record. */
  reason: 'collection-member' | 'no-collection' | 'no-text' | 'index-unavailable';
}

/**
 * Decides whether a source version is indexed automatically.
 *
 * A document without a collection has no collection to be indexed into, so
 * it is left alone. A document whose text was never extracted has nothing to
 * index, so the extraction step has to run first. A document whose collection
 * is unknown to the knowledge service cannot be indexed either.
 */
export function decideAutoIndex(input: {
  collectionId: string | null | undefined;
  hasText: boolean;
  collectionKnown: boolean;
  embeddingAvailable: boolean;
}): AutoIndexDecision {
  if (!input.collectionId) return { index: false, reason: 'no-collection' };
  if (!input.collectionKnown) return { index: false, reason: 'no-collection' };
  if (!input.hasText) return { index: false, reason: 'no-text' };
  if (!input.embeddingAvailable) return { index: false, reason: 'index-unavailable' };
  return { index: true, reason: 'collection-member' };
}

/**
 * The estimated storage cost of an index, for the interface that reports it.
 *
 * A chunk holds its text, so the text is stored twice: once as the source
 * text and once inside the chunk. A vector of the given dimensions costs four
 * bytes per dimension in float32. The estimate is the sum of the chunk text
 * and the vectors, in bytes.
 */
export function estimateIndexBytes(input: { chunkTextBytes: number; chunks: number; dimensions: number }): number {
  return Math.max(0, input.chunkTextBytes) + Math.max(0, input.chunks) * Math.max(0, input.dimensions) * 4;
}
