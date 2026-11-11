import { CopilotClient, ToolSet } from '@github/copilot-sdk';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import type { PermissionRequest, ProviderConfig, SessionEvent, SkillProvider, Tool } from '@github/copilot-sdk';
import type { CopilotSession } from '@github/copilot-sdk';
import type { ChatEventEnvelope, ChatToolDefinition, ProviderCustomAgentDefinition, ProviderHarnessHooks, ProviderMcpServerConfig, ProviderRunRequest, ProviderSessionLimits, ProviderSkillDefinition } from '@office/contracts/chat';
import { createChatEnvelopeFactory, mapCopilotSessionEvent } from './copilot-event.adapter';
import { toCopilotMcpServers } from './copilot-mcp.adapter';
import { classifyProviderFailure } from './provider-failure.adapter';
import { copilotSandboxNetworkPolicy, copilotToolSearchConfig, providerBaseUrlAllowsLocalNetwork } from './copilot-provider.policy';
import { copilotOpenDocumentContext } from './open-document-context.policy';
import { requestCopilotElicitation } from './copilot-elicitation.adapter';
import { ChatGptPlanRequestHandler } from './chatgpt-request.adapter';

const chatgptRequestHandler = new ChatGptPlanRequestHandler();

export interface CopilotSessionRunOptions {
  runId: string;
  model: string;
  provider: ProviderConfig;
  /** AIR connection id; live sessions must not reuse a handle when this or the model changes. */
  connectionId: string;
  messages: ProviderRunRequest['messages'];
  context?: ProviderRunRequest['context'];
  initialContent?: string;
  /** Stable conversation id used as the Copilot session key for resume across turns. */
  conversationId?: string;
  sessionScope?: string;
  workspaceRoots?: string[];
  /** Prior Copilot session id to resume (length-continue or interruption recovery). */
  resumeSessionId?: string;
  toolDefinitions?: ChatToolDefinition[];
  mcpServers?: Record<string, ProviderMcpServerConfig>;
  harness?: ProviderHarnessHooks;
  signal?: AbortSignal;
  workingDirectory?: string;
  baseDirectory: string;
  outputSchema?: ProviderRunRequest['outputSchema'];
  skills?: ProviderSkillDefinition[];
  customAgents?: ProviderCustomAgentDefinition[];
  sessionLimits?: ProviderSessionLimits;
  /** When allow-all, in-policy tool and web requests proceed without an approval dialog. */
  commandPermission?: 'ask' | 'allow-all';
  /** Responses reasoning effort for models that advertise supported levels. */
  reasoningEffort?: import('@office/contracts/chat').ChatReasoningEffort;
  /**
   * ChatGPT plan OAuth (Sign in with ChatGPT). That route rejects Responses
   * `tool_search`, several request fields, and hosted tools that API-key BYOK allows.
   */
  chatgptPlanUsage?: boolean;
}

/** Local model loads and long tool loops need more than the SDK's 60s default wait. */
const SEND_WAIT_MS = 15 * 60 * 1000;

type QueueItem = { kind: 'event'; event: ChatEventEnvelope } | { kind: 'close' } | { kind: 'error'; error: unknown };

class EventQueue {
  private readonly items: QueueItem[] = [];
  private readonly waiters: Array<(item: QueueItem) => void> = [];
  private closed = false;

  push(item: QueueItem) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close() {
    if (this.closed) return;
    this.push({ kind: 'close' });
    this.closed = true;
  }

  fail(error: unknown) {
    this.push({ kind: 'error', error });
    this.close();
  }

  async *events(): AsyncGenerator<ChatEventEnvelope> {
    for (;;) {
      const item = this.items.shift() ?? await new Promise<QueueItem>((resolve) => this.waiters.push(resolve));
      if (item.kind === 'close') return;
      if (item.kind === 'error') throw item.error;
      yield item.event;
    }
  }
}

type TurnState = {
  runId: string;
  harness?: ProviderHarnessHooks;
  signal?: AbortSignal;
  emit: (event: ChatEventEnvelope) => void;
  emittedToolRequests: Set<string>;
  customToolCalls: Set<string>;
  completedToolCalls: Set<string>;
  startedTools: Map<string, { name: string; arguments: Record<string, unknown> }>;
};

type LiveSession = {
  key: string;
  session: CopilotSession;
};

/** Live-session identity: same chat may switch cloud/local; compare columns must not share a handle. */
export function liveSessionKey(conversationId: string | undefined, connectionId: string, model: string, runId: string, sessionScope?: string): string {
  const conversation = conversationId?.trim() || runId;
  return JSON.stringify([conversation, connectionId, model, sessionScope ?? null]);
}

