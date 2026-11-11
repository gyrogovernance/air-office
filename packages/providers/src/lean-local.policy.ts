import { providerBaseUrlAllowsLocalNetwork } from './copilot-provider.policy';
import type { ChatToolDefinition } from '@office/contracts/chat';

export type ChatExecutionMode = 'lean' | 'full';

/** Core Copilot-shaped tools never dropped while capping when they are candidates. */
const LEAN_CORE_TOOL_NAMES = ['web_search', 'view', 'glob', 'grep', 'create', 'edit'] as const;

/** Append order after core while capping (drop order is the reverse). */
const LEAN_APPEND_TOOL_NAMES = [
  'apply_markdown_note',
  'web_fetch',
  'knowledge_search',
  'memory_search',
  'memory_remember',
  'memory_update',
  'memory_forget',
  'delete',
  'move',
  'open_path',
  'open_in_code',
  'calendar_list',
  'todo_write',
  'action_run',
  'schedule_run',
  'generate_image',
] as const;

const WEB_INTENT = /\b(search\s+(?:the\s+)?(?:web|internet|online)|look(?:\s+it)?\s*up|google|bing|duckduckgo|news|headline|latest|current|online|on the web|internet|who won|stock price|weather|what happened)\b/i;
const WEB_CONTINUE = /^(go on|continue|retry|try again|now|ok+|okay|please|yes|again|go ahead)[.!?]*$/i;

/** Soft ceiling so small local models are not flooded with schemas. */
export const LEAN_TOOL_CATALOG_LIMIT = 20;

/** Max tool round-trips in one lean turn before the run stops with a clear message. */
export const LEAN_MAX_TOOL_ROUNDS = 8;

export function isLocalChatEndpoint(input: { providerId?: string; baseUrl?: string }): boolean {
  if (input.providerId === 'managed-local') return true;
  return providerBaseUrlAllowsLocalNetwork(input.baseUrl);
}

/**
 * Cloud always uses the full Copilot harness. Local defaults to lean unless the
 * per-model Full harness preference is on.
 */
export function resolveChatExecutionMode(input: {
  providerId?: string;
  baseUrl?: string;
  fullHarnessEnabled?: boolean;
}): ChatExecutionMode {
  if (!isLocalChatEndpoint(input)) return 'full';
  return input.fullHarnessEnabled ? 'full' : 'lean';
}

/**
 * Bound AIR tool selection for lean local: request-named tools win first (may
 * exceed the cap), then core six, then the locked append order, then lab
 * gadgets (builtin:lab-*), then remaining tools in stable id order. Core six
 * are never dropped while capping if they remain enabled candidates.
 */
export function selectLeanTools(definitions: readonly ChatToolDefinition[], limit = LEAN_TOOL_CATALOG_LIMIT, request = '', preferredIds: readonly string[] = []): ChatToolDefinition[] {
  if (definitions.length <= limit) return [...definitions];
  const requestedNames = new Set(request.toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? []);
  const requested = definitions.filter((tool) => preferredIds.includes(tool.id) || requestedNames.has(tool.name.toLowerCase()));
  const remaining = definitions.filter((tool) => !requested.includes(tool));
  const byName = new Map(remaining.map((tool) => [tool.name, tool]));
  const picked: ChatToolDefinition[] = [...requested];
  const take = (name: string) => {
    const tool = byName.get(name);
    if (!tool || picked.includes(tool)) return;
    picked.push(tool);
  };
  for (const name of LEAN_CORE_TOOL_NAMES) take(name);
  for (const name of LEAN_APPEND_TOOL_NAMES) take(name);
  // Lab gadgets (builtin:lab-*) before other leftover tools while capping.
  const leftovers = remaining
    .filter((tool) => !picked.includes(tool))
    .sort((a, b) => {
      const aLab = a.id.startsWith('builtin:lab-') ? 0 : 1;
      const bLab = b.id.startsWith('builtin:lab-') ? 0 : 1;
      if (aLab !== bLab) return aLab - bLab;
      return a.id.localeCompare(b.id);
    });
  for (const tool of leftovers) picked.push(tool);
  const coreSet = new Set<string>(LEAN_CORE_TOOL_NAMES);
  // Request-named tools may exceed the soft cap; core tools still stay available.
  if (requested.length >= limit) {
    const missingCore = remaining.filter((tool) => coreSet.has(tool.name) && !requested.includes(tool));
    return [...requested, ...missingCore];
  }
  const head = picked.filter((tool) => requested.includes(tool) || coreSet.has(tool.name));
  const tail = picked.filter((tool) => !head.includes(tool));
  return [...head, ...tail].slice(0, Math.max(limit, requested.length));
}

