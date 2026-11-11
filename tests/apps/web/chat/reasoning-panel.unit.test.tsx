import { expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';
import { createConversationGraph } from '@office/chat/domain';
import type { EpisodicRecordView } from '@office/memory/domain';
import type { ServiceClient } from '../../../../apps/web/src/shared/service-client.hook';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ReasoningPanel } = await import('../../../../apps/web/src/chat/reasoning-panel.component');

test('the inspector keeps setup and branches expandable, links evidence and sends branch-scoped memory deletion', async () => {
  const writes: { path: string; method: string | undefined; body: unknown }[] = [];
  const selected: string[] = [];
  let records: EpisodicRecordView[] = [{ record_id: 'record1', conversation_id: 'chat', branch_id: 'three', created_at: '2026-10-21T08:00:00Z', state: 'ready', messages: [{ role: 'user', content: 'Compare the two plans.', truncated: false }, { role: 'assistant', content: 'The first plan is faster.', truncated: false }, { role: 'user', content: 'Include ongoing cost in the comparison.', truncated: false }], indexed: true, error: null, sources: [{ message_id: 'one', role: 'user', occurred_at: '2026-10-21T08:00:00Z' }, { message_id: 'two', role: 'assistant', occurred_at: '2026-10-21T08:01:00Z' }, { message_id: 'three', role: 'user', occurred_at: '2026-10-21T08:02:00Z' }] }];
  const snapshot = () => ({ enabled: true, embedding: { model: 'Qwen3-Embedding-0.6B-GGUF', revision: 'v1', dimensions: 1024 }, records });
  const client: ServiceClient = { base: 'http://test', token: async () => 'fixture', request: async () => Response.json({}), async json<T>(path: string, init?: RequestInit): Promise<T> {
    if (init?.method) { writes.push({ path, method: init.method, body: JSON.parse(String(init.body)) }); if (init.method === 'DELETE') records = []; }
    return snapshot() as T;
  } };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReasoningPanel graph={createConversationGraph('chat')} leafId="three" client={client} onSelectMessage={id => selected.push(id)}/>));
    await act(async () => { for (let attempt = 0; attempt < 100 && !host.querySelector('.reasoning-setup'); attempt++) await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(host.querySelector('.reasoning-setup')?.hasAttribute('open')).toBe(false);
    expect(host.querySelector('.reasoning-branches')?.hasAttribute('open')).toBe(false);
    const source = [...host.querySelectorAll('button')].find(button => button.textContent === 'Message 1');
    if (!source) throw new Error('Missing source action');
    expect(source.disabled).toBe(true);
    await act(async () => source.click()); expect(selected).toEqual([]);
    const forget = [...host.querySelectorAll('button')].find(button => button.textContent === 'Forget');
    if (!forget) throw new Error('Missing forget action');
    await act(async () => forget.click());
    expect(writes).toEqual([{ path: '/api/v1/reasoning?conversationId=chat&leafId=three', method: 'DELETE', body: { recordId: 'record1' } }]);
    expect(host.querySelectorAll('.reasoning-record')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