function copilotSessionId(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

let sharedClient: CopilotClient | undefined;
let sharedClientDirectory: string | undefined;
let sharedClientStart: Promise<CopilotClient> | undefined;
const liveSessions = new Map<string, LiveSession>();
const sessionTurns = new Map<string, Promise<void>>();
type SteerableRun = {
  session: CopilotSession;
  key: string;
  tools: Tool[];
  replaceCustomTools: (definitions: ChatToolDefinition[]) => Promise<void>;
};

/** Run-scoped steerable handles while sendAndWait is in flight. */
const steerableRuns = new Map<string, SteerableRun>();

function buildSkillProvider(skills: ProviderSkillDefinition[] | undefined): SkillProvider | undefined {
  if (!skills?.length) return undefined;
  const byName = new Map<string, ProviderSkillDefinition>();
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    byName.set(key, skill);
  }
  if (!byName.size) return undefined;
  const catalog = [...byName.values()];
  return {
    listSkills: () => catalog.map((skill) => ({
      name: skill.name,
      description: skill.description,
      ...(skill.directory ? { directory: skill.directory } : {})
    })),
    readSkill: (name) => {
      const skill = byName.get(name.trim().toLowerCase());
      return skill?.instructions ?? null;
    }
  };
}

/**
 * Redirects a live Copilot turn with an immediate steering prompt.
 * Returns false when no steerable session is bound to the run.
 */
export async function steerCopilotRun(runId: string, prompt: string): Promise<boolean> {
  const entry = steerableRuns.get(runId);
  const text = prompt.trim();
  if (!entry || !text) return false;
  await entry.session.send({ prompt: text, mode: 'immediate' });
  return true;
}

/**
 * Replaces AIR custom tools on a live steerable run. Resume already refreshes
 * tools between turns; this covers mid-turn composer tool changes.
 */
export async function replaceCopilotRunCustomTools(runId: string, definitions: ChatToolDefinition[]): Promise<boolean> {
  const entry = steerableRuns.get(runId);
  if (!entry) return false;
  await entry.replaceCustomTools(definitions);
  return true;
}

export function isCopilotRunSteerable(runId: string): boolean {
  return steerableRuns.has(runId);
}

async function serializeSessionTurn(key: string, signal: AbortSignal, work: () => Promise<void>): Promise<boolean> {
  const previous = sessionTurns.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  sessionTurns.set(key, tail);
  void tail.finally(() => { if (sessionTurns.get(key) === tail) sessionTurns.delete(key); });
  let cancelWait: (() => void) | undefined;
  try {
    const ready = await Promise.race([
      previous.then(() => true),
      new Promise<false>((resolve) => {
        cancelWait = () => resolve(false);
        signal.addEventListener('abort', cancelWait, { once: true });
        if (signal.aborted) cancelWait();
      })
    ]);
    if (!ready || signal.aborted) return false;
    await work();
    return true;
  } finally {
    if (cancelWait) signal.removeEventListener('abort', cancelWait);
    release();
  }
}

async function sharedCopilotClient(baseDirectory: string): Promise<CopilotClient> {
  if (sharedClient && sharedClientDirectory === baseDirectory) return sharedClient;
  if (sharedClientStart && sharedClientDirectory === baseDirectory) return sharedClientStart;
  if (sharedClient) {
    await disposeLiveSessions();
    try { await sharedClient.stop(); } catch { /* replace the prior process */ }
    sharedClient = undefined;
  }
  sharedClientDirectory = baseDirectory;
  sharedClientStart = (async () => {
    const client = new CopilotClient({
      mode: 'copilot-cli',
      baseDirectory,
      requestHandler: chatgptRequestHandler,
      clientInfo: { applicationName: 'air-office' }
    });
    try {
      await client.start();
      sharedClient = client;
      return client;
    } finally {
      sharedClientStart = undefined;
    }
  })();
  return sharedClientStart;
}

async function disposeLiveSessions(): Promise<void> {
  const sessions = [...liveSessions.values()];
  liveSessions.clear();
  chatgptRequestHandler.clear();
  steerableRuns.clear();
  await Promise.all(sessions.map(async (live) => {
    try { await live.session.disconnect(); } catch { /* already closed */ }
  }));
}

/** Stops the process-wide Copilot CLI when the AIR service shuts down. */
export async function stopSharedCopilotClient(): Promise<void> {
  const client = sharedClient;
  sharedClient = undefined;
  sharedClientDirectory = undefined;
  sharedClientStart = undefined;
  await disposeLiveSessions();
  if (client) await client.stop();
}

function asObjectArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { value };
    }
  }
  return value === undefined ? {} : { value };
}

function permissionToolName(request: PermissionRequest): string {
  if (request.kind === 'custom-tool' || request.kind === 'mcp' || request.kind === 'hook') return request.toolName;
  return request.kind;
}

