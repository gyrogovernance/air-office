import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createVaultEpisodicStore, createReasoningService, type ReasoningPorts } from '../../../packages/memory/src/memory.service.public';
import { exchangeMessagesSchema, type ReasoningMessage } from '../../../packages/memory/src/memory.domain.public';

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'air-exchange-'));
  const store = createVaultEpisodicStore(root);
  const messages: ReasoningMessage[] = [
    { id: 'one', parentId: null, role: 'user', content: 'Compare total cost.', complete: true, createdAt: '2026-10-26T08:00:00Z', failed: false },
    { id: 'two', parentId: 'one', role: 'assistant', content: 'Acquisition costs are 10 and 20.', complete: true, createdAt: '2026-10-26T08:01:00Z', failed: false },
    { id: 'three', parentId: 'two', role: 'user', content: 'Include maintenance costs.', complete: true, createdAt: '2026-10-26T08:02:00Z', failed: false },
  ];
  let enabled = true;
  let foreground = true;
  let generation = 'qwen-generation-1';
  const indexed: string[] = [];
  const ports: ReasoningPorts = {
    enabled: () => enabled, messages: () => messages, foregroundBusy: () => foreground,
    index: async (_record, text) => { indexed.push(text); },
    indexGeneration: () => generation,
    removeIndex: () => {}, retrieve: async (_query, records) => records.map(record => record.record_id),
    job: async (_id, work) => work(new AbortController().signal),
  };
  const service = createReasoningService(store, ports);
  return { store, ports, service, messages, indexed, enabled: (value: boolean) => { enabled = value; }, foreground: (value: boolean) => { foreground = value; }, generation: (value: string) => { generation = value; }, close: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('capture saves original roles and text immediately, once, before background indexing', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'two'); expect(h.service.dataset()).toEqual([]);
    h.service.schedule('chat', 'three'); h.service.schedule('chat', 'three');
    expect(h.service.dataset()).toEqual([{ messages: [
      { role: 'user', content: 'Compare total cost.' },
      { role: 'assistant', content: 'Acquisition costs are 10 and 20.' },
      { role: 'user', content: 'Include maintenance costs.' },
    ] }]);
    expect(h.store.list()[0]?.sources).toEqual([
      { message_id: 'one', occurred_at: '2026-10-26T08:00:00Z', role: 'user' },
      { message_id: 'two', occurred_at: '2026-10-26T08:01:00Z', role: 'assistant' },
      { message_id: 'three', occurred_at: '2026-10-26T08:02:00Z', role: 'user' },
    ]);
    expect(h.indexed).toEqual([]);
    h.foreground(false); await h.service.drain(); await h.service.drain();
    expect(h.indexed).toEqual(['user: Compare total cost.\n\nassistant: Acquisition costs are 10 and 20.\n\nuser: Include maintenance costs.']);
  } finally { h.close(); }
});

test('consecutive closed exchanges overlap at the human contribution and assistant replies do not duplicate them', () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three');
    h.messages.push({ ...h.messages[1]!, id: 'four', parentId: 'three', content: 'Including maintenance, the second is cheaper.' });
    h.service.schedule('chat', 'four');
    h.messages.push({ ...h.messages[2]!, id: 'five', parentId: 'four', content: 'Now include support.' });
    h.service.schedule('chat', 'five');
    expect(h.store.list().map(record => record.sources.map(source => source.message_id))).toEqual([['one', 'two', 'three'], ['three', 'four', 'five']]);
  } finally { h.close(); }
});

test('capture rejects reassigned roles, incomplete replies and empty messages', () => {
  const h = harness();
  try {
    h.messages[1]!.complete = false; h.service.schedule('chat', 'three');
    h.messages[1]!.complete = true; h.messages[2]!.content = ' '; h.service.schedule('chat', 'three');
    expect(h.store.list()).toEqual([]);
    expect(exchangeMessagesSchema.safeParse([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }]).success).toBe(false);
  } finally { h.close(); }
});

test('source edits create a new snapshot; deleting the chat preserves readable memory and dataset text', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three');
    h.messages[2]!.content = 'Include support costs instead.'; h.service.schedule('chat', 'three');
    h.messages.splice(0); h.foreground(false); await h.service.drain();
    expect(h.service.dataset().map(row => row.messages[2].content)).toEqual(['Include maintenance costs.', 'Include support costs instead.']);
    const found = await h.service.search('costs');
    expect(found).toHaveLength(2);
    expect(h.service.read(found[0]!.record_id)?.content).toContain('Include maintenance costs.');
  } finally { h.close(); }
});

test('chat tools exclude sibling branches and forgetting an exchange suppresses recapture and export', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three'); h.foreground(false); await h.service.drain();
    h.messages.push({ ...h.messages[2]!, id: 'sibling', content: 'Another task.' });
    expect(await h.service.search('costs', 3, { conversationId: 'chat', leafId: 'sibling' })).toEqual([]);
    const id = h.store.list()[0]!.record_id;
    expect(h.service.read(id, 0, 100, { conversationId: 'chat', leafId: 'sibling' })).toBeNull();
    h.service.forget('chat', id); h.service.schedule('chat', 'three'); await h.service.drain();
    expect(h.service.dataset()).toEqual([]); expect(await h.service.search('costs')).toEqual([]);
    expect(h.store.get(id)).toEqual({ state: 'deleted', record_id: id, conversation_id: 'chat' });
  } finally { h.close(); }
});

