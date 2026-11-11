import { expect, test } from 'bun:test';
import { createChatEnvelopeFactory, mapCopilotSessionEvent } from '../../../packages/providers/src/copilot-event.adapter';

const runId = 'run-copilot-events';

test('Copilot message deltas and usage map into canonical chat envelopes', () => {
  const envelope = createChatEnvelopeFactory(runId, 7);
  const delta = mapCopilotSessionEvent({
    type: 'assistant.message_delta',
    id: 'e1',
    parentId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    ephemeral: true,
    data: { messageId: 'm1', deltaContent: 'Hello' }
  } as never, envelope);
  expect(delta).toMatchObject({ type: 'text-delta', sequence: 7, payload: { messageId: 'm1', text: 'Hello' } });

  const usage = mapCopilotSessionEvent({
    type: 'assistant.usage',
    id: 'e2',
    parentId: 'e1',
    timestamp: '2026-01-01T00:00:01.000Z',
    data: { model: 'test', inputTokens: 12, outputTokens: 3 }
  } as never, envelope);
  expect(usage).toMatchObject({ type: 'usage', sequence: 8, payload: { inputTokens: 12, outputTokens: 3 } });
});

test('unsupported Copilot lifecycle events are ignored at the AIR boundary', () => {
  const envelope = createChatEnvelopeFactory(runId);
  expect(mapCopilotSessionEvent({
    type: 'session.idle',
    id: 'idle',
    parentId: null,
    timestamp: '2026-01-01T00:00:00.000Z',
    data: {}
  } as never, envelope)).toBeNull();
});