function permissionArguments(request: PermissionRequest): Record<string, unknown> {
  switch (request.kind) {
    case 'shell':
      return {
        command: request.fullCommandText,
        intention: request.intention,
        possiblePaths: request.possiblePaths,
        hasWriteFileRedirection: request.hasWriteFileRedirection,
        ...(request.requestSandboxBypass ? { requestSandboxBypass: true, requestSandboxBypassReason: request.requestSandboxBypassReason } : {})
      };
    case 'write':
      return { fileName: request.fileName, diff: request.diff, intention: request.intention, ...(request.fileEdits ? { paths: request.fileEdits.map((edit) => ({ before: edit.before?.path, after: edit.after?.path })) } : {}) };
    case 'read':
      return { path: request.path, intention: request.intention };
    case 'url':
      return {
        url: request.url,
        intention: request.intention,
        ...(request.requestSandboxBypass ? { requestSandboxBypass: true, requestSandboxBypassReason: request.requestSandboxBypassReason } : {})
      };
    case 'mcp':
      return asObjectArguments(request.args);
    case 'custom-tool':
      return asObjectArguments(request.args);
    case 'memory':
      return {
        fact: request.fact,
        ...(request.action ? { action: request.action } : {}),
        ...(request.scope ? { scope: request.scope } : {}),
        ...(request.direction ? { direction: request.direction } : {})
      };
    default:
      return { kind: request.kind };
  }
}

function buildPrompt(options: CopilotSessionRunOptions, resumed: boolean): { prompt: string; attachments: Array<{ type: 'blob'; data: string; mimeType: string; displayName?: string }> } {
  const context: string[] = [];
  const history: string[] = [];
  const attachments: Array<{ type: 'blob'; data: string; mimeType: string; displayName?: string }> = [];
  for (const message of options.messages) {
    if (message.role === 'system') {
      continue;
    }
    if (message.role === 'user') history.push(`User:\n${message.content}`);
    else if (message.role === 'assistant') history.push(`Assistant:\n${message.content}`);
    else if (message.role === 'assistant-tool-calls') {
      history.push(`Assistant:\n${message.content}\nTool calls:\n${JSON.stringify(message.calls)}`);
    } else if (message.role === 'tool') {
      history.push(`Tool result (${message.toolCallId}):\n${message.content}`);
    }
  }
  if (options.context?.selection) context.push(`Workspace selection, supplied as reference material:\n${options.context.selection}`);
  {
    const openDoc = copilotOpenDocumentContext({
      selection: options.context?.selection,
      fileName: options.context?.fileName,
      fileId: options.context?.fileId,
      workspaceFilePath: options.context?.workspaceFilePath
    });
    if (openDoc) context.push(openDoc);
  }
  if (options.context?.sources?.length) {
    context.push(`Retrieved source excerpts, supplied as reference material. Cite excerpts with [source](#cite-sourceVersionId), replacing sourceVersionId with the exact supplied ID. Retain chunkId when identifying an excerpt. Unresolved locations are unverified.\n${JSON.stringify(options.context.sources)}`);
  }
  if (options.initialContent?.trim()) context.push(`Continue the incomplete assistant response. Existing text:\n${options.initialContent}`);

  const lastUser = [...options.messages].reverse().find((message) => message.role === 'user');
  // Resumed Copilot sessions already hold prior turns; send only the new user turn (or length-continue cue).
  const prompt = resumed
    ? (lastUser?.content?.trim() || (options.initialContent?.trim() ? 'Continue.' : 'Continue.'))
    : (() => {
      const promptTurns = lastUser ? history.slice(0, -1) : history;
      return lastUser
        ? (promptTurns.length ? `${promptTurns.join('\n\n')}\n\nUser:\n${lastUser.content}` : lastUser.content)
        : (history.join('\n\n') || 'Continue.');
    })();
  const attachmentMessages = options.messages.filter((message) => message.role === 'user' && (!resumed || message === lastUser));
  for (const message of attachmentMessages) {
    if (message.role !== 'user') continue;
    for (const attachment of message.attachments ?? []) {
      if (!attachment.data) throw new Error(`The attachment ${attachment.label} is unavailable.`);
      if (attachment.mediaType.startsWith('image/')) {
        attachments.push({ type: 'blob', data: attachment.data, mimeType: attachment.mediaType, displayName: attachment.label });
      } else if (attachment.mediaType.startsWith('text/') || ['application/json', 'application/xml'].includes(attachment.mediaType)) {
        const binary = atob(attachment.data);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        context.push(`Attached file: ${attachment.label}\n${new TextDecoder().decode(bytes)}`);
      } else {
        throw new Error(`The attachment ${attachment.label} (${attachment.mediaType}) cannot be sent to this Copilot session.`);
      }
    }
  }
  return { prompt: context.length ? `Current reference context:\n${context.join('\n\n')}\n\nCurrent request:\n${prompt}` : prompt, attachments };
}

function pushMapped(emit: (event: ChatEventEnvelope) => void, mapped: ChatEventEnvelope | ChatEventEnvelope[] | null) {
  if (!mapped) return;
  if (Array.isArray(mapped)) {
    for (const item of mapped) emit(item);
    return;
  }
  emit(mapped);
}

