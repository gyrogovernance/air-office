import type { ChatRole, Conversation, ConversationGraph, ConversationMessage, MessageAttachment, MessageError, MessageStatusEntry, MessageUsage, OutputBlock, ConversationSummary, ConversationMetaUpdate, ConversationMessageInput, ConversationSearchResult, ConversationListFilter } from './conversation-graph.entity';
import type { ConversationHistoryPage, ConversationHistoryQuery } from './conversation-history.policy';

/**
 * Persistence boundary for the conversation graph. The vault adapter owns
 * `meta.yaml` and `messages.jsonl`; the domain rules for branches, paths and
 * titles live in the entity file. History reads are paged so a very long
 * conversation never loads whole.
 */
export interface ConversationStore {
  /** Creates a conversation if it does not exist; returns the graph. */
  ensure(conversationId: string): ConversationGraph;
  /** Creates a conversation from restored export data with its original timestamps; an existing conversation is preserved untouched. */
  restore(conversation: Conversation): ConversationGraph;
  /** Loads the complete graph, including sibling branches. The history operation provides paged reads. */
  load(conversationId: string): ConversationGraph | null;
  /** Conversation meta without messages, for clients that page history separately. */
  loadMeta(conversationId: string): Conversation | null;
  /** Paged history: messages ordered oldest first after an exclusive cursor. */
  history(conversationId: string, afterMessageId: string | null, limit: number): ConversationMessage[];
  /** Branch-path page with earlier/later flags and sibling hydration for branch pickers. */
  historyPage(conversationId: string, query: ConversationHistoryQuery): ConversationHistoryPage | null;
  summaries(limit: number, offset?: number, filter?: ConversationListFilter): ConversationSummary[];
  appendMessage(input: ConversationMessageInput): ConversationGraph;
  appendTurn(input: { conversationId: string; userId: string; assistantId: string; parentId: string | null; content: string; attachments: MessageAttachment[] }): ConversationGraph;
  updateMessage(conversationId: string, id: string, update: Partial<Pick<ConversationMessage, 'content' | 'complete' | 'output' | 'statusHistory' | 'usage' | 'error' | 'files' | 'attachments' | 'runId' | 'modelId' | 'modelIndex'>>): ConversationGraph;
  /** Removes the listed messages; unknown ids are ignored and the remaining parent references must stay valid. */
  deleteMessages(conversationId: string, messageIds: string[]): ConversationGraph;
  rename(conversationId: string, title: string): ConversationGraph;
  /** Applies pin, archive, tag, folder or read state to one conversation. */
  setMeta(conversationId: string, update: ConversationMetaUpdate): ConversationGraph;
  /** Searches titles and message content, excluding archived conversations unless asked. */
  search(query: string, options?: { includeArchived?: boolean; limit?: number }): ConversationSearchResult[];
  delete(conversationId: string): void;
  clearWorkspace(): number;
  close(): void;
}
