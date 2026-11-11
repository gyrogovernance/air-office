/**
 * Conversation graph domain. A conversation is a set of messages linked by
 * parent references rather than a flat array, so an edit-and-branch keeps the
 * original answer reachable and a retry adds a sibling instead of overwriting
 * history. The graph owns no persistence; it is a pure value that the store
 * loads and saves.
 */

import type { ChatTurn } from '@office/contracts/chat';

export type ChatRole = 'system' | 'user' | 'assistant';

/**
 * A piece of structured assistant output. The plain `content` field stays the
 * rendered text so a simple reader never has to walk blocks; `output` keeps the
 * reasoning, tool and media parts that must survive a reload and be replayed to
 * the provider on the next turn.
 */
export type OutputBlockKind = 'text' | 'reasoning' | 'tool' | 'image';

export interface OutputBlock {
  kind: OutputBlockKind;
  /** Text carried by a text or reasoning block. */
  text?: string;
  /** Identity of the tool call a tool block reports on. */
  toolCallId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: 'pending' | 'running' | 'ok' | 'error';
  message?: string;
  /** When a reasoning block began, as an ISO timestamp. */
  startedAt?: string;
  /** When a reasoning block finished, as an ISO timestamp. */
  completedAt?: string;
  /** Reference to a stored source or generated image rather than inline bytes. */
  sourceId?: string;
  mimeType?: string;
}

export interface MessageStatusEntry {
  at: string;
  label: string;
  state: 'running' | 'ok' | 'error';
  detail?: string;
}

export interface MessageUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MessageError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface MessageAttachment {
  id: string;
  kind: 'file' | 'note' | 'collection' | 'url' | 'chat';
  label: string;
  /** Version or scope identifier so a later read can detect a changed source. */
  version?: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  /** Null for a root message. Otherwise the id of the message this one follows. */
  parentId: string | null;
  role: ChatRole;
  content: string;
  /** False while an assistant message is still streaming or was interrupted. */
  complete: boolean;
  /** The chat run that produced an assistant message, for provenance. */
  runId: string | null;
  createdAt: string;
  /** Model that produced an assistant message; null for messages the user wrote. */
  modelId: string | null;
  /**
   * Column index within a multi-model turn. Two selections of the same model
   * keep distinct indices so a comparison never collapses its columns.
   */
  modelIndex: number;
  output: OutputBlock[];
  statusHistory: MessageStatusEntry[];
  usage: MessageUsage | null;
  error: MessageError | null;
  /** Stored file or source references this message produced or cited. */
  files: string[];
  /** What the composer carried into this turn. */
  attachments: MessageAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archivedAt: string | null;
  tags: string[];
  folderId: string | null;
  /** Last time the conversation was read locally; null once it has unread activity. */
  unreadAt: string | null;
}

export interface ConversationGraph {
  conversation: Conversation;
  messages: ConversationMessage[];
}

export function createConversationGraph(id: string, title = 'New conversation', createdAt = new Date().toISOString()): ConversationGraph {
  return { conversation: { id, title, createdAt, updatedAt: createdAt, pinned: false, archivedAt: null, tags: [], folderId: null, unreadAt: null }, messages: [] };
}

