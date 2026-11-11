import type { RetrievalMode } from '@office/contracts/knowledge';

/**
 * Query terms the full-text index understands. A term is a run of letters and
 * digits; everything else is a separator. This is the vocabulary the FTS5
 * tokenizer produces, so a term the user typed can still match a chunk that
 * contains it inside a hyphenated or punctuated word.
 */
const TERM_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Builds a full-text query from user input.
 *
 * The index stores terms, not punctuation, so a query is expressed as the
 * terms the user wrote joined by AND: every term must be present. A quoted
 * phrase is kept as a phrase, because "risk assessment" must match only where
 * those words sit together.
 *
 * A term that cannot be expressed safely is dropped rather than passed through:
 * the FTS5 grammar treats `-`, `*`, `:` and quotes as operators, and an
 * unescaped one aborts the whole search with an error instead of returning
 * fewer results. A query made only of such terms yields an empty query, which
 * the caller answers with no results rather than with an error.
 *
 * The strict form is not the only form. A question written as a sentence
 * cannot satisfy it, so {@link buildRelaxedFullTextQuery} and
 * {@link fullTextQueryLadder} carry the relaxed form and the fallback order.
 */
export function buildFullTextQuery(input: string): string {
  return buildQuery(input, ' AND ');
}

/**
 * Builds a relaxed full-text query from user input.
 *
 * The strict query requires every term to be present. A natural sentence
 * never satisfies that: "What is the Human Mark? Answer from the attached
 * knowledge." names words the document does not contain, so the strict query
 * matches nothing and the request would travel without any context.
 *
 * The relaxed query requires any of the terms. The index ranks the results,
 * so the chunk that carries the distinctive words still comes first, and a
 * chunk that carries only a common word ranks low. Recall is recovered
 * without losing the ranking that makes the result useful.
 */
export function buildRelaxedFullTextQuery(input: string): string {
  return buildQuery(input, ' OR ');
}

/**
 * The queries a search tries, in order.
 *
 * The strict query is tried first because it is the most precise answer. The
 * relaxed query is the fallback for a question phrased as a sentence, where
 * the strict query cannot match anything. A query of a single term or a
 * single phrase has one form, so it is tried once.
 */
export function fullTextQueryLadder(input: string): string[] {
  const strict = buildFullTextQuery(input);
  const relaxed = buildRelaxedFullTextQuery(input);
  return strict === relaxed ? [strict] : [strict, relaxed];
}

function buildQuery(input: string, separator: ' AND ' | ' OR '): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const clauses: string[] = [];
  // A quoted run is one phrase. It is copied with its inner quotes so the
  // tokenizer keeps it as a single term sequence.
  const phrasePattern = /"([^"]*)"/g;
  let cursor = 0;
  for (const match of trimmed.matchAll(phrasePattern)) {
    const before = trimmed.slice(cursor, match.index);
    clauses.push(...termClauses(before));
    const phrase = match[1] ?? '';
    const phraseTerms = phrase.match(TERM_PATTERN);
    if (phraseTerms && phraseTerms.length) clauses.push(`"${phraseTerms.join(' ')}"`);
    cursor = (match.index ?? 0) + match[0].length;
  }
  clauses.push(...termClauses(trimmed.slice(cursor)));
  return clauses.join(separator);
}

function termClauses(text: string): string[] {
  const terms = text.match(TERM_PATTERN) ?? [];
  return terms.map((term) => `"${term}"`);
}

/**
 * True when the query carries no searchable term. A query of punctuation only,
 * such as "---", has no term the index can hold, so it matches nothing rather
 * than everything.
 */
export function isEmptyFullTextQuery(query: string): boolean {
  return buildFullTextQuery(query).length === 0;
}

export interface RetrievalQueryPolicy {
  mode: RetrievalMode;
  limit: number;
}

/**
 * Bounds a retrieval request to the modes the index supports. An unknown mode
 * falls back to full text, which needs no embedding and therefore always has an
 * answer available.
 */
export function resolveRetrievalMode(mode: unknown): RetrievalMode {
  return mode === 'vector' || mode === 'hybrid' || mode === 'full-text' ? mode : 'full-text';
}
