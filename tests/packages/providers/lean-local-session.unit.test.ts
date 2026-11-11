import { describe, expect, test } from 'bun:test';
import { leanLocalMessagesForTest, runLeanLocalSession } from '../../../packages/providers/src/lean-local-session.adapter';
import { LEAN_LOCAL_SYSTEM_NOTE } from '../../../packages/providers/src/lean-local.policy';

async function collect(events: AsyncIterable<{ type: string; payload: unknown }>) {
  const out: Array<{ type: string; payload: unknown }> = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('lean local session', () => {
  test('prefixes the lean system note and keeps AIR tools available', () => {
    const messages = leanLocalMessagesForTest({
      runId: 'run-1',
      model: 'Bonsai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [
        { role: 'system', content: 'You are AIR.' },
        { role: 'user', content: 'Hello' }
      ],
      toolDefinitions: [{ id: 'builtin:view', name: 'view', description: 'Read a file', inputSchema: { type: 'object', properties: {} } }]
    });
    expect(messages[0]).toEqual({ role: 'system', content: LEAN_LOCAL_SYSTEM_NOTE });
    expect(LEAN_LOCAL_SYSTEM_NOTE).toContain('vault-relative paths');
    expect(LEAN_LOCAL_SYSTEM_NOTE).toContain('private/files');
    expect(messages.some((message) => message.role === 'system' && typeof message.content === 'string' && message.content.includes('view'))).toBe(true);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Hello' });
  });


  test('streams text without starting Copilot and invokes AIR tools through harness hooks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"view","arguments":"{\\"path\\":\\"programs/general/notes/a.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ];
    const followUp = [
      'data: {"choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ];
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const body = calls === 1 ? chunks.join('') : followUp.join('');
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const invoked: string[] = [];
    const events = await collect(runLeanLocalSession({
      runId: 'run-lean',
      model: 'Bonsai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [{ role: 'user', content: 'Read the note' }],
      toolDefinitions: [{ id: 'builtin:view', name: 'view', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }],
      harness: {
        gatedToolNames: new Set(),
        approveTool: async () => true,
        invokeTool: async (request) => {
          invoked.push(request.name);
          return { status: 'ok', result: { text: 'note body' } };
        }
      },
      fetchImpl
    }));
    expect(calls).toBe(2);
    expect(invoked).toEqual(['view']);
    expect(events.some((event) => event.type === 'text-delta')).toBe(true);
    expect(events.some((event) => event.type === 'tool-request')).toBe(true);
    expect(events.some((event) => event.type === 'tool-result')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'completion', payload: { reason: 'stop' } });
  });

  test('runs memory writes before memory_search when the model batches both', async () => {
    const first = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"search-1","function":{"name":"memory_search","arguments":"{\\"query\\":\\"durian\\"}"}},{"index":1,"id":"remember-1","function":{"name":"memory_remember","arguments":"{\\"content\\":\\"Edge fruit is durian.\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const followUp = [
      'data: {"choices":[{"delta":{"content":"Stored."},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    let calls = 0;
    const invoked: string[] = [];
    await collect(runLeanLocalSession({
      runId: 'run-memory-order',
      model: 'Bonsai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [{ role: 'user', content: 'Remember and search' }],
      toolDefinitions: [
        { id: 'builtin:memory-search', name: 'memory_search', description: 'Search', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        { id: 'builtin:memory-remember', name: 'memory_remember', description: 'Remember', inputSchema: { type: 'object', properties: { content: { type: 'string' } } } },
      ],
      harness: {
        gatedToolNames: new Set(),
        approveTool: async () => true,
        invokeTool: async (request) => {
          invoked.push(request.name);
          return { status: 'ok', result: request.name === 'memory_search' ? { memories: [] } : { memory: { id: '1' } } };
        },
      },
      fetchImpl: async () => {
        calls += 1;
        return new Response(calls === 1 ? first : followUp, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
    }));
    expect(invoked).toEqual(['memory_remember', 'memory_search']);
  });

  test('never claims success when a tool is unavailable on the lean path', async () => {
    const body = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"bash","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ].join('');
    const followUp = [
      'data: {"choices":[{"delta":{"content":"I could not run that."},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ].join('');
    let calls = 0;
    const events = await collect(runLeanLocalSession({
      runId: 'run-missing',
      model: 'Bonsai',
      baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [{ role: 'user', content: 'Run bash' }],
      toolDefinitions: [],
      fetchImpl: async () => {
        calls += 1;
        return new Response(calls === 1 ? body : followUp, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
    }));
    const result = events.find((event) => event.type === 'tool-result');
    expect(result).toMatchObject({ type: 'tool-result', payload: { status: 'error' } });
    expect(String((result as { payload: { message?: string } }).payload.message)).toContain('not available');
  });

  test('a web search can finish with an answer rather than requiring another search', async () => {
    const choices: unknown[] = [];
    const events = await collect(runLeanLocalSession({
      runId: 'search', model: 'local', baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [{ role: 'user', content: 'Search the web for news' }],
      toolDefinitions: [{ id: 'builtin:web-search', name: 'web_search', description: 'Search', inputSchema: { type: 'object', properties: {} } }],
      harness: { gatedToolNames: new Set(), approveTool: async () => true, invokeTool: async () => ({ status: 'ok', result: { items: [] } }) },
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        choices.push(body.tool_choice);
        const chunk = choices.length === 1
          ? { choices: [{ delta: { tool_calls: [{ index: 0, id: 'search-1', function: { name: 'web_search', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }
          : { choices: [{ delta: { content: 'No results found.' }, finish_reason: 'stop' }] };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }
    }));
    expect(choices).toEqual([{ type: 'function', function: { name: 'web_search' } }, 'auto']);
    expect(events.at(-1)).toMatchObject({ type: 'completion', payload: { reason: 'stop' } });
  });

  test('discovers and invokes an enabled tool outside the initial catalog', async () => {
    const bodies: Array<{ tools: Array<{ function: { name: string } }> }> = [];
    const called: string[] = [];
    const toolDefinitions = Array.from({ length: 17 }, (_, index) => ({
      id: `tool-${String(index).padStart(2, '0')}`,
      name: `tool_${String(index).padStart(2, '0')}`,
      description: index === 16 ? 'Calculate orbital trajectory' : `Other operation ${index}`,
      inputSchema: { type: 'object' as const, properties: {} },
    }));
    const events = await collect(runLeanLocalSession({
      runId: 'discover', model: 'local', baseUrl: 'http://127.0.0.1:8000/v1',
      messages: [{ role: 'user', content: 'Calculate an orbital trajectory' }], toolDefinitions,
      harness: { gatedToolNames: new Set(), approveTool: async () => true, invokeTool: async (input) => { called.push(input.toolId); return { status: 'ok', result: 'done' }; } },
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        const step = bodies.length;
        const delta = step < 3 ? { tool_calls: [{ index: 0, id: `call-${step}`, function: { name: step === 1 ? 'air_find_tools' : 'tool_16', arguments: step === 1 ? '{"query":"orbital trajectory"}' : '{}' } }] } : { content: 'Done' };
        return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: step < 3 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }
    }));
    expect(bodies[0]?.tools.some((tool) => tool.function.name === 'tool_16')).toBe(false);
    expect(bodies[1]?.tools.some((tool) => tool.function.name === 'tool_16')).toBe(true);
    expect(called).toEqual(['tool-16']);
    expect(events.at(-1)).toMatchObject({ type: 'completion', payload: { reason: 'stop' } });
  });
});
