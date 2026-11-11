import type { SessionEvent } from '@github/copilot-sdk';
import type { ChatEventEnvelope, ChatEventPayloadMap, ChatEventType } from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION } from '@office/contracts/chat';
import { classifyProviderFailure } from './provider-failure.adapter';

export function createChatEnvelopeFactory(runId: string, startSequence = 0) {
  let sequence = startSequence;
  return <T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T], timestamp = new Date().toISOString()): ChatEventEnvelope<T> => ({
    protocolVersion: CHAT_PROTOCOL_VERSION,
    eventId: `${runId}:${sequence}`,
    runId,
    correlationId: runId,
    sequence: sequence++,
    timestamp,
    type,
    payload
  });
}

export type ChatEnvelopeFactory = ReturnType<typeof createChatEnvelopeFactory>;

/**
 * Maps Copilot SDK session events that have a direct AIR chat-protocol meaning.
 * Tool request/result envelopes are emitted by the session adapter's permission
 * and custom-tool handlers so AIR keeps a single authorization boundary.
 * Unsupported transitions return null (ambient lifecycle noise is ignored).
 */
export function mapCopilotSessionEvent(event: SessionEvent, envelope: ChatEnvelopeFactory): ChatEventEnvelope | ChatEventEnvelope[] | null {
  if ('agentId' in event && event.agentId && (event.type === 'assistant.message_delta' || event.type === 'assistant.reasoning_delta' || event.type === 'assistant.message' || event.type === 'assistant.usage' || event.type === 'assistant.tool_call_delta')) return null;
  switch (event.type) {
    case 'assistant.message_delta': {
      const text = event.data.deltaContent ?? '';
      if (!text) return null;
      return envelope('text-delta', { messageId: event.data.messageId ?? event.id, text }, event.timestamp);
    }
    case 'assistant.reasoning_delta': {
      const text = event.data.deltaContent ?? '';
      if (!text) return null;
      return envelope('reasoning-delta', { text }, event.timestamp);
    }
    case 'assistant.message': {
      if (!event.data.content && !event.data.citations?.sources?.length) return null;
      const messageId = event.data.messageId ?? event.id;
      const citations = event.data.citations;
      const attachments = (citations?.sources ?? []).map((source) => {
        const label = typeof source.title === 'string' && source.title.trim()
          ? source.title.trim()
          : typeof source.url === 'string' && source.url.trim()
            ? source.url.trim()
            : source.id;
        return envelope('source-attachment', {
          messageId,
          sourceId: source.id,
          label,
          resolved: Boolean(source.url)
        }, event.timestamp);
      });
      const complete = event.data.content
        ? [envelope('message-complete', { messageId, text: event.data.content }, event.timestamp)]
        : [];
      const mapped = [...attachments, ...complete];
      return mapped.length === 1 ? mapped[0]! : mapped.length ? mapped : null;
    }
    case 'assistant.tool_call_delta': {
      return envelope('tool-arguments-fragment', {
        toolCallId: event.data.toolCallId,
        name: event.data.toolName ?? '',
        argumentsDelta: event.data.inputDelta ?? ''
      }, event.timestamp);
    }
    case 'assistant.usage': {
      const inputTokens = event.data.inputTokens;
      const outputTokens = event.data.outputTokens;
      if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return null;
      return envelope('usage', { inputTokens, outputTokens }, event.timestamp);
    }
    case 'session.error': {
      const errorType = event.data.errorType ?? '';
      const raw = event.data as { message?: unknown; errorMessage?: unknown; error?: unknown };
      const detail = typeof raw.message === 'string' ? raw.message
        : typeof raw.errorMessage === 'string' ? raw.errorMessage
          : typeof raw.error === 'string' ? raw.error
            : '';
      const classified = classifyProviderFailure(new Error(detail || errorType || 'session.error'), true);
      const code = errorType === 'authentication' || errorType === 'authorization' ? 'auth'
        : errorType === 'quota' ? 'quota'
          : errorType === 'rate_limit' ? 'rate-limit'
            : errorType === 'context_limit' ? 'context-limit'
              : classified.code;
      const messages = {
        auth: 'The provider rejected the credentials or account access. Check the connection settings.',
        quota: 'The provider reported an account or quota limit.',
        'rate-limit': 'The provider rate limit was reached. Retry later.',
        'context-limit': 'This request exceeds the model context limit. Reduce the conversation or output limit.',
      } as const;
      const message = code in messages ? messages[code as keyof typeof messages] : classified.message;
      // Keep errorType visible for operators; strip credential-shaped fragments from SDK detail.
      const safeDetail = detail.replace(/(api[_-]?key|bearer|token|authorization)[=:\s]+\S+/gi, '$1=[redacted]').trim();
      const operatorMessage = safeDetail && code !== 'auth' && code !== 'quota' && code !== 'rate-limit' && code !== 'context-limit'
        ? `${message} (${errorType || 'error'}: ${safeDetail.slice(0, 240)})`
        : message;
      return envelope('failure', { code, message: operatorMessage, retryable: code === 'rate-limit' || classified.retryable }, event.timestamp);
    }
    default:
      return null;
  }
}