function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  const firstPart: unknown = Array.isArray(content) ? content[0] : undefined;
  return firstPart && typeof firstPart === 'object' && 'type' in firstPart && firstPart.type === 'text' && 'text' in firstPart && typeof firstPart.text === 'string' && !firstPart.text.startsWith('Attached file: ')
    ? firstPart.text
    : '';
}

function conversationNeedsWebSearch(
  messages: readonly { role: string; content?: unknown; tool_calls?: readonly { function: { name: string } }[] }[],
  lastUserIndex: number
): boolean {
  for (let index = lastUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    const earlier = userText(message.content).trim();
    if (!earlier || earlier.startsWith('Attached file: ') || !WEB_INTENT.test(earlier)) continue;
    const after = messages.slice(index + 1, lastUserIndex);
    const searched = after.some((item) => item.role === 'assistant' && item.tool_calls?.some((call) => call.function.name === 'web_search'));
    const succeeded = after.some((item) => item.role === 'tool' && typeof item.content === 'string' && /"results"\s*:/.test(item.content) && !/could not complete/i.test(item.content));
    if (searched && !succeeded) return true;
    if (!searched) return true;
    return false;
  }
  return false;
}

/** Force web_search on clear online-info requests so small models cannot invent results. */
export function leanToolChoice(
  messages: readonly { role: string; content?: unknown; tool_calls?: readonly { function: { name: string } }[] }[],
  tools: readonly ChatToolDefinition[]
): 'auto' | { type: 'function'; function: { name: 'web_search' } } {
  if (!tools.some((tool) => tool.name === 'web_search')) return 'auto';
  let lastUserIndex = messages.length - 1;
  while (lastUserIndex >= 0 && messages[lastUserIndex]?.role !== 'user') lastUserIndex -= 1;
  const text = userText(messages[lastUserIndex]?.content).trim();
  if (!text || text.startsWith('Attached file: ')) return 'auto';
  const forceContinuation = WEB_CONTINUE.test(text) && conversationNeedsWebSearch(messages, lastUserIndex);
  if (!WEB_INTENT.test(text) && !forceContinuation) return 'auto';
  if (messages.slice(lastUserIndex + 1).some((message) => message.role === 'assistant' && message.tool_calls?.some((call) => call.function.name === 'web_search'))) return 'auto';
  return { type: 'function', function: { name: 'web_search' } };
}

export const LEAN_LOCAL_SYSTEM_NOTE = [
  'You are running in AIR Office lean local mode for a private on-device model.',
  'Copilot first-party shell and MCP servers are not available on this path.',
  'Use view, create (file_text), edit (old_str/new_str), delete, move, glob, and grep for vault and connected-root files.',
  'Office chat working directory is the AIR vault. Pass vault-relative paths only (for example programs/general/notes/example.md). Never invent absolute OS paths or legacy private/files or session-state paths.',
  'Use apply_markdown_note for note Markdown projection apply. Use open_path to show a file on the stage. Use schedule_run and action_run with vault paths.',
  'Use knowledge_search for indexed collections, calendar_list for upcoming vault calendar events, and todo_write for multi-step checklists (mark items complete as you go).',
  'AIR tools in this request remain available. For public web facts, you must call web_search and only then cite its returned titles, URLs, and snippets.',
  'After web_search, use web_fetch to open a page before quoting its content. Never invent search results, headlines, URLs, or page text without tool results in this turn.',
  'If a task needs unavailable tools or exceeds what you can do, say clearly what could not be done.',
  'Never claim a tool ran when it did not.'
].join(' ');