/** Returns the ordered path from a root message to the given message id. */
export function messagePath(graph: ConversationGraph, messageId: string): ConversationMessage[] {
  const byId = new Map(graph.messages.map((message) => [message.id, message]));
  const path: ConversationMessage[] = [];
  const visited = new Set<string>();
  let current = byId.get(messageId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Returns the newest leaf of the active branch, following the most recently created child at each step. */
export function activeLeaf(graph: ConversationGraph): string | null {
  const children = new Map<string | null, ConversationMessage[]>();
  for (const message of graph.messages) {
    const siblings = children.get(message.parentId) ?? [];
    siblings.push(message);
    children.set(message.parentId, siblings);
  }
  let cursor: string | null = null;
  const visited = new Set<string>();
  for (;;) {
    const next = (children.get(cursor) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (!next || visited.has(next.id)) return cursor;
    visited.add(next.id);
    cursor = next.id;
  }
}

export interface AppendMessageInput {
  id: string;
  parentId: string | null;
  role: ChatRole;
  content: string;
  complete: boolean;
  runId?: string | null;
  createdAt?: string;
  modelId?: string | null;
  modelIndex?: number;
  output?: OutputBlock[];
  statusHistory?: MessageStatusEntry[];
  usage?: MessageUsage | null;
  error?: MessageError | null;
  files?: string[];
  attachments?: MessageAttachment[];
}

/**
 * Appends a message. Appending the same id twice is a no-op so a replayed event
 * cannot duplicate a message, matching idempotent operation under retry.
 */
export function appendMessage(graph: ConversationGraph, input: AppendMessageInput): ConversationGraph {
  if (graph.messages.some((message) => message.id === input.id)) return graph;
  if (input.parentId !== null && !graph.messages.some((message) => message.id === input.parentId)) throw new Error('The parent message must belong to this conversation.');
  const message: ConversationMessage = {
    id: input.id,
    conversationId: graph.conversation.id,
    parentId: input.parentId,
    role: input.role,
    content: input.content,
    complete: input.complete,
    runId: input.runId ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    modelId: input.modelId ?? null,
    modelIndex: input.modelIndex ?? 0,
    output: input.output ?? [],
    statusHistory: input.statusHistory ?? [],
    usage: input.usage ?? null,
    error: input.error ?? null,
    files: input.files ?? [],
    attachments: input.attachments ?? []
  };
  return {
    conversation: { ...graph.conversation, updatedAt: message.createdAt },
    messages: [...graph.messages, message]
  };
}

/** Updates message content (streaming) without changing identity or parent. */
export function updateMessage(graph: ConversationGraph, id: string, update: Partial<Pick<ConversationMessage, 'content' | 'complete' | 'output' | 'statusHistory' | 'usage' | 'error' | 'files' | 'attachments' | 'runId' | 'modelId' | 'modelIndex'>>): ConversationGraph {
  return { ...graph, messages: graph.messages.map((message) => message.id === id ? { ...message, ...update } : message) };
}

/** Applies sidebar metadata to a conversation: pin, archive, tags, folder, read state. */
export function setConversationMeta(graph: ConversationGraph, meta: Partial<Pick<Conversation, 'pinned' | 'archivedAt' | 'tags' | 'folderId' | 'unreadAt' | 'title'>>): ConversationGraph {
  return { ...graph, conversation: { ...graph.conversation, ...meta } };
}

/**
 * Edits a user message and branches: the edited copy becomes a new sibling that
 * the caller continues from, and the original message and its descendants stay
 * reachable so no history is destroyed.
 */
export function branchFromEdit(graph: ConversationGraph, messageId: string, editedContent: string, newMessageId: string, createdAt = new Date().toISOString()): ConversationGraph {
  const original = graph.messages.find((message) => message.id === messageId);
  if (!original) return graph;
  return appendMessage(graph, { id: newMessageId, parentId: original.parentId, role: 'user', content: editedContent, complete: true, createdAt });
}

/** Sets the conversation title from its first user message when it still has the default title. */
export function deriveTitle(graph: ConversationGraph): ConversationGraph {
  if (graph.conversation.title !== 'New conversation') return graph;
  const firstUser = graph.messages.find((message) => message.role === 'user');
  if (!firstUser) return graph;
  return { ...graph, conversation: { ...graph.conversation, title: firstUser.content.slice(0, 60) } };
}

export function conversationTurns(messages: ConversationMessage[]): ChatTurn[] {
  return messages.flatMap((message): ChatTurn[] => {
    const tools = message.output.filter((block) => block.kind === 'tool' && block.toolCallId && block.name && block.arguments && (block.status === 'ok' || block.status === 'error'));
    if (message.role !== 'assistant' || !tools.length) return [{ role: message.role, content: message.content }];
    const calls = tools.flatMap((block) => block.toolCallId && block.name && block.arguments ? [{ toolCallId: block.toolCallId, name: block.name, arguments: block.arguments }] : []);
    return [
      { role: 'assistant-tool-calls', content: '', calls },
      ...tools.flatMap((block): ChatTurn[] => block.toolCallId ? [{ role: 'tool', toolCallId: block.toolCallId, content: JSON.stringify(block.status === 'error' ? { error: block.message ?? 'Tool failed' } : block.result ?? null) }] : []),
      { role: 'assistant', content: message.content }
    ];
  });
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  pinned: boolean;
  archivedAt: string | null;
  tags: string[];
  folderId: string | null;
  unreadAt: string | null;
}

/** Sidebar metadata a caller may change in one operation. */
export interface ConversationMetaUpdate {
  title?: string;
  pinned?: boolean;
  archivedAt?: string | null;
  tags?: string[];
  folderId?: string | null;
  unreadAt?: string | null;
}

export interface ConversationMessageInput {
  conversationId: string;
  id: string;
  parentId: string | null;
  role: ChatRole;
  content: string;
  complete: boolean;
  runId?: string | null;
  createdAt?: string;
  modelId?: string | null;
  modelIndex?: number;
  output?: OutputBlock[];
  statusHistory?: MessageStatusEntry[];
  usage?: MessageUsage | null;
  error?: MessageError | null;
  files?: string[];
  attachments?: MessageAttachment[];
}

/** A text or title match over stored conversations, newest first. */
export interface ConversationSearchResult extends ConversationSummary {
  /** Ids of messages whose title or content matched, so a hit can be opened at the message. */
  matchedMessageIds: string[];
}


export interface ConversationListFilter {
  archived?: boolean | 'include';
  folderId?: string | null;
  tag?: string;
}
