/**
 * Context attached to the next chat message.
 *
 * A person attaches knowledge to a chat by picking collections and documents
 * from the composer. What they picked is a selection, not an index: the
 * selection says which collections and documents may be searched, and the
 * service decides what is actually retrieved from them.
 *
 * The policy owns the selection shape and the rules around it, so the same
 * rules hold whether the selection was made in the picker, restored from
 * storage, or arrived from elsewhere.
 */

import type { RetrievalResult } from '@office/contracts/knowledge';

/** A collection the person attached to this chat. */
export interface AttachedCollection {
  kind: 'collection';
  id: string;
  name: string;
}

/** A single document the person attached to this chat. */
export interface AttachedDocument {
  kind: 'document';
  id: string;
  name: string;
  /** The collection the document belongs to, so a search can be scoped to it. */
  collectionId: string | null;
}

/** One thing attached to the chat. */
export type AttachedContext = AttachedCollection | AttachedDocument;

/** The selection the composer holds for the current chat. */
export interface ComposerContextSelection {
  collections: AttachedCollection[];
  documents: AttachedDocument[];
}

/** An empty selection. */
export const EMPTY_CONTEXT_SELECTION: ComposerContextSelection = { collections: [], documents: [] };

/** The kind of a context item, used to keep the two lists apart. */
export function contextKind(item: AttachedContext): 'collection' | 'document' {
  return item.kind;
}

/**
 * Adds an item to the selection. An item that is already attached is not
 * added twice, so clicking a collection twice does not produce two chips.
 */
export function attachContext(selection: ComposerContextSelection, item: AttachedContext): ComposerContextSelection {
  if (item.kind === 'collection') {
    if (selection.collections.some((entry) => entry.id === item.id)) return selection;
    return { ...selection, collections: [...selection.collections, item] };
  }
  if (selection.documents.some((entry) => entry.id === item.id)) return selection;
  return { ...selection, documents: [...selection.documents, item] };
}

/**
 * Removes an item from the selection. A collection that is removed also
 * takes its documents with it, because a document of a collection that is no
 * longer attached would otherwise remain searchable.
 */
export function detachContext(selection: ComposerContextSelection, item: AttachedContext): ComposerContextSelection {
  if (item.kind === 'collection') {
    return {
      collections: selection.collections.filter((entry) => entry.id !== item.id),
      documents: selection.documents.filter((entry) => entry.collectionId !== item.id)
    };
  }
  return { ...selection, documents: selection.documents.filter((entry) => entry.id !== item.id) };
}

/** Whether an item is already attached. */
export function isContextAttached(selection: ComposerContextSelection, item: AttachedContext): boolean {
  return item.kind === 'collection'
    ? selection.collections.some((entry) => entry.id === item.id)
    : selection.documents.some((entry) => entry.id === item.id);
}

/**
 * The collection ids a search may read. A collection that is attached is
 * included; so is the collection a document belongs to, because the document
 * is searched inside its own collection.
 */
export function contextCollectionIds(selection: ComposerContextSelection): string[] {
  const ids = new Set(selection.collections.map((entry) => entry.id));
  for (const document of selection.documents) if (document.collectionId) ids.add(document.collectionId);
  return [...ids];
}

/**
 * The documents a search may read, by their version ids. A document that is
 * attached is searched inside its own collection, and only its own versions
 * are returned.
 */
export function contextDocumentIds(selection: ComposerContextSelection, documentVersionIds: ReadonlyMap<string, readonly string[]>): string[] {
  const ids = new Set<string>();
  for (const document of selection.documents) {
    for (const versionId of documentVersionIds.get(document.id) ?? []) ids.add(versionId);
  }
  return [...ids];
}

/**
 * The label a chip carries. A collection and a document are told apart by the
 * word that follows the name, so the chip says what kind of thing it is.
 */
export function contextChipLabel(item: AttachedContext): string {
  return item.kind === 'collection' ? `${item.name} · Collection` : `${item.name} · Document`;
}

/**
 * The items of a selection in a stable order: collections first, then
 * documents, each by name. A chip list that reorders itself between renders
 * reads as a mistake.
 */
export function orderedContextItems(selection: ComposerContextSelection): AttachedContext[] {
  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name);
  const collections: AttachedContext[] = [...selection.collections].sort(byName);
  const documents: AttachedContext[] = [...selection.documents].sort(byName);
  return [...collections, ...documents];
}

/**
 * Filters collections and documents by a search term. The term matches the
 * name of the collection or the name of the document, so a person can look
 * for either.
 */export function filterContextItems(  collections: { id: string; name: string }[],
  documents: { id: string; name: string; kind: string; collectionId: string | null }[],
  term: string
): { collections: { id: string; name: string }[]; documents: { id: string; name: string; kind: string; collectionId: string | null }[] } {
  const needle = term.trim().toLowerCase();
  if (!needle) return { collections, documents };
  const matches = (name: string) => name.toLowerCase().includes(needle);
  return {
    collections: collections.filter((collection) => matches(collection.name)),
    documents: documents.filter((document) => matches(document.name))
  };
}

/**
 * What a search of the attached context produced.
 *
 * The person attached a collection and expected the model to read it. A
 * search that found nothing is not a failure of the attachment, and it is
 * also not the same as an attachment that was never searched. This outcome
 * keeps the two apart, so the interface can say what actually happened
 * instead of sending a message that quietly carries no context.
 */
export type ContextRetrievalOutcome =
  /** Nothing is attached, so there was nothing to search. */
  | { kind: 'not-attached' }
  /** The attached context was searched and the search answered. */
  | { kind: 'retrieved'; results: RetrievalResult[] }
  /** The attached context was searched and nothing matched the question. */
  | { kind: 'no-match'; results: [] }
  /** The attached context could not be searched at all. */
  | { kind: 'failed'; reason: string };

/**
 * The outcome of searching the attached context.
 *
 * A selection that is empty has nothing to search. A search that answered
 * with results carries them. A search that answered with nothing is a
 * different situation from a search that never happened, and the two are
 * kept apart so the message that follows is honest about it.
 */
export function contextRetrievalOutcome(input: { attached: boolean; results: RetrievalResult[] }): ContextRetrievalOutcome {
  if (!input.attached) return { kind: 'not-attached' };
  return input.results.length ? { kind: 'retrieved', results: input.results } : { kind: 'no-match', results: [] };
}

/**
 * The message the composer shows for an outcome.
 *
 * An empty answer is worth saying out loud, because the person asked a
 * question expecting the document to answer it. Silence would read as the
 * model ignoring the document.
 */
export function contextRetrievalNotice(outcome: ContextRetrievalOutcome): string {
  if (outcome.kind === 'not-attached') return '';
  if (outcome.kind === 'retrieved') return `Included ${outcome.results.length} knowledge snippet${outcome.results.length === 1 ? '' : 's'} from the attached context.`;
  if (outcome.kind === 'no-match') return 'The attached knowledge returned no match for this message. The model will answer without it.';
  return `The attached knowledge could not be searched: ${outcome.reason}`;
}