function sessionDisplayName(conversationId: string | undefined): string | undefined {
  if (!conversationId) return undefined;
  const trimmed = `air:${conversationId}`.replace(/[\u0000-\u001f\u007f"]/g, '').slice(0, 100).trim();
  return trimmed.trim().length ? trimmed : undefined;
}

/** True when the Copilot CLI dropped or replaced the session during a wait. */
export function isCopilotSessionLoss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session (is )?disconnected|closed or replaced|replaced while waiting|no session host/i.test(message);
}

/**
 * Names Copilot already owns on the full harness. AIR still registers lean
 * substitutes for the lean local path; on Copilot sessions those substitutes
 * stay out so first-party file/shell/fetch tools run instead.
 * web_search stays an AIR custom tool because BYOK sessions do not ship it.
 */
const COPILOT_FIRST_PARTY_OWNED_NAMES = new Set([
  'view',
  'create',
  'edit',
  'glob',
  'grep',
  'bash',
  'powershell',
  'apply_patch',
  'web_fetch',
]);

function buildTools(turn: TurnState, definitions: ChatToolDefinition[] | undefined): Tool[] {
  return (definitions ?? []).filter((definition) => !COPILOT_FIRST_PARTY_OWNED_NAMES.has(definition.name)).map((definition) => {
    const gated = () => turn.harness?.gatedToolNames.has(definition.name) ?? false;
    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema as Record<string, unknown>,
      skipPermission: !gated(),
      handler: async (args, invocation) => {
        const toolCallId = invocation.toolCallId;
        turn.customToolCalls.add(toolCallId);
        const toolArguments = asObjectArguments(args ?? invocation.arguments);
        const envelope = createChatEnvelopeFactory(turn.runId);
        if (!turn.emittedToolRequests.has(toolCallId)) {
          turn.emittedToolRequests.add(toolCallId);
          turn.emit(envelope('tool-request', { toolCallId, name: definition.name, arguments: toolArguments }));
        }
        if (!turn.harness) {
          const failure = envelope('tool-result', { toolCallId, status: 'error', message: 'Tool execution is unavailable for this run.' });
          turn.completedToolCalls.add(toolCallId);
          turn.emit(failure);
          return { error: 'Tool execution is unavailable for this run.' };
        }
        const signals = [turn.signal, invocation.signal].filter((item): item is AbortSignal => item !== undefined);
        const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
        const result = await turn.harness.invokeTool({ toolId: definition.id, name: definition.name, toolCallId, arguments: toolArguments }, signal);
        turn.completedToolCalls.add(toolCallId);
        turn.emit(envelope('tool-result', { toolCallId, ...result }));
        if (result.status === 'ok') return result.result ?? null;
        return { error: result.message ?? 'The tool could not complete.' };
      }
    };
  });
}

async function canAccessWorkspacePath(path: string, workingDirectory: string | undefined, roots: readonly string[], allowMissing: boolean): Promise<boolean> {
  if (!workingDirectory || !path || path.includes('\0')) return false;
  const requested = resolve(workingDirectory, path);
  for (const root of roots) {
    let canonicalRoot: string;
    try { canonicalRoot = await realpath(root); }
    catch { continue; }
    const within = relative(canonicalRoot, requested);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) continue;
    const parts = within ? within.split(sep) : [];
    if (parts.length > 256 || parts.some((part) => part.toLowerCase() === '.air-office-trash')) return false;
    try {
      let current = canonicalRoot;
      for (const part of parts) {
        current = join(current, part);
        try {
          if ((await lstat(current)).isSymbolicLink()) return false;
        } catch (error) {
          if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') return true;
          return false;
        }
      }
      const canonical = await realpath(requested);
      const canonicalRelative = relative(canonicalRoot, canonical);
      return canonicalRelative !== '..' && !canonicalRelative.startsWith(`..${sep}`) && !isAbsolute(canonicalRelative);
    } catch { return false; }
  }
  return false;
}

