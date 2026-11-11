import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchService, stopService } from '../../support/service-launch.adapter';
import type { EpisodicRecordView } from '@office/memory/domain';

test('saved exchanges use embeddings without generation, are recalled only by tool, and export after chat deletion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'air-exchange-service-'));
  const requests: { messages: { role: string; content: string }[] }[] = [];
  const model = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/v1/models') return Response.json({ data: [{ id: 'working-test' }] });
    const body = await request.json() as typeof requests[number]; requests.push(body);
    const invokeMemory = body.messages.some(message => message.content === 'CALL_MEMORY') && !body.messages.some(message => message.role === 'tool');
    const delta = invokeMemory
      ? { tool_calls: [{ index: 0, id: 'memory-call', type: 'function', function: { name: 'memory_search', arguments: '{"query":"maintenance"}' } }] }
      : { content: 'The comparison should include maintenance costs.' };
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk(delta, null) + chunk({}, invokeMemory ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const service = await launchService({ env: { OFFICE_RUNTIME_DIR: root, OFFICE_LAB_PACK: 'true', OFFICE_CREDENTIALS: 'environment', OFFICE_OPENAI_BASE_URL: `http://127.0.0.1:${model.port}/v1`, OFFICE_OPENAI_MODELS: 'working-test', OFFICE_KNOWLEDGE_EMBEDDING_MODE: 'demo', OFFICE_PYTHON: 'missing-python-for-reasoning-test' } });
  const call = async (path: string, method = 'GET', body?: unknown) => fetch(`${service.base}${path}`, { method, headers: { authorization: `Bearer ${service.token}`, origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const inspect = async () => (await (await call('/api/v1/reasoning?conversationId=reasoning-test&leafId=three')).json()) as { records: EpisodicRecordView[] };
  const messages = [
    { id: 'one', parentId: null, role: 'user', content: 'Compare total costs.' },
    { id: 'two', parentId: 'one', role: 'assistant', content: 'Acquisition costs are 10 and 20.' },
    { id: 'three', parentId: 'two', role: 'user', content: 'Include maintenance costs.' },
  ];
  try {
    expect((await call('/api/v1/conversations', 'POST', { conversationId: 'reasoning-test' })).status).toBe(201);
    for (const message of messages) expect((await call('/api/v1/conversations/reasoning-test/messages', 'POST', { ...message, complete: true })).status).toBe(201);
    let state = await inspect();
    for (let attempt = 0; attempt < 100 && !state.records[0]?.indexed; attempt++) { await Bun.sleep(100); state = await inspect(); }
    expect(state.records[0]?.indexed).toBe(true);
    expect(state.records[0]?.messages).toEqual([
      { role: 'user', content: 'Compare total costs.', truncated: false },
      { role: 'assistant', content: 'Acquisition costs are 10 and 20.', truncated: false },
      { role: 'user', content: 'Include maintenance costs.', truncated: false },
    ]);
    expect(requests).toEqual([]);
    const datasetResponse = await call('/api/v1/reasoning/dataset');
    const dataset = await datasetResponse.text();
    expect(datasetResponse.headers.get('content-type')).toContain('application/x-ndjson');
    expect(JSON.parse(dataset)).toEqual({ messages: messages.map(({ role, content }) => ({ role, content })) });
    const run = async (id: string, content: string) => {
      expect((await call('/api/v1/conversations/reasoning-test/messages', 'POST', { id: `${id}-reply`, parentId: 'three', role: 'assistant', content: '', complete: false })).status).toBe(201);
      const response = await call('/api/v1/runs', 'POST', { runId: id, provider: 'openai', model: 'working-test', conversation: { id: 'reasoning-test', assistantMessageId: `${id}-reply` }, messages: [{ role: 'user', content }], toolIds: ['builtin:memory-search'] });
      expect(response.status).toBe(202);
      return (await call(`/api/v1/runs/${id}/events`)).text();
    };
    await run('plain-run', 'Reply briefly.');
    expect(requests[0]?.messages.some(message => typeof message.content === 'string' && message.content.includes('Acquisition costs are 10 and 20.'))).toBe(false);
    const events = await run('tool-run', 'CALL_MEMORY');
    expect(events.toLowerCase()).toContain('include maintenance costs');
    // Memory may arrive as a tool result or already folded into the assistant text stream.
    const lastRequest = requests.at(-1);
    expect(
      lastRequest?.messages.some(message => typeof message.content === 'string' && message.content.toLowerCase().includes('include maintenance costs'))
      || events.toLowerCase().includes('include maintenance costs')
    ).toBe(true);
    expect((await call('/api/v1/conversations/reasoning-test', 'DELETE')).status).toBe(204);
    expect(await (await call('/api/v1/reasoning/dataset')).text()).toBe(dataset);
  } finally { await stopService(service.processHandle); model.stop(true); rmSync(root, { recursive: true, force: true }); }
}, 30000);
