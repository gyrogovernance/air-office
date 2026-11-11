import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_PROTOCOL_VERSION, type ChatEventEnvelope, type ChatRunRequest } from '@office/contracts/chat';
import { createSqliteChatRunStore } from '../../../packages/chat/src/chat.service.public';

const request: ChatRunRequest = { runId: 'run', model: 'local-replay', messages: [{ role: 'user', content: 'fixture question' }], context: { selection: 'fixture selection', fileName: 'fixture.txt' } };
const delta = (sequence: number): ChatEventEnvelope => ({ protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `run:${sequence}`, runId: 'run', correlationId: 'run', sequence, timestamp: new Date(0).toISOString(), type: 'text-delta', payload: { messageId: 'answer', text: 'partial ' } });

test('SQLite retains request, messages, events and terminal status across reopen', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-chat-store-'));
  let store = createSqliteChatRunStore(join(scratch, 'chat.sqlite'));
  try {
    expect(store.create(request)).toBe(true);
    expect(store.create(request)).toBe(false);
    store.append(delta(0));
    const complete: ChatEventEnvelope = { ...delta(1), type: 'message-complete', payload: { messageId: 'answer', text: 'complete answer' } };
    store.append(complete);
    store.append({ ...delta(2), type: 'completion', payload: { reason: 'stop' } });
    store.close();
    store = createSqliteChatRunStore(join(scratch, 'chat.sqlite'));
    store.interrupt();
    expect(store.get('run')?.request).toEqual(request);
    expect(store.get('run')?.status).toBe('complete');
    expect(store.get('run')?.state.messages).toEqual([{ id: 'answer', role: 'assistant', content: 'complete answer', complete: true }]);
    expect(store.events('run', 0)).toEqual([complete, { ...delta(2), type: 'completion', payload: { reason: 'stop' } }]);
    expect(store.events('run', 2)).toEqual([]);
    expect(() => store.append(delta(3))).toThrow('Invalid chat event transition');
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('interruption preserves partial output and is idempotent; sequence errors do not mutate storage', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-chat-store-'));
  let store = createSqliteChatRunStore(join(scratch, 'chat.sqlite'));
  try {
    store.create(request);
    expect(() => store.append(delta(1))).toThrow();
    expect(store.events('run', -1)).toEqual([]);
    store.append(delta(0));
    expect(() => store.append(delta(0))).toThrow();
    store.close();
    store = createSqliteChatRunStore(join(scratch, 'chat.sqlite'));
    store.interrupt();
    store.interrupt();
    expect(store.get('run')?.status).toBe('interrupted');
    expect(store.get('run')?.state.messages[0]).toEqual({ id: 'answer', role: 'assistant', content: 'partial ', complete: false });
    const events = store.events('run', -1);
    expect(events).toHaveLength(2);
    expect(events[1]?.type).toBe('failure');
    expect(events[1]?.payload).toMatchObject({ code: 'run-interrupted' });
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});

test('replay is paged without discarding earlier events', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'air-chat-store-'));
  const store = createSqliteChatRunStore(join(scratch, 'chat.sqlite'));
  try {
    store.create(request);
    for (let sequence = 0; sequence < 300; sequence++) store.append(delta(sequence));
    expect(store.events('run', -1, 1000)).toHaveLength(256);
    expect(store.events('run', 255)).toHaveLength(44);
    expect(store.events('run', -1, 1)[0]).toEqual(delta(0));
  } finally { store.close(); rmSync(scratch, { recursive: true, force: true }); }
});