function buildPermissionHandler(turn: TurnState, options: CopilotSessionRunOptions, client: CopilotClient) {
  return async (request: PermissionRequest) => {
    const toolName = permissionToolName(request);
    const toolCallId = request.toolCallId ?? `${turn.runId}:${crypto.randomUUID()}`;
    const toolArguments = permissionArguments(request);
    const envelope = createChatEnvelopeFactory(turn.runId);

    if (request.kind === 'shell') {
      let sandboxSupported = false;
      if (!request.requestSandboxBypass) {
        try { sandboxSupported = (await client.rpc.sandbox.getHostSupport()).supported; } catch { /* Refuse commands if containment cannot be established. */ }
      }
      if (!sandboxSupported || turn.signal?.aborted) {
        const message = request.requestSandboxBypass ? 'Running outside the workspace sandbox is unavailable.' : 'The command sandbox is unavailable on this machine. The command was not run.';
        if (!turn.emittedToolRequests.has(toolCallId)) {
          turn.emittedToolRequests.add(toolCallId);
          turn.emit(envelope('tool-request', { toolCallId, name: toolName, arguments: toolArguments }));
        }
        turn.completedToolCalls.add(toolCallId);
        turn.emit(envelope('tool-result', { toolCallId, status: 'error', message }));
        return { kind: 'reject' as const, feedback: message };
      }
    }
    if (request.kind === 'url') {
      // Page opens are granted with Settings → Web search, not mid-run like a
      // Windows UAC prompt. Shell and mutating tools still ask when Ask first.
      let allowed = false;
      try {
        const url = new URL(request.url);
        allowed = !url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname));
      } catch { /* invalid URL */ }
      if (request.requestSandboxBypass && !allowed) {
        return { kind: 'reject' as const, feedback: 'Network access outside the workspace sandbox is unavailable for this URL.' };
      }
      if (!allowed) return { kind: 'reject' as const, feedback: 'Only http(s) page addresses without embedded credentials can be opened.' };
      if (!turn.emittedToolRequests.has(toolCallId)) {
        turn.emittedToolRequests.add(toolCallId);
        turn.emit(envelope('tool-request', { toolCallId, name: toolName, arguments: toolArguments, approvalRequired: false }));
      }
      return { kind: 'approve-once' as const };
    }
    if (request.kind === 'read') {
      const roots = [...(options.workingDirectory ? [options.workingDirectory] : []), ...(options.workspaceRoots ?? [])];
      if (request.requestSandboxBypass || !await canAccessWorkspacePath(request.path, options.workingDirectory, roots, false)) return { kind: 'reject' as const, feedback: 'The requested path is outside the authorized workspace or cannot be verified.' };
      if (!request.managedApprovalRequired) return { kind: 'approve-once' as const };
    }
    if (request.kind === 'write') {
      const roots = [...(options.workingDirectory ? [options.workingDirectory] : []), ...(options.workspaceRoots ?? [])];
      const paths = [request.fileName, ...(request.fileEdits ?? []).flatMap((edit) => [edit.before?.path, edit.after?.path].filter((path): path is string => typeof path === 'string'))];
      if (request.requestSandboxBypass || !(await Promise.all(paths.map((path) => canAccessWorkspacePath(path, options.workingDirectory, roots, true)))).every(Boolean)) return { kind: 'reject' as const, feedback: 'The requested write is outside the authorized workspace or cannot be verified.' };
    }
    if (!turn.harness) {
      return { kind: 'reject' as const, feedback: 'Permission approval is unavailable for this run.' };
    }
    const approvalRequired = options.commandPermission !== 'allow-all' && (request.kind !== 'custom-tool' || (turn.harness?.gatedToolNames.has(request.toolName) ?? false));
    if (approvalRequired || !turn.emittedToolRequests.has(toolCallId)) {
      turn.emittedToolRequests.add(toolCallId);
      turn.emit(envelope('tool-request', { toolCallId, name: toolName, arguments: toolArguments, approvalRequired }));
    }

    if (request.kind === 'custom-tool') {
      if (!turn.harness?.gatedToolNames.has(request.toolName)) return { kind: 'approve-once' as const };
      const approved = await turn.harness.approveTool({ toolCallId, name: request.toolName, arguments: toolArguments }, turn.signal);
      if (!approved) {
        turn.completedToolCalls.add(toolCallId);
        turn.emit(envelope('tool-result', { toolCallId, status: 'error', message: 'The requested operation was not approved.' }));
        return { kind: 'reject' as const, feedback: 'The requested operation was not approved.' };
      }
      return { kind: 'approve-once' as const, approvedInteractively: true };
    }

    const approved = await turn.harness.approveTool({ toolCallId, name: toolName, arguments: toolArguments }, turn.signal);
    if (!approved) {
      turn.completedToolCalls.add(toolCallId);
      turn.emit(envelope('tool-result', { toolCallId, status: 'error', message: 'The requested operation was not approved.' }));
      return { kind: 'reject' as const, feedback: 'The requested operation was not approved.' };
    }
    return { kind: 'approve-once' as const, approvedInteractively: true };
  };
}

function localAiOffMessage(signal?: AbortSignal): string | null {
  const reason = signal?.reason;
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  return /local ai/i.test(message) ? (message || 'Local AI is unavailable.') : null;
}

function emitTurnAbort(emit: (event: ChatEventEnvelope) => void, envelope: ReturnType<typeof createChatEnvelopeFactory>, signal?: AbortSignal): void {
  const off = localAiOffMessage(signal);
  if (off) emit(envelope('failure', { code: 'local-ai-off', message: off, retryable: false }));
  else emit(envelope('completion', { reason: 'cancelled' }));
}

async function dropLiveSession(key: string): Promise<void> {
  const live = liveSessions.get(key);
  if (!live) return;
  liveSessions.delete(key);
  chatgptRequestHandler.setSession(copilotSessionId(key), false);
  try { await live.session.disconnect(); } catch { /* already closed */ }
}

