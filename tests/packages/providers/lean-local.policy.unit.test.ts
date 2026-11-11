import { describe, expect, test } from 'bun:test';
import { isLocalChatEndpoint, resolveChatExecutionMode, selectLeanTools, leanToolChoice, LEAN_TOOL_CATALOG_LIMIT } from '../../../packages/providers/src/lean-local.policy';

describe('isLocalChatEndpoint', () => {
  test('treats managed-local and loopback as local', () => {
    expect(isLocalChatEndpoint({ providerId: 'managed-local' })).toBe(true);
    expect(isLocalChatEndpoint({ baseUrl: 'http://127.0.0.1:8000/v1' })).toBe(true);
    expect(isLocalChatEndpoint({ baseUrl: 'http://localhost:11434/v1' })).toBe(true);
  });

  test('treats cloud endpoints as non-local', () => {
    expect(isLocalChatEndpoint({ providerId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })).toBe(false);
    expect(isLocalChatEndpoint({ providerId: 'chatgpt-signin', baseUrl: 'https://api.openai.com/v1' })).toBe(false);
  });
});

describe('resolveChatExecutionMode', () => {
  test('cloud always uses the full harness', () => {
    expect(resolveChatExecutionMode({ providerId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', fullHarnessEnabled: false })).toBe('full');
    expect(resolveChatExecutionMode({ providerId: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', fullHarnessEnabled: true })).toBe('full');
  });

  test('local defaults to lean and opts into full harness per model', () => {
    expect(resolveChatExecutionMode({ providerId: 'managed-local', fullHarnessEnabled: false })).toBe('lean');
    expect(resolveChatExecutionMode({ providerId: 'managed-local', fullHarnessEnabled: true })).toBe('full');
    expect(resolveChatExecutionMode({ baseUrl: 'http://127.0.0.1:8000/v1', fullHarnessEnabled: false })).toBe('lean');
    expect(resolveChatExecutionMode({ baseUrl: 'http://127.0.0.1:8000/v1', fullHarnessEnabled: true })).toBe('full');
  });
});

describe('selectLeanTools', () => {
  test('keeps a tool explicitly named in the request when the catalog is full', () => {
    const tools = Array.from({ length: 18 }, (_, index) => ({ id: `tool-${index}`, name: `tool_${index}`, description: '', inputSchema: { type: 'object' as const, properties: {} } }));
    expect(selectLeanTools(tools, 16, 'Use tool_17 for this task').map((tool) => tool.name)).toContain('tool_17');
  });
  test('keeps every agent-selected tool when the catalog is full', () => {
    const tools = Array.from({ length: 20 }, (_, index) => ({ id: `tool-${index}`, name: `tool_${index}`, description: '', inputSchema: { type: 'object' as const, properties: {} } }));
    const selected = selectLeanTools(tools, 16, '', ['tool-19', 'tool-18']);
    expect(selected.map((tool) => tool.id)).toContain('tool-19');
    expect(selected.map((tool) => tool.id)).toContain('tool-18');
    expect(selectLeanTools(tools, 2, '', tools.map((tool) => tool.id))).toHaveLength(20);
  });
  test('keeps core path tools when request-named tools already fill the cap', () => {
    const core = ['web_search', 'view', 'glob', 'grep', 'create', 'edit'].map((name) => ({
      id: `builtin:${name}`,
      name,
      description: '',
      inputSchema: { type: 'object' as const, properties: {} },
    }));
    const fillers = Array.from({ length: 16 }, (_, index) => ({
      id: `filler-${index}`,
      name: `filler_${index}`,
      description: '',
      inputSchema: { type: 'object' as const, properties: {} },
    }));
    const selected = selectLeanTools([...core, ...fillers], 16, fillers.map((tool) => tool.name).join(' '));
    expect(selected.length).toBeGreaterThan(16);
    for (const name of ['web_search', 'view', 'glob', 'grep', 'create', 'edit']) {
      expect(selected.some((tool) => tool.name === name)).toBe(true);
    }
  });
  test('never drops core path tools while capping', () => {
    const tools = [
      { id: 'a', name: 'generate_image', description: 'd', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'b', name: 'view', description: 'r', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'c', name: 'web_search', description: 'm', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'd', name: 'glob', description: 'g', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'e', name: 'grep', description: 'g', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'f', name: 'create', description: 'c', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'g', name: 'edit', description: 'e', inputSchema: { type: 'object' as const, properties: {} } },
      ...Array.from({ length: LEAN_TOOL_CATALOG_LIMIT }, (_, index) => ({
        id: `x${index}`,
        name: `other_${index}`,
        description: 'o',
        inputSchema: { type: 'object' as const, properties: {} }
      }))
    ];
    const selected = selectLeanTools(tools);
    expect(selected).toHaveLength(LEAN_TOOL_CATALOG_LIMIT);
    expect(selected.some((tool) => tool.name === 'view')).toBe(true);
    expect(selected.some((tool) => tool.name === 'web_search')).toBe(true);
    expect(selected.some((tool) => tool.name === 'glob')).toBe(true);
    expect(selected.some((tool) => tool.name === 'grep')).toBe(true);
    expect(selected.some((tool) => tool.name === 'create')).toBe(true);
    expect(selected.some((tool) => tool.name === 'edit')).toBe(true);
  });

  test('prefers apply_markdown_note and lab gadgets over other leftovers while capping', () => {
    const tools = [
      { id: 'builtin:web-search', name: 'web_search', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:view', name: 'view', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:glob', name: 'glob', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:grep', name: 'grep', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:create', name: 'create', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:edit', name: 'edit', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:apply-markdown-note', name: 'apply_markdown_note', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'builtin:lab-review', name: 'lab_review', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      { id: 'zzz:other', name: 'other_tool', description: '', inputSchema: { type: 'object' as const, properties: {} } },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `filler-${index}`,
        name: `filler_${index}`,
        description: '',
        inputSchema: { type: 'object' as const, properties: {} }
      }))
    ];
    const selected = selectLeanTools(tools);
    expect(selected).toHaveLength(LEAN_TOOL_CATALOG_LIMIT);
    expect(selected.map((tool) => tool.name)).toContain('apply_markdown_note');
    expect(selected.map((tool) => tool.id)).toContain('builtin:lab-review');
    expect(selected.map((tool) => tool.id)).not.toContain('zzz:other');
  });

  test('soft-cap is 20 and append order keeps core plus new lean tools when present', () => {
    expect(LEAN_TOOL_CATALOG_LIMIT).toBe(20);
    const tools = [
      ...['web_search', 'view', 'glob', 'grep', 'create', 'edit'].map((name) => ({
        id: `builtin:${name}`,
        name,
        description: '',
        inputSchema: { type: 'object' as const, properties: {} },
      })),
      ...['apply_markdown_note', 'web_fetch', 'knowledge_search', 'delete', 'move', 'open_path', 'calendar_list', 'todo_write', 'generate_image'].map((name) => ({
        id: `builtin:${name}`,
        name,
        description: '',
        inputSchema: { type: 'object' as const, properties: {} },
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `filler-${index}`,
        name: `filler_${index}`,
        description: '',
        inputSchema: { type: 'object' as const, properties: {} },
      })),
    ];
    const selected = selectLeanTools(tools);
    expect(selected).toHaveLength(20);
    for (const name of ['web_search', 'view', 'glob', 'grep', 'create', 'edit', 'apply_markdown_note', 'web_fetch', 'knowledge_search', 'delete', 'move', 'open_path', 'calendar_list', 'todo_write']) {
      expect(selected.some((tool) => tool.name === name)).toBe(true);
    }
  });
});

describe('leanToolChoice', () => {
  const web = [{ id: 'builtin:web-search', name: 'web_search', description: 'Search', inputSchema: { type: 'object' as const, properties: {} } }];

  test('forces web_search for clear online-info requests', () => {
    expect(leanToolChoice([{ role: 'user', content: 'Search the web for latest news about bikes' }], web)).toEqual({
      type: 'function',
      function: { name: 'web_search' }
    });
  });

  test('recognizes a web request alongside an attachment', () => {
    expect(leanToolChoice([{ role: 'user', content: [{ type: 'text', text: 'Search the web for this topic' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }], web)).toEqual({ type: 'function', function: { name: 'web_search' } });
    expect(leanToolChoice([{ role: 'user', content: [{ type: 'text', text: 'Summarize this document' }, { type: 'text', text: 'Attached file: notes.txt\nLatest news' }] }], web)).toBe('auto');
  });

  test('stays auto for ordinary chat', () => {
    expect(leanToolChoice([{ role: 'user', content: 'Summarize this paragraph for me' }], web)).toBe('auto');
    expect(leanToolChoice([{ role: 'user', content: 'Search my notes for the project name' }], web)).toBe('auto');
  });

  test('allows the assistant to answer after a search in the current turn', () => {
    expect(leanToolChoice([
      { role: 'user', content: 'Search the web for news' },
      { role: 'assistant', content: null, tool_calls: [{ function: { name: 'web_search' } }] },
      { role: 'tool', content: 'Search results' }
    ], web)).toBe('auto');
    expect(leanToolChoice([
      { role: 'user', content: 'Search the web for news' },
      { role: 'assistant', content: null, tool_calls: [{ function: { name: 'web_search' } }] },
      { role: 'tool', content: 'Search results' },
      { role: 'user', content: 'Search the web for another topic' }
    ], web)).not.toBe('auto');
  });

  test('forces web_search again on short continuations after a failed search', () => {
    expect(leanToolChoice([
      { role: 'user', content: 'pls search online for white cake recipes' },
      { role: 'assistant', content: null, tool_calls: [{ function: { name: 'web_search' } }] },
      { role: 'tool', content: 'Web search could not complete. Try again shortly.' },
      { role: 'assistant', content: 'I apologize for the failure to complete the search.' },
      { role: 'user', content: 'go on' }
    ], web)).toEqual({ type: 'function', function: { name: 'web_search' } });
    expect(leanToolChoice([
      { role: 'user', content: 'Search the web for news' },
      { role: 'assistant', content: null, tool_calls: [{ function: { name: 'web_search' } }] },
      { role: 'tool', content: '{"query":"news","results":[{"url":"https://example.com"}]}' },
      { role: 'assistant', content: 'Here are the headlines.' },
      { role: 'user', content: 'ok' }
    ], web)).toBe('auto');
  });
});
