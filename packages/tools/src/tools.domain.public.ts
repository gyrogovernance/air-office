import type { JsonSchema, ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { coerceToolArguments, isJsonSchema, validateToolArguments } from '@office/contracts/tool';

export type { JsonSchema, ToolConnection, ToolConnectionKind, ToolDefinition, ToolEffect } from '@office/contracts/tool';
export { coerceToolArguments, isJsonSchema, validateToolArguments } from '@office/contracts/tool';

export type ToolInvocation = { id: string; toolId: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled'; startedAt: string; finishedAt: string | null; result: unknown; error: string | null };

export type ToolHandler = (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;

export function validateConnection(value: unknown): value is ToolConnection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const connection = value as Record<string, unknown>;
  const local = connection.local;
  if (local !== undefined) {
    if (typeof local !== 'object' || local === null || Array.isArray(local)) return false;
    const config = local as Record<string, unknown>;
    if (Object.keys(config).some((key) => key !== 'catalogId') || !['atomic-mail', 'resend', 'shopify-dev'].includes(String(config.catalogId)) || connection.kind !== 'mcp' || connection.endpoint !== null) return false;
  }
  return typeof connection.id === 'string' && Boolean(connection.id) && typeof connection.name === 'string' && Boolean(connection.name.trim()) &&
    ['builtin', 'openapi', 'mcp'].includes(String(connection.kind)) && (connection.endpoint === null || typeof connection.endpoint === 'string') &&
    (connection.discoveredAt === null || typeof connection.discoveredAt === 'string') && typeof connection.enabled === 'boolean';
}

export function validateDefinition(value: unknown): value is ToolDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const definition = value as Record<string, unknown>;
  const schema: unknown = definition.inputSchema;
  if (!isJsonSchema(schema)) return false;
  return typeof definition.id === 'string' && Boolean(definition.id) && typeof definition.connectionId === 'string' && Boolean(definition.connectionId) &&
    typeof definition.name === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(definition.name) && typeof definition.description === 'string' && definition.description.length <= 4000 &&
    (definition.effect === 'read' || definition.effect === 'mutate') && typeof definition.enabled === 'boolean' && schema.type === 'object' &&
    (schema.required ?? []).every((key) => key in (schema.properties ?? {}));
}

/**
 * Models often send Cursor-ish field names (`glob` instead of `pattern`,
 * `contents` instead of `file_text`). Map those before schema validation so
 * everyday Find files / create calls do not fail on naming alone.
 */
function normalizeLeanToolInput(definition: ToolDefinition, input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  if (definition.name === 'glob') {
    if (typeof record.pattern !== 'string' && typeof record.glob === 'string') {
      record.pattern = record.glob;
      delete record.glob;
    }
  }
  if (definition.name === 'create') {
    if (typeof record.file_text !== 'string') {
      const alt = record.contents ?? record.content ?? record.text;
      if (typeof alt === 'string') {
        record.file_text = alt;
        delete record.contents;
        delete record.content;
        delete record.text;
      }
    }
  }
  return record;
}

export function invocationInput(definition: ToolDefinition, input: unknown): Record<string, unknown> {
  const coerced = coerceToolArguments(definition.inputSchema, normalizeLeanToolInput(definition, input));
  if (!validateToolArguments(definition.inputSchema, coerced)) throw new Error('Tool input does not match its declared fields.');
  if (typeof coerced !== 'object' || coerced === null || Array.isArray(coerced)) throw new Error('Tool input must be an object.');
  return coerced as Record<string, unknown>;
}

/**
 * Chat no longer refuses tools by effect. Settings owns which tools are enabled;
 * mutate tools and shell commands use per-invocation approval (or Allow All).
 */
export function blockedInChat(_definition: ToolDefinition): boolean {
  return false;
}

/**
 * Keep only tool ids that exist in the current enabled catalog, in request
 * order, unique. Unknown ids (stale client state or a model inventing a name)
 * are dropped; the live catalog is the only source of truth.
 */
export function selectEnabledTools(
  requestedIds: readonly string[],
  enabledDefinitions: readonly ToolDefinition[],
): ToolDefinition[] {
  const byId = new Map(enabledDefinitions.map((definition) => [definition.id, definition]));
  const selected: ToolDefinition[] = [];
  const seen = new Set<string>();
  for (const id of requestedIds) {
    if (!id || seen.has(id)) continue;
    const definition = byId.get(id);
    if (!definition) continue;
    seen.add(id);
    selected.push(definition);
  }
  return selected;
}

/**
 * The default tools for a conversation that names no tools: every enabled
 * Settings tool, one id per tool name. When two connections expose the same
 * name, the first enabled definition wins so a run does not fail closed on a
 * collision the operator never selected. Copilot first-party tools cover
 * files, shell, and page fetch. web_search is included because that name is
 * not a Copilot builtin on bring-your-own-key sessions. Mutate tools stay
 * available and ask for approval unless command permission is Allow All.
 */
export function defaultChatToolIds(definitions: readonly ToolDefinition[]): string[] {
  const seenNames = new Set<string>();
  const ids: string[] = [];
  for (const definition of definitions) {
    if (!definition.enabled || seenNames.has(definition.name)) continue;
    seenNames.add(definition.name);
    ids.push(definition.id);
  }
  return ids;
}

export function createBuiltinDefinitions(): ToolDefinition[] {
  return [
    { id: 'builtin:schedule-run', connectionId: 'builtin', name: 'schedule_run', description: 'Run an existing AIR Office automation now from its Library path (automations/*.automation.yaml). Requires explicit user confirmation before its steps start.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 1000, description: 'Library-relative path to the automation YAML file.' } }, required: ['path'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:action-run', connectionId: 'builtin', name: 'action_run', description: 'Run one AIR Office Action from its Library path (actions/*.md or .air/pack/actions/*.md) against supplied source material. This does not create or edit the Action file.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 1000 }, source: { type: 'string', minLength: 1, maxLength: 200000 }, instructions: { type: 'string', maxLength: 20000 } }, required: ['path', 'source'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:apply-markdown-note', connectionId: 'builtin', name: 'apply_markdown_note', description: 'Apply Markdown onto a Library note pair (*.note.json + *.md). Pass path to the .md or .note.json file. Omit markdown to read the paired .md from disk. Requires confirmation unless Allow All is on.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 1000 }, markdown: { type: 'string', maxLength: 2000000 } }, required: ['path'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:view', connectionId: 'builtin', name: 'view', description: 'Read a text file under the Library or a connected folder. Optional view_range is [startLine, endLine] 1-based; endLine may be -1 for EOF.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 }, view_range: { type: 'array', items: { type: 'integer' } } }, required: ['path'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:create', connectionId: 'builtin', name: 'create', description: 'Create a new text file under the Library or a connected folder. Fails if the path already exists. Requires confirmation unless Allow All is on.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 }, file_text: { type: 'string', maxLength: 2000000 } }, required: ['path', 'file_text'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:edit', connectionId: 'builtin', name: 'edit', description: 'Replace exactly one occurrence of old_str with new_str in a Library or connected-folder file. Fails if zero or many matches. Requires confirmation unless Allow All is on.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 }, old_str: { type: 'string', maxLength: 1000000 }, new_str: { type: 'string', maxLength: 1000000 } }, required: ['path', 'old_str', 'new_str'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:delete', connectionId: 'builtin', name: 'delete', description: 'Delete a file under the Library or a connected folder. For notes under notes/, prefer trashing the note pair. Requires confirmation unless Allow All is on.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['path'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:move', connectionId: 'builtin', name: 'move', description: 'Move or rename a file under the Library or a connected folder. Note pairs (.md + .note.json) move together. Requires confirmation unless Allow All is on.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 }, to: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['path', 'to'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:glob', connectionId: 'builtin', name: 'glob', description: 'Find files under the Library or a connected folder matching a glob pattern.', inputSchema: { type: 'object', properties: { pattern: { type: 'string', minLength: 1, maxLength: 400 }, path: { type: 'string', maxLength: 4000 } }, required: ['pattern'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:grep', connectionId: 'builtin', name: 'grep', description: 'Search file contents under the Library or a connected folder.', inputSchema: { type: 'object', properties: { pattern: { type: 'string', minLength: 1, maxLength: 400 }, path: { type: 'string', maxLength: 4000 }, output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] }, glob: { type: 'string', maxLength: 400 }, type: { type: 'string', maxLength: 40 }, '-i': { type: 'boolean' }, '-A': { type: 'integer', minimum: 0, maximum: 20 }, '-B': { type: 'integer', minimum: 0, maximum: 20 }, '-C': { type: 'integer', minimum: 0, maximum: 20 }, '-n': { type: 'boolean' }, head_limit: { type: 'integer', minimum: 1, maximum: 500 }, multiline: { type: 'boolean' } }, required: ['pattern'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:web-search', connectionId: 'builtin', name: 'web_search', description: 'Search the public web and return result titles, URLs, and short snippets. Always call this tool before stating live or online facts. Do not invent search results. Snippets are leads, not full page text.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 400 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:web-fetch', connectionId: 'builtin', name: 'web_fetch', description: 'Open one public http(s) URL and return title plus plain text. Use after web_search when you need page content. Do not invent page text.', inputSchema: { type: 'object', properties: { url: { type: 'string', minLength: 1, maxLength: 2000 }, max_chars: { type: 'integer', minimum: 500, maximum: 100000 } }, required: ['url'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:knowledge-search', connectionId: 'builtin', name: 'knowledge_search', description: 'Search indexed knowledge collections (full-text, vector, or hybrid). Returns short text hits with scores.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 50 }, mode: { type: 'string', enum: ['full-text', 'vector', 'hybrid'] }, collectionIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 } } }, required: ['query'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:open-path', connectionId: 'builtin', name: 'open_path', description: 'Ask AIR Office to open a Library or connected-folder file on the stage (note or file preview).', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['path'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:open-in-code', connectionId: 'builtin', name: 'open_in_code', description: 'Open a connected-folder file in the Code workbench. Library files open on the stage instead of mounting the Library as the Code tree.', inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['path'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:calendar-list', connectionId: 'builtin', name: 'calendar_list', description: 'List upcoming calendar events from Library calendars (calendar/*.ics). Optional from/to ISO dates and calendarPath filter.', inputSchema: { type: 'object', properties: { from: { type: 'string', minLength: 4, maxLength: 40 }, to: { type: 'string', minLength: 4, maxLength: 40 }, calendarPath: { type: 'string', minLength: 1, maxLength: 400 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: [], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:todo-write', connectionId: 'builtin', name: 'todo_write', description: 'Merge a short in-turn task checklist. Pass todos with id, content, and status (pending|in_progress|completed|cancelled). At most one in_progress. Returns the full list.', inputSchema: { type: 'object', properties: { todos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 80 }, content: { type: 'string', minLength: 1, maxLength: 400 }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] } }, required: ['id', 'content', 'status'], additionalProperties: false } } }, required: ['todos'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:generate-image', connectionId: 'builtin', name: 'generate_image', description: 'Generate an image from a text prompt with a provider that advertises image generation.', inputSchema: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 2000 }, provider: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['prompt'], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:run-code', connectionId: 'builtin', name: 'run_code', description: 'Execute JavaScript locally with the current user’s filesystem and network access. Chat runs ask for approval unless Allow All is explicitly selected. Disabled until the operator enables it in Tools settings.', inputSchema: { type: 'object', properties: { code: { type: 'string', minLength: 1, maxLength: 100000 }, language: { type: 'string', minLength: 1, maxLength: 20 } }, required: ['code'], additionalProperties: false }, effect: 'mutate', enabled: false },
    { id: 'builtin:memory-search', connectionId: 'builtin', name: 'memory_search', description: 'Search saved memory facts. Returns id, content, and path (memory/facts.jsonl).', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 400 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: [], additionalProperties: false }, effect: 'read', enabled: true },
    { id: 'builtin:memory-remember', connectionId: 'builtin', name: 'memory_remember', description: 'Store a short fact in AIR Office memory so later conversations can recall it.', inputSchema: { type: 'object', properties: { content: { type: 'string', minLength: 1, maxLength: 2000 }, conversationId: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['content'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:memory-update', connectionId: 'builtin', name: 'memory_update', description: 'Replace the text of an existing memory fact by id.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 200 }, content: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['id', 'content'], additionalProperties: false }, effect: 'mutate', enabled: true },
    { id: 'builtin:memory-forget', connectionId: 'builtin', name: 'memory_forget', description: 'Delete a memory fact by id.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['id'], additionalProperties: false }, effect: 'mutate', enabled: true }
  ];
}
