import { expect, test } from 'bun:test';
import type { ChatEventEnvelope, ChatEventPayloadMap, ChatEventType } from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION } from '@office/contracts/chat';
import { assembleChatRun, initialChatRunState, reduceChatEvent } from '../../../packages/chat/src/chat.domain.public';

let sequence = 0;
function event<T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T], runId = 'run-1'): ChatEventEnvelope<T> {
  return { protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${runId}:${sequence}`, runId, correlationId: runId, sequence: sequence++, timestamp: new Date(0).toISOString(), type, payload };
}

test('assembles streamed text deltas into one durable message', () => {
  sequence = 0;
  const state = assembleChatRun([
    event('text-delta', { messageId: 'm1', text: 'Hel' }),
    event('text-delta', { messageId: 'm1', text: 'lo' }),
    event('message-complete', { messageId: 'm1', text: 'Hello' }),
    event('completion', { reason: 'stop' })
  ]);
  expect(state.messages).toHaveLength(1);
  expect(state.messages[0]?.content).toBe('Hello');
  expect(state.messages[0]?.complete).toBe(true);
  expect(state.status).toBe('complete');
});

test('buffers tool-argument fragments and only promotes a complete validated request', () => {
  sequence = 0;
  const partial = reduceChatEvent(initialChatRunState(), event('tool-arguments-fragment', { toolCallId: 't1', name: 'search', argumentsDelta: '{"q":' }));
  expect(partial.readyToolCalls).toHaveLength(0);
  expect(partial.pendingToolCalls[0]?.argumentsBuffer).toBe('{"q":');
  const more = reduceChatEvent(partial, event('tool-arguments-fragment', { toolCallId: 't1', name: 'search', argumentsDelta: '"air"}' }));
  expect(more.readyToolCalls).toHaveLength(0);
  const ready = reduceChatEvent(more, event('tool-request', { toolCallId: 't1', name: 'search', arguments: { q: 'air' } }));
  expect(ready.pendingToolCalls).toHaveLength(0);
  expect(ready.readyToolCalls).toEqual([{ toolCallId: 't1', name: 'search', arguments: { q: 'air' } }]);
});

test('ignores foreign protocol versions and replayed sequences', () => {
  sequence = 0;
  const first = reduceChatEvent(initialChatRunState(), event('text-delta', { messageId: 'm1', text: 'A' }));
  const foreign = reduceChatEvent(first, { ...event('text-delta', { messageId: 'm1', text: 'X' }), protocolVersion: 2 as typeof CHAT_PROTOCOL_VERSION });
  expect(foreign.messages[0]?.content).toBe('A');
  const replay = reduceChatEvent(first, { ...first.messages, ...event('text-delta', { messageId: 'm1', text: 'Y' }), sequence: 0 } as ChatEventEnvelope);
  expect(replay.messages[0]?.content).toBe('A');
});

test('rejects a tool request that is incomplete or disagrees with buffered fragments', () => {
  let state = initialChatRunState();
  state = reduceChatEvent(state, event('tool-arguments-fragment', { toolCallId: 'call-x', name: 'apply_markdown_note', argumentsDelta: '{"path":"programs/general/notes/x.md","markdown":"a",' }));
  state = reduceChatEvent(state, event('tool-request', { toolCallId: 'call-x', name: 'apply_markdown_note', arguments: { path: 'programs/general/notes/x.md', markdown: 'b' } }));
  expect(state.readyToolCalls).toHaveLength(0);
  expect(state.pendingToolCalls).toHaveLength(1);
});

test('keeps undeclared tool fields as sent; aliases are no longer rewritten', () => {
  let state = initialChatRunState();
  const args = { path: 'programs/general/notes/x.md', old_str: 'a', new_str: 'b' };
  state = reduceChatEvent(state, event('tool-arguments-fragment', { toolCallId: 'call-edit', name: 'edit', argumentsDelta: JSON.stringify(args) }));
  state = reduceChatEvent(state, event('tool-request', { toolCallId: 'call-edit', name: 'edit', arguments: args }));
  expect(state.readyToolCalls).toEqual([{ toolCallId: 'call-edit', name: 'edit', arguments: args }]);
});

test('records a cancelled completion and a failure distinctly', () => {
  sequence = 0;
  const cancelled = assembleChatRun([event('completion', { reason: 'cancelled' })]);
  expect(cancelled.status).toBe('cancelled');
  sequence = 0;
  const failed = assembleChatRun([event('failure', { code: 'provider_error', message: 'boom', retryable: true })]);
  expect(failed.status).toBe('failed');
  expect(failed.failure?.code).toBe('provider_error');
});
