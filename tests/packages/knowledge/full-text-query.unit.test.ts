import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteKnowledgeStore } from '../../../packages/knowledge/src/knowledge-store.adapter';
import { buildFullTextQuery, fullTextQueryLadder } from '../../../packages/knowledge/src/full-text-query.policy';

/**
 * The full-text index reads punctuation as query operators. A user query that
 * reaches the index unchanged therefore aborts the search with an error
 * instead of returning fewer results, which surfaces as a failed request
 * rather than an empty answer.
 */
test('a query with punctuation returns results instead of failing the search', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-fts-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    store.ensureCollection({ id: 'c1', name: 'Research', createdAt: new Date(0).toISOString() });
    const chunk = { id: 'k1', sourceVersionId: 'v1', collectionId: 'c1', ordinal: 0, text: 'high-risk systems are risk based and must be supervised by humans and not left alone.', anchor: { sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range' as const, startByte: 0, endByte: 10 } };
    store.replaceChunks('c1', 'v1', 'char-window-v1', [chunk]);
    // Each of these aborted the search with a SQLite error before the query was
    // rebuilt from its terms.
    expect(store.fullTextSearch(['c1'], 'high-risk systems', 5).length).toBeGreaterThan(0);
    expect(store.fullTextSearch(['c1'], 'risk-based', 5).length).toBeGreaterThan(0);
    expect(store.fullTextSearch(['c1'], 'NOT supervised', 5).length).toBeGreaterThan(0);
    expect(store.fullTextSearch(['c1'], '(supervised)', 5).length).toBeGreaterThan(0);
    // An unbalanced quote must not abort the search, and the readable terms
    // beside it must still reach the index.
    expect(store.fullTextSearch(['c1'], 'supervised "systems', 5).length).toBeGreaterThan(0);
    expect(store.fullTextSearch(['c1'], 'a "b', 5)).toEqual([]);
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('a query made only of punctuation matches nothing rather than everything', () => {
  expect(buildFullTextQuery('---')).toBe('');
  expect(buildFullTextQuery('   ')).toBe('');
  expect(buildFullTextQuery('*')).toBe('');
});

test('a quoted phrase stays one clause while separate words are joined', () => {
  expect(buildFullTextQuery('"risk assessment"')).toBe('"risk assessment"');
  expect(buildFullTextQuery('human oversight')).toBe('"human" AND "oversight"');
  expect(buildFullTextQuery('"risk" management')).toBe('"risk" AND "management"');
});

test('a term that the index grammar would read as an operator is kept as a term', () => {
  // A hyphen reads as a column reference and a star reads as a prefix
  // operator. Both must reach the index as quoted terms.
  expect(buildFullTextQuery('high-risk')).toBe('"high" AND "risk"');
  expect(buildFullTextQuery('risk*')).toBe('"risk"');
});

/**
 * A question written as a sentence names words the document does not
 * contain. The strict query requires every word, so it matched nothing and
 * the message travelled without any context at all. The relaxed query
 * requires any word, and the ranking still puts the chunk with the
 * distinctive words first.
 */
test('a question written as a sentence still retrieves the document it names', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-fts-sentence-'));
  const store = createSqliteKnowledgeStore(join(scratch, 'knowledge.sqlite'));
  try {
    store.ensureCollection({ id: 'c1', name: 'Research', createdAt: new Date(0).toISOString() });
    const chunk = { id: 'k1', sourceVersionId: 'v1', collectionId: 'c1', ordinal: 0, text: 'The Human Mark is the threshold where a person must remain responsible for the outcome.', anchor: { sourceVersionId: 'v1', extractionVersion: 'anchor-v1', kind: 'text-range' as const, startByte: 0, endByte: 10 } };
    store.replaceChunks('c1', 'v1', 'char-window-v1', [chunk]);
    const question = 'What is the Human Mark? Answer from the attached knowledge.';
    // The strict query cannot match this question, because it names words the
    // document does not contain.
    expect(store.fullTextSearch(['c1'], question, 5).length).toBeGreaterThan(0);
    const results = store.fullTextSearch(['c1'], question, 5);
    expect(results[0]?.text).toContain('Human Mark');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('the strict query is still tried first and the relaxed query is the fallback', () => {
  // A single term has one form, so the ladder holds one query.
  expect(fullTextQueryLadder('human')).toEqual(['"human"']);
  // Several terms have two forms, the strict one first.
  const ladder = fullTextQueryLadder('human oversight');
  expect(ladder[0]).toBe('"human" AND "oversight"');
  expect(ladder[1]).toBe('"human" OR "oversight"');
});
