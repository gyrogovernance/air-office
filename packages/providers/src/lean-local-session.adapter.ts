import { CHAT_PROTOCOL_VERSION, type ChatEventEnvelope, type ChatEventPayloadMap, type ChatEventType, type ChatToolDefinition, type ProviderHarnessHooks, type ProviderRunRequest, type ProviderSkillDefinition } from '@office/contracts/chat';
import { classifyProviderFailure } from './provider-failure.adapter';
import { LEAN_LOCAL_SYSTEM_NOTE, LEAN_MAX_TOOL_ROUNDS, leanToolChoice, selectLeanTools } from './lean-local.policy';
import { leanOpenDocumentContext } from './open-document-context.policy';

export type LeanLocalSessionOptions = {
  runId: string;
  model: string;
  baseUrl: string;
  apiKey?: string | null;
  bearer?: boolean;
  headers?: Record<string, string>;
  messages: ProviderRunRequest['messages'];
  context?: ProviderRunRequest['context'];
  initialContent?: string;
  settings?: ProviderRunRequest['settings'];
  toolDefinitions?: ChatToolDefinition[];
  preferredToolIds?: string[];
  harness?: ProviderHarnessHooks;
  skills?: ProviderSkillDefinition[];
  signal?: AbortSignal;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type OpenAiMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string | null; tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

type StreamedToolCall = { id: string; name: string; arguments: string };

function envelopeFactory(runId: string) {
  let sequence = 0;
  return <T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T]): ChatEventEnvelope<T> => ({
    protocolVersion: CHAT_PROTOCOL_VERSION,
    eventId: `${runId}:${sequence}`,
    runId,
    correlationId: runId,
    sequence: sequence++,
    timestamp: new Date().toISOString(),
    type,
    payload
  });
}

function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return /\/v1$/i.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

function decodeAttachmentText(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function buildContextBlocks(options: LeanLocalSessionOptions): string[] {
  const blocks: string[] = [];
  if (options.context?.selection) blocks.push(`Workspace selection, supplied as reference material:\n${options.context.selection}`);
  {
    const openDoc = leanOpenDocumentContext({
      selection: options.context?.selection,
      fileName: options.context?.fileName,
      fileId: options.context?.fileId,
      workspaceFilePath: options.context?.workspaceFilePath
    });
    if (openDoc) blocks.push(openDoc);
  }
  if (options.context?.sources?.length) {
    blocks.push(`Retrieved source excerpts, supplied as reference material. Cite excerpts with [source](#cite-sourceVersionId).\n${JSON.stringify(options.context.sources)}`);
  }
  if (options.initialContent?.trim()) blocks.push(`Continue the incomplete assistant response. Existing text:\n${options.initialContent}`);
  return blocks;
}

function toOpenAiMessages(options: LeanLocalSessionOptions, tools: ChatToolDefinition[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: LEAN_LOCAL_SYSTEM_NOTE }];
  if (tools.length) {
    out.push({
      role: 'system',
      content: `Available AIR tools for this turn: ${tools.map((tool) => tool.name).join(', ')}.`
    });
  }
  for (const skill of options.skills ?? []) {
    const body = skill.instructions.trim();
    if (!body) continue;
    out.push({
      role: 'system',
      content: `Skill "${skill.name}"${skill.description ? ` — ${skill.description}` : ''}:\n${body}`
    });
  }
  for (const block of buildContextBlocks(options)) out.push({ role: 'system', content: block });

  for (const message of options.messages) {
    if (message.role === 'system') {
      const content = message.content.trim();
      if (content) out.push({ role: 'system', content });
      continue;
    }
    if (message.role === 'assistant') {
      out.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (message.role === 'assistant-tool-calls') {
      out.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.calls.map((call) => ({
          id: call.toolCallId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }
        }))
      });
      continue;
    }
    if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
      continue;
    }
    if (message.role === 'user') {
      const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
      if (message.content.trim()) parts.push({ type: 'text', text: message.content });
      for (const attachment of message.attachments ?? []) {
        if (!attachment.data) throw new Error(`The attachment ${attachment.label} is unavailable.`);
        if (attachment.mediaType.startsWith('image/')) {
          parts.push({ type: 'image_url', image_url: { url: `data:${attachment.mediaType};base64,${attachment.data}` } });
        } else if (attachment.mediaType.startsWith('text/') || ['application/json', 'application/xml'].includes(attachment.mediaType)) {
          parts.push({ type: 'text', text: `Attached file: ${attachment.label}\n${decodeAttachmentText(attachment.data)}` });
        } else {
          throw new Error(`The attachment ${attachment.label} (${attachment.mediaType}) cannot be sent on the lean local path.`);
        }
      }
      if (parts.length === 1 && parts[0]?.type === 'text') out.push({ role: 'user', content: parts[0].text });
      else if (parts.length) out.push({ role: 'user', content: parts });
    }
  }
  return out;
}

