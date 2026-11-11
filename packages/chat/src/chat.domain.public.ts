import type {
  ChatEventEnvelope,
  CompletionPayload,
  FailurePayload,
  ProviderCapability
} from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION } from '@office/contracts/chat';

export * from './conversation-graph.entity';
export { hydratePathSiblings, pageConversationHistory } from './conversation-history.policy';
export type { ConversationHistoryPage, ConversationHistoryQuery } from './conversation-history.policy';
export { fetchedWebPages } from './web-source.policy';

export type ChatMessageRole = 'user' | 'assistant';

export interface ChatRunMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  complete: boolean;
}

export interface PendingToolCall {
  toolCallId: string;
  name: string;
  argumentsBuffer: string;
}

export interface ValidatedToolCall {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatRunStatus = 'idle' | 'streaming' | 'complete' | 'cancelled' | 'failed';

export interface ChatRunState {
  runId: string | null;
  status: ChatRunStatus;
  messages: ChatRunMessage[];
  pendingToolCalls: PendingToolCall[];
  readyToolCalls: ValidatedToolCall[];
  usage: { inputTokens: number; outputTokens: number } | null;
  failure: FailurePayload | null;
  completion: CompletionPayload | null;
  lastSequence: number;
}

export function initialChatRunState(): ChatRunState {
  return {
    runId: null,
    status: 'idle',
    messages: [],
    pendingToolCalls: [],
    readyToolCalls: [],
    usage: null,
    failure: null,
    completion: null,
    lastSequence: -1
  };
}

function upsertMessage(messages: ChatRunMessage[], id: string, update: (message: ChatRunMessage) => ChatRunMessage): ChatRunMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index === -1) return [...messages, update({ id, role: 'assistant', content: '', complete: false })];
  const next = [...messages];
  next[index] = update(next[index]!);
  return next;
}

/**
 * Pure reducer that assembles a durable ChatRun from the canonical event protocol.
 * It buffers tool-argument fragments and only promotes a tool call once a complete,
 * JSON-parseable `tool-request` arrives — a partial function call never becomes a
 * ready tool call. The reducer rejects foreign protocol versions, out-of-order
 * sequences and events for a different run so a replayed stream cannot duplicate text.
 */
export function reduceChatEvent(state: ChatRunState, event: ChatEventEnvelope): ChatRunState {
  if (event.protocolVersion !== CHAT_PROTOCOL_VERSION) return state;
  if (state.runId !== null && event.runId !== state.runId) return state;
  if (event.runId === state.runId && event.sequence <= state.lastSequence) return state;

  const base: ChatRunState = state.runId === null
    ? { ...state, runId: event.runId, status: 'streaming' }
    : state;
  const next: ChatRunState = { ...base, lastSequence: event.sequence };

  switch (event.type) {
    case 'text-delta': {
      const { messageId, text } = event.payload;
      return { ...next, messages: upsertMessage(next.messages, messageId, (message) => ({ ...message, content: message.content + text })) };
    }
    case 'message-complete': {
      const { messageId, text } = event.payload;
      return { ...next, messages: upsertMessage(next.messages, messageId, (message) => ({ ...message, content: text || message.content, complete: true })) };
    }
    case 'tool-arguments-fragment': {
      const { toolCallId, name, argumentsDelta } = event.payload;
      const index = next.pendingToolCalls.findIndex((call) => call.toolCallId === toolCallId);
      const pending = [...next.pendingToolCalls];
      if (index === -1) pending.push({ toolCallId, name, argumentsBuffer: argumentsDelta });
      else pending[index] = { ...pending[index]!, argumentsBuffer: pending[index]!.argumentsBuffer + argumentsDelta };
      return { ...next, pendingToolCalls: pending };
    }
    case 'tool-request': {
      const { toolCallId, name, arguments: args } = event.payload;
      const pending = next.pendingToolCalls.find((call) => call.toolCallId === toolCallId);
      if (!pending || pending.name !== name) return next;
      let parsed: unknown;
      try { parsed = JSON.parse(pending.argumentsBuffer); } catch { return next; }
      if (JSON.stringify(parsed) !== JSON.stringify(args)) return next;
      return {
        ...next,
        pendingToolCalls: next.pendingToolCalls.filter((call) => call.toolCallId !== toolCallId),
        readyToolCalls: [...next.readyToolCalls, { toolCallId, name, arguments: args }]
      };
    }
    case 'usage':
      return { ...next, usage: { inputTokens: event.payload.inputTokens, outputTokens: event.payload.outputTokens } };
    case 'completion':
      return { ...next, status: event.payload.reason === 'cancelled' ? 'cancelled' : event.payload.reason === 'tool' ? 'streaming' : 'complete', completion: event.payload };
    case 'failure':
      return { ...next, status: 'failed', failure: event.payload };
    case 'tool-result':
    case 'source-attachment':
      return next;
    default:
      return next;
  }
}

export function assembleChatRun(events: Iterable<ChatEventEnvelope>, from: ChatRunState = initialChatRunState()): ChatRunState {
  let state = from;
  for (const event of events) state = reduceChatEvent(state, event);
  return state;
}

export function describeCapability(capability: ProviderCapability): string {
  const flags = [capability.streaming ? 'streaming' : null, capability.tools ? 'tools' : null, capability.images ? 'images' : null, capability.imageGeneration ? 'image generation' : null].filter(Boolean);
  return flags.length ? flags.join(', ') : 'text only';
}
