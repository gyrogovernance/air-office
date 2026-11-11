/** A reranker may only reorder the supplied results, never create source identities. */
export function applyReranking<T>(results: readonly T[], ranked: readonly { index: number; relevance_score: number }[]): T[] {
  if (ranked.length !== results.length || new Set(ranked.map((item) => item.index)).size !== results.length || ranked.some((item) => !Number.isSafeInteger(item.index) || item.index < 0 || item.index >= results.length || !Number.isFinite(item.relevance_score))) throw new Error('The reranker returned an incomplete or invalid result set.');
  return [...ranked].sort((a, b) => b.relevance_score - a.relevance_score).map((item) => results[item.index]!);
}
