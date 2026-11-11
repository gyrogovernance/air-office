import { describe, expect, test } from 'bun:test';
import { appendMessage, createConversationGraph, type ConversationMessage } from '@office/chat/domain';
import { keepReasoningTiming, projectConversationThread, toThreadMessage } from '../../../../apps/web/src/chat/thread-message.adapter';

function user(id: string, parentId: string | null, content: string): ConversationMessage {
  return {
    id, conversationId: 'c1', parentId, role: 'user', content, complete: true, runId: null,
    createdAt: '2026-10-14T12:00:00.000Z', modelId: null, modelIndex: 0, output: [],
    statusHistory: [], usage: null, error: null, files: [], attachments: []
  };
}

function assistant(id: string, parentId: string | null, content: string, extra?: Partial<ConversationMessage>): ConversationMessage {
  return {
    id, conversationId: 'c1', parentId, role: 'assistant', content, complete: true, runId: 'run-1',
    createdAt: '2026-10-14T12:01:00.000Z', modelId: 'local-replay', modelIndex: 0,
    output: [{ kind: 'text', text: content }], statusHistory: [],
    usage: null, error: null, files: [], attachments: [], ...extra
  };
}

describe('graph to runtime messages', () => {
  test('a sibling branch stays out of the projected path', () => {
    let graph = createConversationGraph('c1');
    const base = (id: string, parentId: string | null, role: 'user' | 'assistant', content: string, createdAt: string) =>
      ({ id, parentId, role, content, complete: true, createdAt } as Parameters<typeof appendMessage>[1]);
    graph = appendMessage(graph, base('u1', null, 'user', 'original question', '2026-10-14T12:00:00.000Z'));
    graph = appendMessage(graph, base('a1', 'u1', 'assistant', 'first answer', '2026-10-14T12:01:00.000Z'));
    graph = appendMessage(graph, base('u2', 'u1', 'user', 'edited question', '2026-10-14T12:02:00.000Z'));
    graph = appendMessage(graph, base('a2', 'u2', 'assistant', 'second answer', '2026-10-14T12:03:00.000Z'));

    const edited = projectConversationThread(graph, 'a2');
    expect(edited.messages.map((message) => message.id)).toEqual(['u1', 'u2', 'a2']);
    expect(edited.leafId).toBe('a2');

    const original = projectConversationThread(graph, 'a1');
    expect(original.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(original.leafId).toBe('a1');
  });

  test('usage travels as step metadata on the message', () => {
    const message = assistant('a1', 'u1', 'done', { usage: { inputTokens: 120, outputTokens: 40 } });
    const projected = toThreadMessage(message);
    expect(projected.metadata?.steps).toEqual([{ messageId: 'a1', usage: { inputTokens: 120, outputTokens: 40 } }]);
  });

  test('a failed message projects as incomplete with its error', () => {
    const message = assistant('a1', 'u1', 'partial', {
      complete: false, runId: null,
      error: { code: 'provider-down', message: 'The provider is unavailable.', retryable: true }
    });
    const projected = toThreadMessage(message);
    expect(projected.status?.type).toBe('incomplete');
  });

  test('a cancelled run projects as incomplete rather than complete', () => {
    const message = assistant('a1', 'u1', 'partial', {
      complete: false,
      statusHistory: [{ at: '2026-10-14T12:02:00.000Z', label: 'cancelled', state: 'ok' }]
    });
    const projected = toThreadMessage(message);
    expect(projected.status).toEqual({ type: 'incomplete', reason: 'cancelled' });
  });

  test('a running entry after cancel projects as streaming again', () => {
    const message = assistant('a1', 'u1', 'partial', {
      complete: false,
      runId: 'run-continued',
      statusHistory: [
        { at: '2026-10-14T12:02:00.000Z', label: 'cancelled', state: 'ok' },
        { at: '2026-10-14T12:03:00.000Z', label: 'running', state: 'running' }
      ]
    });
    expect(toThreadMessage(message).status).toEqual({ type: 'running' });
  });

  test('a streaming message projects as running', () => {
    const message = assistant('a1', 'u1', 'so far', { complete: false });
    expect(toThreadMessage(message).status).toEqual({ type: 'running' });
  });

  test('attachments travel with their identity and version', () => {
    const message = {
      ...user('u1', null, 'see attached'),
      attachments: [{ id: 'att-1', kind: 'file', label: 'notes.txt', version: 'v3' }]
    } as ConversationMessage;
    const projected = toThreadMessage(message);
    expect(projected.attachments).toHaveLength(1);
    expect(projected.attachments![0]).toMatchObject({ id: 'att-1', name: 'notes.txt' });
  });

  test('assistant-side attachments stay in metadata instead of breaking the runtime', () => {
    const message = assistant('a1', 'u1', 'see attached', {
      attachments: [{ id: 'att-1', kind: 'file', label: 'notes.txt', version: 'v3' }]
    });
    const projected = toThreadMessage(message);
    expect(projected.attachments).toBeUndefined();
    expect((projected.metadata?.custom as { attachments: unknown[] }).attachments).toHaveLength(1);
  });

  test('reasoning and tool blocks become their own parts', () => {
    const message = assistant('a1', 'u1', 'answer', {
      output: [
        { kind: 'text', text: 'answer' },
        { kind: 'reasoning', text: 'thinking it through' },
        { kind: 'tool', toolCallId: 'call-1', name: 'search', arguments: { q: 'x' }, status: 'ok', result: ['hit'] }
      ]
    });
    const parts = toThreadMessage(message).content;
    expect(Array.isArray(parts)).toBe(true);
    const kinds = (parts as unknown[]).map((part) => (part as { type: string }).type);
    expect(kinds).toEqual(['reasoning', 'tool-call', 'text']);
  });

  test('reasoning timing reaches the runtime as epoch milliseconds', () => {
    const message = assistant('a1', 'u1', 'answer', {
      output: [{
        kind: 'reasoning',
        text: 'thinking',
        status: 'ok',
        startedAt: '2026-10-14T12:01:00.000Z',
        completedAt: '2026-10-14T12:01:04.000Z'
      }, { kind: 'text', text: 'answer' }]
    });
    const part = (toThreadMessage(message).content as { type: string; timing?: { startedAt: number; completedAt?: number } }[])
      .find((item) => item.type === 'reasoning');
    expect(part?.timing).toEqual({
      startedAt: Date.parse('2026-10-14T12:01:00.000Z'),
      completedAt: Date.parse('2026-10-14T12:01:04.000Z')
    });
  });

  test('a reload keeps client-measured reasoning times the service omitted', () => {
    const previous = {
      conversation: createConversationGraph('c1').conversation,
      messages: [assistant('a1', 'u1', 'answer', {
        output: [{
          kind: 'reasoning',
          text: 'thinking',
          status: 'ok',
          startedAt: '2026-10-14T12:01:00.000Z',
          completedAt: '2026-10-14T12:01:04.000Z'
        }]
      })]
    };
    const next = {
      conversation: previous.conversation,
      messages: [assistant('a1', 'u1', 'answer', {
        output: [{ kind: 'reasoning', text: 'thinking', status: 'ok' }, { kind: 'text', text: 'answer' }]
      })]
    };
    const merged = keepReasoningTiming(previous, next);
    expect(merged.messages[0]?.output.find((block) => block.kind === 'reasoning')).toMatchObject({
      startedAt: '2026-10-14T12:01:00.000Z',
      completedAt: '2026-10-14T12:01:04.000Z'
    });
  });

  test('a running tool call stays preliminary until its result lands', () => {
    const message = assistant('a1', 'u1', '', {
      complete: false,
      output: [{ kind: 'tool', toolCallId: 'call-1', name: 'search', arguments: {}, status: 'running' }]
    });
    const part = (toThreadMessage(message).content as unknown[])[0] as { isPreliminary?: boolean };
    expect(part.isPreliminary).toBe(true);
  });

  test('a settled tool without a payload still leaves the working state', () => {
    const message = assistant('a1', 'u1', 'done', {
      output: [{ kind: 'tool', toolCallId: 'call-1', name: 'glob', arguments: { pattern: '**/*.md' }, status: 'ok' }]
    });
    const part = (toThreadMessage(message).content as unknown[])[0] as {
      type: string;
      result?: unknown;
      isPreliminary?: boolean;
      isError?: boolean;
    };
    expect(part).toMatchObject({ type: 'tool-call', result: null, isPreliminary: false });
    expect(part.isError).toBeUndefined();
  });

  test('an unknown block kind survives as a data part instead of being dropped', () => {
    const message = assistant('a1', 'u1', 'answer', {
      output: [{ kind: 'chart', text: 'chart payload' } as never]
    });
    const parts = toThreadMessage(message).content as unknown[];
    expect(parts).toHaveLength(1);
    expect((parts[0] as { type: string }).type).toBe('data');
    expect((parts[0] as { name: string }).name).toBe('air-unknown-block');
  });

  test('a message without output blocks still renders its stored text', () => {
    const projected = toThreadMessage(user('u1', null, 'plain question'));
    expect(projected.content).toEqual([{ type: 'text', text: 'plain question' }]);
  });

  test('graph identity survives the projection for deep links and branch operations', () => {
    const projected = toThreadMessage(assistant('a9', 'u1', 'answer'));
    expect(projected.id).toBe('a9');
    expect((projected.metadata?.custom as { graphId: string }).graphId).toBe('a9');
    expect((projected.metadata?.custom as { parentId: string }).parentId).toBe('u1');
  });

  test('an empty graph projects no messages', () => {
    expect(projectConversationThread(createConversationGraph('c1'))).toEqual({ messages: [], leafId: null });
    expect(projectConversationThread(null)).toEqual({ messages: [], leafId: null });
  });
});