test('disabled memory prevents capture and tool reads while retaining the dataset for explicit management', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three'); const id = h.store.list()[0]!.record_id;
    h.enabled(false); h.foreground(false); await h.service.drain();
    expect(h.indexed).toEqual([]); expect(await h.service.search('costs')).toEqual([]); expect(h.service.read(id)).toBeNull();
    expect(h.service.dataset()).toHaveLength(1);
    h.messages[2]!.content = 'A new request.'; h.service.schedule('chat', 'three');
    expect(h.service.dataset()).toHaveLength(1);
  } finally { h.close(); }
});

test('long messages remain complete in dataset records, with bounded tool previews and paged reads', async () => {
  const h = harness();
  try {
    h.messages[1]!.content = 'Long reasoning. '.repeat(10000);
    h.service.schedule('chat', 'three'); h.foreground(false); await h.service.drain();
    expect(h.service.dataset()[0]!.messages[1].content).toBe(h.messages[1]!.content);
    const found = await h.service.search('reasoning');
    expect(found[0]?.truncated).toBe(true); expect(found[0]?.messages[1]?.content.length).toBe(2000);
    const id = found[0]!.record_id;
    let content = '', offset: number | null = 0;
    while (offset !== null) { const page: NonNullable<ReturnType<typeof h.service.read>> = h.service.read(id, offset, 12000)!; content += page.content; offset = page.nextOffset; }
    expect(JSON.parse(content).messages[1].content).toBe(h.messages[1]!.content);
  } finally { h.close(); }
});

test('index generation changes rebuild saved text without recapturing or generating summaries', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three'); h.foreground(false); await h.service.drain();
    h.generation('qwen-generation-2'); await h.service.drain();
    expect(h.indexed).toHaveLength(2); expect(h.service.dataset()).toHaveLength(1);
  } finally { h.close(); }
});

test('packs return 12 or 24 distinct messages and recover exchanges crossing the boundary', async () => {
  const h = harness();
  try {
    for (let index = 4; index <= 13; index++) {
      const previous = h.messages.at(-1)!;
      h.messages.push({ id: `m${index}`, parentId: previous.id, role: index % 2 === 0 ? 'assistant' : 'user', content: `Message ${index}.`, complete: true, createdAt: `2026-10-26T08:${String(index).padStart(2, '0')}:00Z`, failed: false });
      h.service.schedule('chat', `m${index}`);
    }
    h.foreground(false); await h.service.drain();
    const records = h.store.list();
    expect(records.length).toBeGreaterThanOrEqual(6);
    const anchor = records[3]!;
    const pack12 = h.service.readPack(anchor.record_id, 12);
    if (!pack12) throw new Error('Missing 12-message pack');
    expect(pack12.message_count).toBe(12); expect(pack12.complete).toBe(true); expect(pack12.window).toBe(12);
    const parsed = JSON.parse(pack12.content) as { messages: { content: string }[]; record_ids: string[] };
    expect(new Set(parsed.messages.map(message => message.content)).size).toBe(12);
    expect(parsed.record_ids.length).toBeGreaterThan(1);
    const pack24 = h.service.readPack(anchor.record_id, 24);
    if (!pack24) throw new Error('Missing 24-message pack');
    expect(pack24.message_count).toBeLessThan(24); expect(pack24.complete).toBe(false);
    expect(() => h.service.readPack(anchor.record_id, 12, 1)).toThrow('packId');
    const continued = h.service.readPack(anchor.record_id, 12, 1, 12000, undefined, pack12.packId);
    expect(continued?.content).toBe(pack12.content.slice(1, 1 + 12000));
    expect(() => h.service.readPack(anchor.record_id, 12, 1, 12000, undefined, 'pack-stale')).toThrow('changed');
  } finally { h.close(); }
});

test('reranking reorders the shortlist and falls back to embedding order on failure', async () => {
  const h = harness();
  try {
    h.service.schedule('chat', 'three');
    h.messages.push({ ...h.messages[1]!, id: 'four', parentId: 'three', content: 'Second answer.' });
    h.messages.push({ ...h.messages[2]!, id: 'five', parentId: 'four', content: 'Second continuation.' });
    h.service.schedule('chat', 'five');
    h.foreground(false); await h.service.drain();
    const ids = h.store.list().map(record => record.record_id);
    expect(ids).toHaveLength(2);
    h.ports.rerank = async (_query, records) => ({ ids: [...records].reverse().map(record => record.record_id), method: 'reranker' });
    const ranked = await h.service.search('costs');
    expect(ranked.map(record => record.record_id)).toEqual([...ids].reverse());
    expect(ranked[0]?.ranking).toEqual({ method: 'reranker' });
    h.ports.rerank = async () => ({ ids: [], method: 'embedding', reason: 'failed' });
    const fallback = await h.service.search('costs');
    expect(fallback.map(record => record.record_id)).toEqual(ids);
    expect(fallback[0]?.ranking).toEqual({ method: 'embedding', reason: 'failed' });
  } finally { h.close(); }
});

test('clearing or forgetting during indexing cannot resurrect a saved record', async () => {
  const h = harness();
  try {
    h.ports.index = async () => { h.service.clear(); };
    h.service.schedule('chat', 'three'); h.foreground(false); await h.service.drain();
    expect(h.store.list()).toEqual([]);
  } finally { h.close(); }
});