function openAiTools(definitions: ChatToolDefinition[]) {
  return definitions.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} }
    }
  }));
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { raw };
  }
}

async function* readSseLines(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) yield line;
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

type CompletionStreamResult = {
  text: string;
  toolCalls: StreamedToolCall[];
  finishReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
};

async function* streamCompletion(
  options: LeanLocalSessionOptions,
  messages: OpenAiMessage[],
  tools: ChatToolDefinition[],
  emit: <T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T]) => ChatEventEnvelope<T>
): AsyncGenerator<ChatEventEnvelope, CompletionStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...options.headers
  };
  const secret = options.apiKey?.trim();
  if (secret) headers.authorization = options.bearer ? `Bearer ${secret}` : `Bearer ${secret}`;

  const body = {
    model: options.model,
    stream: true,
    messages,
    ...(tools.length ? { tools: openAiTools(tools), tool_choice: leanToolChoice(messages, tools) } : {}),
    ...(options.settings?.temperature !== undefined ? { temperature: options.settings.temperature } : {}),
    ...(options.settings?.maxOutputTokens !== undefined ? { max_tokens: options.settings.maxOutputTokens } : {}),
    stream_options: { include_usage: true }
  };

  let response: Response;
  try {
    response = await fetchImpl(completionsUrl(options.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal
    });
  } catch (error) {
    if (options.signal?.aborted) {
      yield emit('completion', { reason: 'cancelled' });
      return { text: '', toolCalls: [], finishReason: 'cancelled' };
    }
    const failure = classifyProviderFailure(error, true);
    yield emit('failure', { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.status !== undefined ? { status: failure.status } : {}) });
    return { text: '', toolCalls: [], finishReason: 'error' };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const failure = classifyProviderFailure(new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ''}`), true, response.status);
    yield emit('failure', { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.status !== undefined ? { status: failure.status } : {}) });
    return { text: '', toolCalls: [], finishReason: 'error' };
  }

  if (!response.body) {
    yield emit('failure', { code: 'protocol', message: 'The provider returned an empty stream.', retryable: false });
    return { text: '', toolCalls: [], finishReason: 'error' };
  }

  const messageId = `${options.runId}:message`;
  let text = '';
  const toolCalls = new Map<number, StreamedToolCall>();
  let finishReason: string | null = null;
  let usage: CompletionStreamResult['usage'];
  let emittedFailure = false;

  for await (const line of readSseLines(response.body, options.signal)) {
    if (options.signal?.aborted) {
      yield emit('completion', { reason: 'cancelled' });
      return { text, toolCalls: [...toolCalls.values()], finishReason: 'cancelled' };
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const chunk = parsed as {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (chunk.error?.message) {
      emittedFailure = true;
      const failure = classifyProviderFailure(new Error(chunk.error.message), true);
      yield emit('failure', { code: failure.code, message: failure.message, retryable: failure.retryable });
      return { text, toolCalls: [...toolCalls.values()], finishReason: 'error' };
    }
    const choice = chunk.choices?.[0];
    const deltaText = choice?.delta?.content;
    if (typeof deltaText === 'string' && deltaText) {
      text += deltaText;
      yield emit('text-delta', { messageId, text: deltaText });
    }
    for (const call of choice?.delta?.tool_calls ?? []) {
      const index = typeof call.index === 'number' ? call.index : 0;
      const current = toolCalls.get(index) ?? { id: call.id ?? `${options.runId}:tool:${index}`, name: '', arguments: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name = call.function.name;
      if (call.function?.arguments) {
        current.arguments += call.function.arguments;
        yield emit('tool-arguments-fragment', { toolCallId: current.id, name: current.name || 'tool', argumentsDelta: call.function.arguments });
      }
      toolCalls.set(index, current);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) {
      usage = {
        inputTokens: Number(chunk.usage.prompt_tokens ?? 0),
        outputTokens: Number(chunk.usage.completion_tokens ?? 0)
      };
    }
  }

  if (emittedFailure) return { text, toolCalls: [...toolCalls.values()], finishReason: 'error' };
  if (text) yield emit('message-complete', { messageId, text });
  if (usage) yield emit('usage', usage);
  return { text, toolCalls: [...toolCalls.values()].filter((call) => call.name), finishReason };
}

async function invokeTool(
  harness: ProviderHarnessHooks | undefined,
  tools: ChatToolDefinition[],
  call: StreamedToolCall,
  emit: <T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T]) => ChatEventEnvelope<T>,
  signal?: AbortSignal
): Promise<{ events: ChatEventEnvelope[]; content: string }> {
  const events: ChatEventEnvelope[] = [];
  const args = parseArguments(call.arguments);
  const definition = tools.find((tool) => tool.name === call.name);
  const approvalRequired = harness?.gatedToolNames.has(call.name) ?? false;
  events.push(emit('tool-request', { toolCallId: call.id, name: call.name, arguments: args, approvalRequired }));
  if (!harness || !definition) {
    const message = definition
      ? 'Tool execution is unavailable for this run.'
      : `The tool "${call.name}" is not available in lean local mode.`;
    events.push(emit('tool-result', { toolCallId: call.id, status: 'error', message }));
    return { events, content: message };
  }
  if (approvalRequired) {
    const approved = await harness.approveTool({ toolCallId: call.id, name: call.name, arguments: args }, signal);
    if (!approved) {
      const message = 'The requested operation was not approved.';
      events.push(emit('tool-result', { toolCallId: call.id, status: 'error', message }));
      return { events, content: message };
    }
  }
  const result = await harness.invokeTool({ toolId: definition.id, name: call.name, toolCallId: call.id, arguments: args }, signal);
  events.push(emit('tool-result', { toolCallId: call.id, ...result }));
  const content = result.status === 'ok'
    ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? null))
    : (result.message ?? 'The tool could not complete.');
  return { events, content };
}

/**
 * Direct OpenAI-compatible chat/completions path for privacy-default local models.
 * Reuses AIR harness hooks for approvals and tool bodies; never starts Copilot.
 */
export async function* runLeanLocalSession(options: LeanLocalSessionOptions): AsyncIterable<ChatEventEnvelope> {
  const emit = envelopeFactory(options.runId);
  const request = [...options.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const catalog = options.toolDefinitions ?? [];
  const tools = selectLeanTools(catalog, undefined, request, options.preferredToolIds);
  const discoveryName = 'air_find_tools';
  const discoveryEnabled = tools.length < catalog.length && !catalog.some((tool) => tool.name === discoveryName);
  if (discoveryEnabled) {
    tools.push({ id: 'air:find-tools', name: discoveryName, description: 'Find additional enabled AIR tools by task or name before saying a tool is unavailable.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What you want the tool to do.' } }, required: ['query'], additionalProperties: false } });
  }
  const messages = toOpenAiMessages(options, tools);
  let rounds = 0;

  try {
    for (;;) {
      if (options.signal?.aborted) {
        yield emit('completion', { reason: 'cancelled' });
        return;
      }
      const result = yield* streamCompletion(options, messages, tools, emit);
      if (result.finishReason === 'cancelled' || result.finishReason === 'error') return;

      if (!result.toolCalls.length) {
        yield emit('completion', { reason: result.finishReason === 'length' ? 'length' : 'stop' });
        return;
      }

      rounds += 1;
      if (rounds > LEAN_MAX_TOOL_ROUNDS) {
        yield emit('failure', {
          code: 'protocol',
          message: `Lean local mode stopped after ${LEAN_MAX_TOOL_ROUNDS} tool rounds. Simplify the request or enable Full harness for this model.`,
          retryable: false
        });
        return;
      }

      messages.push({
        role: 'assistant',
        content: result.text || null,
        tool_calls: result.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' }
        }))
      });

      // Memory writes before memory_search (and other tools) when the model
      // batches them in one turn — otherwise parallel search can miss a just-written fact.
      const memoryWrites = new Set(['memory_remember', 'memory_update', 'memory_forget']);
      const orderedCalls = [
        ...result.toolCalls.filter((call) => memoryWrites.has(call.name)),
        ...result.toolCalls.filter((call) => !memoryWrites.has(call.name)),
      ];
      for (const call of orderedCalls) {
        if (call.name === discoveryName && discoveryEnabled) {
          const query = parseArguments(call.arguments).query;
          const words = typeof query === 'string' ? query.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? [] : [];
          const matches = catalog.filter((tool) => !tools.some((active) => active.id === tool.id)).map((tool) => {
            const text = `${tool.name.replaceAll('_', ' ')} ${tool.description}`.toLowerCase();
            return { tool, score: words.reduce((sum, word) => sum + Number(text.includes(word)), 0) };
          }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 3).map((item) => item.tool);
          tools.push(...matches);
          messages.push({ role: 'tool', tool_call_id: call.id, content: matches.length ? `Available tools: ${matches.map((tool) => tool.name).join(', ')}. Their definitions are now available.` : 'No matching enabled tools found.' });
          continue;
        }
        const invoked = await invokeTool(options.harness, tools, call, emit, options.signal);
        for (const event of invoked.events) yield event;
        messages.push({ role: 'tool', tool_call_id: call.id, content: invoked.content });
      }
    }
  } catch (error) {
    if (options.signal?.aborted) {
      yield emit('completion', { reason: 'cancelled' });
      return;
    }
    const failure = classifyProviderFailure(error, true);
    yield emit('failure', { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.status !== undefined ? { status: failure.status } : {}) });
  }
}

/** Test helper: build the OpenAI message list without calling the network. */
export function leanLocalMessagesForTest(options: LeanLocalSessionOptions, tools?: ChatToolDefinition[]): OpenAiMessage[] {
  return toOpenAiMessages(options, tools ?? selectLeanTools(options.toolDefinitions ?? []));
}
