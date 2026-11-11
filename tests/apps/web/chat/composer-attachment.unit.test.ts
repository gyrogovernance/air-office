import { describe, expect, test } from 'bun:test';
import { createChatAttachmentAdapter } from '../../../../apps/web/src/chat/composer-attachment.adapter';
import { createServiceClient } from '../../../../apps/web/src/shared/service-client.hook';

async function collect<T>(source: T | Promise<T> | AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  const resolved = await source;
  if (Symbol.asyncIterator in Object(resolved)) {
    for await (const value of resolved as AsyncIterable<T>) values.push(value);
  } else values.push(resolved as T);
  return values;
}

describe('chat attachment upload', () => {
  test('uploads the selected file before it becomes ready', async () => {
    const file = new File([new Uint8Array(300_000)], 'large.txt', { type: 'text/plain' });
    const uploads: FormData[] = [];
    const client = { ...createServiceClient(), request: async (_path: string, init?: RequestInit) => { if (init?.body instanceof FormData) uploads.push(init.body); return new Response(null, { status: 201 }); } };
    const states = await collect(createChatAttachmentAdapter(client).add({ file }));
    const progress = states.flatMap((state) => state.status.type === 'running' ? [state.status.progress] : []);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(uploads[0]?.get('file')).toBe(file);
    expect(uploads[0]?.get('id') ?? null).toBe(states.at(-1)?.id ?? null);
  });

  test('turns upload failures into a visible failed attachment', async () => {
    const file = new File(['bad'], 'broken.txt', { type: 'text/plain' });
    const client = { ...createServiceClient(), request: async () => { throw new Error('upload failed'); } };
    const states = await collect(createChatAttachmentAdapter(client).add({ file }));
    const failure = states.at(-1);
    expect(failure?.status).toMatchObject({ type: 'incomplete', reason: 'error', message: 'broken.txt could not be uploaded.' });
  });

  test('rejects zero-byte files without attempting to read them', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    const states = await collect(createChatAttachmentAdapter().add({ file }));
    expect(states.at(-1)?.status).toMatchObject({ type: 'incomplete', reason: 'error' });
    const status = states.at(-1)?.status;
    expect(status?.type).toBe('incomplete');
    if (status?.type === 'incomplete') expect(status.message).toContain('empty');
  });
});
