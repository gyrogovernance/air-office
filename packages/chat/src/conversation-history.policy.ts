import { activeLeaf, messagePath, type ConversationGraph, type ConversationMessage } from './conversation-graph.entity';

/** One paged window of a conversation branch, oldest message first. */
export interface ConversationHistoryPage {
  messages: ConversationMessage[];
  hasEarlier: boolean;
  hasLater: boolean;
  leafId: string | null;
}

export interface ConversationHistoryQuery {
  limit: number;
  /**
   * Exclusive cursor on the branch path.
   * - omitted with `fromEnd: true` → newest page
   * - `null` → oldest page
   * - id → page after that message
   */
  after?: string | null;
  /** Exclusive: page of messages immediately before this id on the branch path. */
  before?: string | null;
  /** Branch end to page along; defaults to the active leaf. */
  leafId?: string | null;
  /** Newest page of the path. Used when neither `before` nor `after` is set. */
  fromEnd?: boolean;
}

function oldestFirst(left: ConversationMessage, right: ConversationMessage): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Sibling rows that share a parent with a path message stay in the page so
 * branch pickers keep working without loading the rest of the conversation.
 * Lone roots are left alone: every other root shares `parentId: null`, and
 * pulling them would reintroduce whole abandoned trees into a short window.
 */
export function hydratePathSiblings(graph: ConversationGraph, pathSlice: ConversationMessage[]): ConversationMessage[] {
  if (!pathSlice.length) return [];
  const keep = new Set(pathSlice.map((message) => message.id));
  const byParent = new Map<string | null, ConversationMessage[]>();
  for (const message of graph.messages) {
    const group = byParent.get(message.parentId) ?? [];
    group.push(message);
    byParent.set(message.parentId, group);
  }
  for (const message of pathSlice) {
    const siblings = byParent.get(message.parentId) ?? [];
    if (siblings.length < 2) continue;
    for (const sibling of siblings) keep.add(sibling.id);
  }
  return graph.messages.filter((message) => keep.has(message.id)).slice().sort(oldestFirst);
}

/**
 * Pages along one branch path. The complete graph may still be read to build the
 * path; the returned page is the bounded payload the client should retain.
 */
export function pageConversationHistory(graph: ConversationGraph, query: ConversationHistoryQuery): ConversationHistoryPage {
  const bounded = Math.min(Math.max(query.limit, 1), 200);
  const named = query.leafId && graph.messages.some((message) => message.id === query.leafId) ? query.leafId : null;
  const leafId = named ?? activeLeaf(graph);
  if (!leafId) return { messages: [], hasEarlier: false, hasLater: false, leafId: null };

  const path = messagePath(graph, leafId);
  if (!path.length) return { messages: [], hasEarlier: false, hasLater: false, leafId };

  let start = 0;
  let end = path.length;

  if (query.before) {
    const index = path.findIndex((message) => message.id === query.before);
    if (index < 0) return { messages: [], hasEarlier: false, hasLater: path.length > 0, leafId };
    end = index;
    start = Math.max(0, end - bounded);
  } else if (query.after !== undefined) {
    if (query.after === null) {
      start = 0;
      end = Math.min(path.length, bounded);
    } else {
      const index = path.findIndex((message) => message.id === query.after);
      if (index < 0) return { messages: [], hasEarlier: path.length > 0, hasLater: false, leafId };
      start = index + 1;
      end = Math.min(path.length, start + bounded);
    }
  } else {
    // Default and `fromEnd`: newest page (chat opens on the latest turns).
    end = path.length;
    start = Math.max(0, end - bounded);
  }

  const slice = path.slice(start, end);
  return {
    messages: hydratePathSiblings(graph, slice),
    hasEarlier: start > 0,
    hasLater: end < path.length,
    leafId,
  };
}
