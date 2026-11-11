import { expect, test } from 'bun:test';
import type { ChatRunRequest } from '@office/contracts/chat';
import { LocalReplayConnection } from '@office/providers/service';
import { demoReplayScript } from '../../../apps/service/src/demo-replay.script';

async function textOf(request: ChatRunRequest): Promise<string> {
  const connection = new LocalReplayConnection({ script: demoReplayScript });
  let text = '';
  for await (const event of connection.stream(request)) {
    if (event.type === 'message-complete') text = (event.payload as { text: string }).text;
  }
  return text;
}

test('demo replay answers a safety-case question with showcase structure', async () => {
  const text = await textOf({ runId: 'demo-1', model: 'Demo-Chat', messages: [{ role: 'user', content: 'What belongs in a frontier AI safety case before deployment?' }] });
  expect(text).toContain('Decision frame');
  expect(text).toContain('Evidence to request');
  expect(text).not.toContain('Deterministic local provider');
});

test('demo replay keeps apply_markdown_note for rewrite selections', async () => {
  const connection = new LocalReplayConnection({ script: (request) => demoReplayScript(request, async () => ({ content: 'Before\nthe   quick  brown   fox\nAfter', version: 'current-note' })) });
  const events = [];
  for await (const event of connection.stream({
    runId: 'demo-edit',
    model: 'Demo-Chat',
    messages: [{ role: 'user', content: 'Please rewrite this paragraph' }],
    context: { selection: 'the   quick  brown   fox', fileName: 'brief.md', fileId: 'note:demo' },
  })) events.push(event);
  expect(events.find((event) => event.type === 'tool-request')?.payload).toMatchObject({
    name: 'apply_markdown_note',
    arguments: { path: 'programs/general/notes/brief.md', markdown: 'Before\nthe quick brown fox\nAfter' },
  });
  expect(events.find((event) => event.type === 'message-complete')?.payload).toMatchObject({ text: expect.stringContaining('tighter revision') });
});