async function acquireLiveSession(client: CopilotClient, options: CopilotSessionRunOptions, turn: TurnState, tools: Tool[]): Promise<{ live: LiveSession; resumed: boolean }> {
  const sessionKey = liveSessionKey(options.conversationId, options.connectionId, options.model, options.runId, options.sessionScope);
  const sessionId = copilotSessionId(sessionKey);
  chatgptRequestHandler.setSession(sessionId, Boolean(options.chatgptPlanUsage));
  const system = options.messages.flatMap((message) => message.role === 'system' && message.content.trim() ? [message.content.trim()] : []).join('\n\n');
  const trustedRoots = [...new Set([...(options.workingDirectory ? [options.workingDirectory] : []), ...(options.workspaceRoots ?? [])])];
  const mcpServers = toCopilotMcpServers(options.mcpServers);
  const localRuntime = providerBaseUrlAllowsLocalNetwork(typeof options.provider.baseUrl === 'string' ? options.provider.baseUrl : undefined);
  const chatgptPlanUsage = Boolean(options.chatgptPlanUsage);
  // Copilot first-party tools own filesystem and shell. AIR custom tools cover notes and other product-domain operations. Both register on every run, including local BYOK.
  const toolSet = new ToolSet().addBuiltIn('*').addCustom('*');
  if (mcpServers && !chatgptPlanUsage) toolSet.addMcp('*');
  const skillProvider = buildSkillProvider(options.skills);
  const customAgents = (options.customAgents ?? []).map((agent) => ({
    name: agent.name,
    ...(agent.displayName ? { displayName: agent.displayName } : {}),
    ...(agent.description ? { description: agent.description } : {}),
    prompt: agent.prompt,
    ...(agent.tools !== undefined ? { tools: agent.tools } : {}),
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.skills?.length ? { skills: agent.skills } : {})
  }));
  const askUser = Boolean(turn.harness?.requestUserInput);
  // Workflow builders stay out of Office chat. ChatGPT plan usage also rejects
  // Responses tool_search and several media/desktop tools over HTTP.
  const excludedBuiltIns = chatgptPlanUsage
    ? ['run_dynamic_workflow', 'dynamic_workflows_manage', 'tool_search_tool', 'create_image', 'edit_image', 'generate_image', 'code_interpreter', 'computer_use', 'file_search']
    : ['run_dynamic_workflow', 'dynamic_workflows_manage'];
  const sharedConfig = {
    model: options.model,
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
    provider: options.provider,
    streaming: true as const,
    memory: { enabled: false },
    interactiveUser: true,
    enableCitations: !chatgptPlanUsage,
    customAgentsLocalOnly: true,
    // SDK infinite sessions own background compaction; AIR does not add a parallel summarizer.
    // Local runtimes with small context windows skip infinite compaction overhead.
    // ChatGPT plan usage requires store:false and rejects previous_response_id over HTTP.
    infiniteSessions: localRuntime || chatgptPlanUsage
      ? { enabled: false }
      : { enabled: true, backgroundCompactionThreshold: 0.8, bufferExhaustionThreshold: 0.95 },
    enableFileChangeTracking: true,
    // Cloud and Full-harness BYOK can use Copilot image tools; ChatGPT plan usage keeps them excluded above.
    imageGeneration: { enabled: !chatgptPlanUsage },
    sandboxConfig: {
      enabled: true,
      // URL fetches may escalate once when the sandbox proxy cannot reach a host;
      // shell/read/write bypass stays rejected in the permission handler.
      allowBypass: true,
      allowDevToolAccess: true,
      userPolicy: {
        filesystem: { readwritePaths: trustedRoots, deniedPaths: trustedRoots.map((root) => join(root, '.air-office-trash')), clearPolicyOnExit: true },
        network: copilotSandboxNetworkPolicy({
          baseUrl: typeof options.provider.baseUrl === 'string' ? options.provider.baseUrl : undefined
        })
      }
    },
    ...(trustedRoots.length ? { additionalDirectories: trustedRoots } : {}),
    toolSearch: copilotToolSearchConfig(localRuntime, { chatgptPlanUsage }),
    // Only AIR-mapped MCP servers are admitted; ambient CLI MCP configs stay out.
    availableTools: toolSet,
    excludedTools: new ToolSet().addBuiltIn(excludedBuiltIns),
    ...(mcpServers && !chatgptPlanUsage ? { mcpServers } : {}),
    tools,
    // Do not pick up VS Code / home Copilot skill folders. AIR selected skills
    // stay inlined in the prompt; skillProvider is the only on-demand catalog.
    enableConfigDiscovery: false,
    skillDirectories: [],
    agentDirectories: [],
    ...(skillProvider ? { skillProvider, enableSkills: true } : { enableSkills: false }),
    ...(customAgents.length && !chatgptPlanUsage ? { customAgents } : {}),
    ...(options.sessionLimits?.maxAiCredits !== undefined ? { sessionLimits: { maxAiCredits: options.sessionLimits.maxAiCredits } } : {}),
    ...(askUser ? { askUserVariant: 'elicitation' as const } : {}),
    hooks: {
      onErrorOccurred: async (input: { recoverable: boolean }) => ({
        errorHandling: input.recoverable ? 'retry' as const : 'abort' as const,
        ...(input.recoverable ? { retryCount: 1 } : {})
      }),
      onPostToolUseFailure: async (input: { toolName: string; error: string }) => ({
        additionalContext: `The tool "${input.toolName}" failed (${input.error.slice(0, 240)}). Fix the inputs or try a different approach; do not invent a successful result.`
      }),
      onSubagentStart: async () => ({
        additionalContext: 'Stay inside the authorized AIR Office workspace roots. Prefer Copilot first-party file and shell tools (view, create, edit, apply_patch, glob, grep, bash or powershell). Use apply_markdown_note for vault note pairs, and open_in_code when the user should see a file in the Code workbench.'
      })
    },
    onPermissionRequest: buildPermissionHandler(turn, options, client),
    ...(turn.harness?.requestMcpAuth && !chatgptPlanUsage ? { onMcpAuthRequest: async (request: { serverName: string; serverUrl: string; reason: string }) => {
      const token = await turn.harness?.requestMcpAuth?.(request, turn.signal);
      if (!token) return { kind: 'cancelled' as const };
      return { kind: 'token' as const, accessToken: token };
    } } : {}),
    ...(askUser ? { onUserInputRequest: async (request: { question: string; choices?: string[]; allowFreeform?: boolean }) => {
      const input = { requestId: crypto.randomUUID(), question: request.question, ...(request.choices ? { choices: request.choices } : {}), allowFreeform: request.allowFreeform ?? true };
      turn.emit(createChatEnvelopeFactory(turn.runId)('user-input-request', input));
      const answer = await turn.harness?.requestUserInput?.(input, turn.signal);
      if (!answer) throw new Error('The user did not answer the question.');
      return answer;
    } } : {}),
    ...(askUser ? { onElicitationRequest: (context: import('@github/copilot-sdk').ElicitationContext) => requestCopilotElicitation(context, async (input) => {
      const event = input.transient ? { requestId: input.requestId, question: 'A tool requests an external action.', choices: input.choices, allowFreeform: input.allowFreeform, transient: true } : input;
      turn.emit(createChatEnvelopeFactory(turn.runId)('user-input-request', event));
      return await turn.harness?.requestUserInput?.(input, turn.signal) ?? null;
    }) } : {}),
    // The request handler also converts system items emitted by model-specific runtime adapters.
    ...(localRuntime || chatgptPlanUsage
      ? { systemMessage: { mode: 'replace' as const, content: system.trim() || (chatgptPlanUsage ? 'You are a helpful assistant in AIR Office.' : 'You are a helpful local assistant in AIR Office. Answer clearly and briefly.') } }
      : (system ? { systemMessage: { mode: 'append' as const, content: system } } : {})),
    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {})
  };

  // Resume the connection+model session from disk when present; length-continue uses continuePendingWork.
  // Fresh turn config (permissions, tools, MCP) is applied on each resume because handlers bind to this turn.
  let session: CopilotSession | undefined;
  let resumed = false;
  if (await client.getSessionMetadata(sessionId).catch(() => null)) {
    try {
      session = await client.resumeSession(sessionId, {
        ...sharedConfig,
        continuePendingWork: Boolean(options.resumeSessionId)
      });
      resumed = true;
    } catch {
      try { await client.deleteSession(sessionId); } catch { /* recreate below */ }
      session = undefined;
    }
  }
  if (!session) {
    session = await client.createSession({
      sessionId,
      ...(sessionDisplayName(options.conversationId) ? { name: sessionDisplayName(options.conversationId) } : {}),
      ...(options.workingDirectory ? { trustWorkingDirectory: 'session' as const } : {}),
      ...sharedConfig
    });
  }

  const live: LiveSession = { key: sessionKey, session };
  liveSessions.set(sessionKey, live);
  return { live, resumed };
}

