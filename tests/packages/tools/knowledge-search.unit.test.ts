import { expect, test } from 'bun:test';

/**
 * Compact knowledge_search hit shaping (mirrors the service handler policy):
 * empty readable collections → no hits; never leak ACL-only collections.
 */
function shapeKnowledgeHits(input: {
  query: string;
  collectionIds?: string[];
  knownIds: readonly string[];
  blockedIds?: readonly string[];
  retrieve: (collectionIds: string[]) => { collectionId: string; sourceVersionId: string; text: string; score: number }[];
}) {
  const query = input.query.trim();
  if (!query) throw new Error('A search query is required.');
  const blocked = new Set(input.blockedIds ?? []);
  const known = new Set(input.knownIds);
  const requested = Array.isArray(input.collectionIds) && input.collectionIds.length
    ? input.collectionIds.filter((id) => known.has(id) && !blocked.has(id))
    : [...known].filter((id) => !blocked.has(id));
  if (!requested.length) return { hits: [] as const };
  return {
    hits: input.retrieve(requested).map((row) => ({
      collectionId: row.collectionId,
      sourceVersionId: row.sourceVersionId,
      text: row.text,
      score: row.score,
    })),
  };
}

test('knowledge_search returns empty hits when no readable collections exist', () => {
  expect(shapeKnowledgeHits({
    query: 'hello',
    knownIds: ['reasoning'],
    blockedIds: ['reasoning'],
    retrieve: () => [{ collectionId: 'reasoning', sourceVersionId: 'x', text: 'secret', score: 1 }],
  })).toEqual({ hits: [] });
});

test('knowledge_search uses all readable collections when none are named', () => {
  const result = shapeKnowledgeHits({
    query: 'hello',
    knownIds: ['docs', 'reasoning'],
    blockedIds: ['reasoning'],
    retrieve: (ids) => ids.map((id) => ({ collectionId: id, sourceVersionId: `${id}-v`, text: 'hit', score: 0.5 })),
  });
  expect(result.hits).toEqual([
    { collectionId: 'docs', sourceVersionId: 'docs-v', text: 'hit', score: 0.5 },
  ]);
});
