import type { Conversation, ConversationGraph, ConversationMessage, ConversationMessageInput, ConversationSearchResult, ConversationSummary, MessageAttachment } from '@office/chat/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { HISTORY_PAGE_SIZE } from './chat-history-window.policy';

/**
 * Conversation persistence for the renderer. Every call goes to the service,
 * which owns the SQLite conversation graph; the renderer keeps no authoritative
 * copy. The migration helper moves conversations that older builds stored in
 * browser `localStorage` so opening the app after an upgrade keeps that history
 * instead of dropping it behind a storage cap.
 */

export interface ConversationUpdate {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  folderId?: string | null;
  unreadAt?: string | null;
}

export interface ListConversationsOptions {
  folderId?: string | null;
  archived?: boolean | 'include';
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationFolderRecord { id: string; name: string; parentId: string | null; instruction: string; createdAt: string; updatedAt: string }

export interface ConversationHistoryPageResult {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  hasEarlier: boolean;
  hasLater: boolean;
  leafId: string | null;
}

export interface ConversationHistoryPageOptions {
  limit?: number;
  before?: string;
  after?: string | null;
  leafId?: string | null;
  fromEnd?: boolean;
}

export interface ConversationClient {
  createFolder(input: { id: string; name: string; parentId?: string | null; instruction?: string }): Promise<ConversationFolderRecord>;
  updateFolder(id: string, patch: Partial<Pick<ConversationFolderRecord, 'name' | 'parentId' | 'instruction'>>): Promise<ConversationFolderRecord>;
  deleteFolder(id: string, policy: 'keep-chats' | 'delete-chats'): Promise<void>;
  folders(): Promise<ConversationFolderRecord[]>;
  list(options?: ListConversationsOptions): Promise<ConversationSummary[]>;
  load(conversationId: string): Promise<ConversationGraph | null>;
  /** Bounded branch-path page for the open chat window. */
  historyPage(conversationId: string, options?: ConversationHistoryPageOptions): Promise<ConversationHistoryPageResult | null>;
  create(conversationId: string): Promise<ConversationGraph>;
  update(conversationId: string, update: ConversationUpdate): Promise<ConversationGraph>;
  remove(conversationId: string): Promise<void>;
  appendMessage(input: ConversationMessageInput): Promise<ConversationGraph>;
  appendTurn(input: { conversationId: string; userId: string; assistantId: string; parentId: string | null; content: string; attachments: MessageAttachment[] }): Promise<ConversationGraph>;
  updateMessage(conversationId: string, messageId: string, patch: Record<string, unknown>): Promise<ConversationGraph>;
  /** Removes a planned set of messages; the service refuses any set that would strand a reply. */
  deleteMessages(conversationId: string, messageIds: string[]): Promise<void>;
  search(query: string, options?: { includeArchived?: boolean }): Promise<ConversationSearchResult[]>;
}

export function createConversationClient(client: ServiceClient): ConversationClient {
  return {
    async folders() { return (await client.json<{ folders: ConversationFolderRecord[] }>('/api/v1/folders')).folders; },
    async createFolder(input: { id: string; name: string; parentId?: string | null; instruction?: string }) { return (await client.json<{ folder: ConversationFolderRecord }>('/api/v1/folders', { method: 'POST', body: JSON.stringify(input) })).folder; },
    async updateFolder(id, patch) { return (await client.json<{ folder: ConversationFolderRecord }>(`/api/v1/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })).folder; },
    async deleteFolder(id, policy) {
      const response = await client.request(`/api/v1/folders/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ policy }) });
      if (!response.ok) throw new Error('Could not delete this folder.');
    },
    async list(options = {}) {
      const params = new URLSearchParams();
      if (options.folderId !== undefined) params.set('folderId', options.folderId ?? '');
      if (options.archived !== undefined) params.set('archived', options.archived === 'include' ? 'include' : options.archived ? 'true' : 'false');
      if (options.tag) params.set('tag', options.tag);
      params.set('limit', String(options.limit ?? 200));
      let offset = options.offset ?? 0;
      const results: ConversationSummary[] = [];
      for (;;) {
        params.set('offset', String(offset));
        const query = params.toString();
        const body = await client.json<{ conversations: ConversationSummary[] }>(`/api/v1/conversations${query ? `?${query}` : ''}`);
        results.push(...body.conversations);
        if (options.limit !== undefined || body.conversations.length < 200) return results;
        offset += body.conversations.length;
      }
    },
    async load(conversationId) {
      const response = await client.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not load this conversation.');
      const body: { conversation: ConversationGraph } = await response.json();
      return body.conversation;
    },
    async historyPage(conversationId, options = {}) {
      const params = new URLSearchParams();
      params.set('limit', String(options.limit ?? HISTORY_PAGE_SIZE));
      if (options.before) params.set('before', options.before);
      else if (options.after !== undefined) {
        if (options.after !== null) params.set('after', options.after);
      } else if (options.fromEnd !== false) {
        params.set('from', 'end');
      }
      if (options.leafId) params.set('leafId', options.leafId);
      const response = await client.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/history?${params.toString()}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not load conversation history.');
      const body = await response.json() as ConversationHistoryPageResult;
      return {
        conversation: body.conversation ?? null,
        messages: Array.isArray(body.messages) ? body.messages : [],
        hasEarlier: body.hasEarlier === true,
        hasLater: body.hasLater === true,
        leafId: body.leafId ?? null,
      };
    },

    async create(conversationId) {
      const body = await client.json<{ conversation: ConversationGraph }>('/api/v1/conversations', { method: 'POST', body: JSON.stringify({ conversationId }) });
      return body.conversation;
    },
    async update(conversationId, update) {
      const body = await client.json<{ conversation: ConversationGraph }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', body: JSON.stringify(update) });
      return body.conversation;
    },
    async remove(conversationId) {
      const response = await client.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Could not delete this conversation.');
    },
    async appendMessage(input) {
      const { conversationId, ...message } = input;
      const body = await client.json<{ conversation: ConversationGraph }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'POST', body: JSON.stringify(message) });
      return body.conversation;
    },
    async appendTurn(input) {
      const { conversationId, ...turn } = input;
      const response = await client.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`, { method: 'POST', body: JSON.stringify(turn) });
      if (!response.ok) {
        if (response.status === 404 && !response.headers.get('content-type')?.includes('application/json')) throw new Error('Restart AIR Office to finish updating chat. Your message is kept.');
        throw new Error('The message could not be saved. Your message is kept.');
      }
      return (await response.json() as { conversation: ConversationGraph }).conversation;
    },
    async updateMessage(conversationId, messageId, patch) {
      const body = await client.json<{ conversation: ConversationGraph }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return body.conversation;
    },
    async deleteMessages(conversationId, messageIds) {
      const response = await client.request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { method: 'DELETE', body: JSON.stringify({ messageIds }) });
      if (!response.ok) throw new Error('These messages could not be deleted.');
    },
    async search(query, options?: { includeArchived?: boolean }) {
      const params = new URLSearchParams({ q: query });
      if (options?.includeArchived) params.set('includeArchived', 'true');
      const body = await client.json<{ results: ConversationSearchResult[] }>(`/api/v1/conversations/search?${params.toString()}`);
      return body.results;
    }
  };
}