/**
 * Runs one AIR chat turn and yields canonical chat events. Copilot persists the
 * session between turns; serializing each session prevents overlapping waits.
 */
export async function* runCopilotSession(options: CopilotSessionRunOptions): AsyncIterable<ChatEventEnvelope> {
  const queue = new EventQueue();
  const turnAbort = new AbortController();
  const turnSignal = options.signal ? AbortSignal.any([options.signal, turnAbort.signal]) : turnAbort.signal;
  const envelope = createChatEnvelopeFactory(options.runId);
  let terminal = false;
  let finishReason: string | undefined;
  const emit = (event: ChatEventEnvelope) => {
    if (event.type === 'completion' || event.type === 'failure') terminal = true;
    queue.push({ kind: 'event', event });
  };

  const client = await sharedCopilotClient(options.baseDirectory);
  const turn: TurnState = {
    runId: options.runId,
    harness: options.harness,
    signal: turnSignal,
    emit,
    emittedToolRequests: new Set<string>(),
    customToolCalls: new Set<string>(),
    completedToolCalls: new Set<string>(),
    startedTools: new Map()
  };
  const tools = buildTools(turn, options.toolDefinitions);
  const sessionKey = liveSessionKey(options.conversationId, options.connectionId, options.model, options.runId, options.sessionScope);
  const closeSession = async () => {
    await dropLiveSession(sessionKey);
    if (!options.conversationId) await client.deleteSession(copilotSessionId(sessionKey)).catch(() => undefined);
  };

  const pump = serializeSessionTurn(sessionKey, turnSignal, async () => {
    if (turnSignal.aborted) {
      emitTurnAbort(emit, envelope, turnSignal);
      return;
    }
      let live: LiveSession | undefined;
      let unsubscribe: (() => void) | undefined;
      try {
        const acquired = await acquireLiveSession(client, options, turn, tools);
        live = acquired.live;
        if (options.reasoningEffort) {
          try { await live.session.setModel(options.model, { reasoningEffort: options.reasoningEffort }); }
          catch { /* Session create/resume already carried the effort when supported. */ }
        }
        steerableRuns.set(options.runId, {
          session: live.session,
          key: sessionKey,
          tools,
          replaceCustomTools: async (definitions) => {
            const next = buildTools(turn, definitions);
            await live!.session.setTools(next);
            const entry = steerableRuns.get(options.runId);
            if (entry) entry.tools = next;
          }
        });
        {
          const { prompt, attachments } = buildPrompt(options, acquired.resumed);
          unsubscribe = live!.session.on((event: SessionEvent) => {
            if (event.type === 'assistant.usage' && !event.agentId && event.data.finishReason) finishReason = event.data.finishReason;
            if (event.type === 'tool.execution_start') {
              const { toolCallId, toolName } = event.data;
              const toolArguments = asObjectArguments(event.data.arguments);
              turn.startedTools.set(toolCallId, { name: toolName, arguments: toolArguments });
              if (!turn.emittedToolRequests.has(toolCallId)) {
                turn.emittedToolRequests.add(toolCallId);
                emit(envelope('tool-request', { toolCallId, name: toolName, arguments: toolArguments }));
              }
              return;
            }
            if (event.type === 'tool.execution_complete') {
              const { toolCallId, success } = event.data;
              if (!turn.customToolCalls.has(toolCallId) && !turn.completedToolCalls.has(toolCallId)) {
                turn.completedToolCalls.add(toolCallId);
                const started = turn.startedTools.get(toolCallId);
                const content = event.data.result?.detailedContent ?? event.data.result?.content;
                let result: unknown;
                if (success && content) {
                  try {
                    const parsed: unknown = JSON.parse(content);
                    if (parsed && typeof parsed === 'object') result = parsed;
                  } catch { /* prose result */ }
                  if (result === undefined && started?.name === 'web_fetch' && typeof started.arguments.url === 'string') {
                    const url = started.arguments.url;
                    const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(content);
                    const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim();
                    let host = url;
                    try { host = new URL(url).hostname; } catch { /* keep url */ }
                    // Keep the stored result page-shaped for the chat card; never
                    // put raw HTML or a long body into the conversation surface.
                    result = { url, title: title || host };
                  } else if (result === undefined) {
                    const trimmed = content.trim();
                    const looksMarkup = trimmed.startsWith('<') || trimmed.startsWith('{') || trimmed.startsWith('[');
                    result = looksMarkup ? { ok: true } : { text: trimmed.slice(0, 400) };
                  }
                }
                const message = event.data.error?.message?.trim() || 'The tool could not complete.';
                emit(envelope('tool-result', { toolCallId, status: success ? 'ok' : 'error', ...(result !== undefined ? { result } : {}), ...(!success ? { message } : {}) }));
              }
              return;
            }
            pushMapped(emit, mapCopilotSessionEvent(event, envelope));
          });
          const abort = () => { void live!.session.abort().catch(() => undefined); };
          if (turnSignal.aborted) abort();
          else turnSignal.addEventListener('abort', abort, { once: true });
          try {
            await live!.session.sendAndWait({
              prompt,
              ...(attachments.length ? { attachments } : {}),
              ...(options.outputSchema ? { responseSchema: { type: 'object', ...options.outputSchema.schema, title: options.outputSchema.name } } : {})
            }, SEND_WAIT_MS);
            if (!terminal) {
              if (turnSignal.aborted) emitTurnAbort(emit, envelope, turnSignal);
              else emit(envelope('completion', { reason: finishReason === 'length' ? 'length' : 'stop' }));
            }
          } finally {
            turnSignal.removeEventListener('abort', abort);
            unsubscribe?.();
            unsubscribe = undefined;
            steerableRuns.delete(options.runId);
          }
        }
        await closeSession();
        return;
      } catch (error) {
        steerableRuns.delete(options.runId);
        unsubscribe?.();
        if (live) await live.session.abort().catch(() => undefined);
        if (turnSignal.aborted) {
          await closeSession();
          if (!terminal) emitTurnAbort(emit, envelope, turnSignal);
          return;
        }
        await closeSession();
        if (!terminal) {
          const failure = classifyProviderFailure(error, true);
          emit(envelope('failure', {
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable,
            ...(failure.status !== undefined ? { status: failure.status } : {})
          }));
        }
        return;
      }
  }).then((ran) => { if (!ran && !terminal) emitTurnAbort(emit, envelope, turnSignal); }).finally(() => queue.close());

  try {
    yield* queue.events();
  } finally {
    turnAbort.abort();
    await pump;
  }
}
