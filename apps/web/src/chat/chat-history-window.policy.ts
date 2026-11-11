import type { Conversation, ConversationGraph, ConversationMessage } from '@office/chat/domain';
import { messagePath } from '@office/chat/domain';

/** First page shown when a conversation opens. */
export const HISTORY_PAGE_SIZE = 50;
/** Hard cap on messages retained in the renderer for one open chat. */
export const HISTORY_CACHE_MAX = 200;

export interface HistoryWindowFlags {
  hasEarlier: boolean;
  hasLater: boolean;
}

/**
 * Merges an older history page in front of the retained window. When the result
 * would exceed the cache cap, newest messages drop off and `hasLater` becomes true.
 */
export function prependHistoryPage(
  current: ConversationGraph,
  earlier: ConversationMessage[],
  flags: HistoryWindowFlags,
): { graph: ConversationGraph; hasEarlier: boolean; hasLater: boolean } {
  const byId = new Map<string, ConversationMessage>();
  for (const message of earlier) byId.set(message.id, message);
  for (const message of current.messages) byId.set(message.id, message);
  let merged = [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  let hasLater = flags.hasLater;
  if (merged.length > HISTORY_CACHE_MAX) {
    merged = merged.slice(0, HISTORY_CACHE_MAX);
    hasLater = true;
  }
  return {
    graph: { conversation: current.conversation, messages: merged },
    hasEarlier: flags.hasEarlier,
    hasLater,
  };
}

/**
 * Replaces the retained window with a fresher page from the service while keeping
 * conversation meta. Used after a turn settles so the client never parks a full
 * transcript in React state.
 */
export function replaceHistoryWindow(
  conversation: Conversation,
  pageMessages: ConversationMessage[],
  flags: HistoryWindowFlags,
): { graph: ConversationGraph; hasEarlier: boolean; hasLater: boolean } {
  let messages = pageMessages;
  let hasLater = flags.hasLater;
  if (messages.length > HISTORY_CACHE_MAX) {
    messages = messages.slice(-HISTORY_CACHE_MAX);
    hasLater = true;
  }
  return {
    graph: { conversation, messages },
    hasEarlier: flags.hasEarlier || pageMessages.length > messages.length,
    hasLater,
  };
}

/** Path-ordered ids currently retained, for deciding the load-earlier cursor. */
export function windowPathHeadId(graph: ConversationGraph | null, leafId: string | null): string | null {
  if (!graph || !leafId) return null;
  const path = messagePath(graph, leafId);
  return path[0]?.id ?? null;
}
