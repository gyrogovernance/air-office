import { expect, test } from 'bun:test';
import type { ChatEventEnvelope, ChatRunRequest } from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION } from '@office/contracts/chat';
import { LocalReplayConnection, createProvidersService } from '../../../packages/providers/src/providers.service.public';

async function collect(stream: AsyncIterable<ChatEventEnvelope>): Promise<ChatEventEnvelope[]> {
  const events: ChatEventEnvelope[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const request: ChatRunRequest = {
  runId: 'run-1',
  model: 'local-replay',
  messages: [{ role: 'user', content: 'Explain this' }]
};

test('local replay streams a complete deterministic protocol sequence', async () => {
  const connection = new LocalReplayConnection();
  const events = await collect(connection.stream(request));
  expect(events.every((event) => event.protocolVersion === CHAT_PROTOCOL_VERSION)).toBe(true);
  expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
  expect(events.at(0)?.type).toBe('text-delta');
  expect(events.some((event) => event.type === 'message-complete')).toBe(true);
  expect(events.at(-1)?.type).toBe('completion');
  expect(events.every((event) => event.runId === 'run-1')).toBe(true);
});

test('replay is deterministic across runs', async () => {
  const first = await collect(new LocalReplayConnection().stream(request));
  const second = await collect(new LocalReplayConnection().stream(request));
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
});

test('an aborted signal ends the run with a cancelled completion', async () => {
  const controller = new AbortController();
  controller.abort();
  const events = await collect(new LocalReplayConnection().stream(request, controller.signal));
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe('completion');
  expect(events[0]?.payload).toEqual({ reason: 'cancelled' });
});

test('providers service exposes a default connection', () => {
  const service = createProvidersService();
  expect(service.default().id).toBe('local-replay');
  expect(service.get('local-replay')).toBeDefined();
  expect(service.get('missing')).toBeUndefined();
});

test('a note selection with edit intent streams a buffered apply_markdown_note tool call', async () => {
  const editRequest: ChatRunRequest = {
    runId: 'run-edit',
    model: 'local-replay',
    messages: [{ role: 'user', content: 'Please rewrite this paragraph' }],
    context: { selection: 'the   quick  brown   fox', fileName: 'notes.md', fileId: 'note:demo' }
  };
  const events = await collect(new LocalReplayConnection().stream(editRequest));
  const fragments = events.filter((event) => event.type === 'tool-arguments-fragment');
  expect(fragments).toHaveLength(2);
  const combined = fragments.map((event) => (event.payload as { argumentsDelta: string }).argumentsDelta).join('');
  expect(JSON.parse(combined)).toEqual({ path: 'programs/general/notes/notes.md', markdown: 'the quick brown fox' });
  const request_ = events.find((event) => event.type === 'tool-request');
  expect((request_?.payload as { name: string }).name).toBe('apply_markdown_note');
  expect((request_?.payload as { arguments: Record<string, unknown> }).arguments.markdown).toBe('the quick brown fox');
  expect(events.at(-1)?.payload).toEqual({ reason: 'tool' });
});
