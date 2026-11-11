import type { RetrievalResult } from '../knowledge.contracts.public';
import type { JsonSchema } from '../tool.contracts.public';
import type { GeneratedImage, ImageGenerationRequest } from '../capability.contracts.public';

export const CHAT_PROTOCOL_VERSION = 1;
/** Supports app source text plus tested prompts and reference material. */
export const MAX_CHAT_TURN_CHARACTERS = 400_000;

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatTurn =
  | { role: 'user'; content: string; attachments?: ChatInputAttachment[] }
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'assistant-tool-calls'; content: string; calls: { toolCallId: string; name: string; arguments: Record<string, unknown> }[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatInputAttachment {
  id: string;
  label: string;
  mediaType: string;
  /** Populated by the service from its stored source immediately before inference. */
  data?: string;
}

export type ChatToolDefinition = { id: string; name: string; description: string; inputSchema: JsonSchema };

export interface ChatRunContext {
  selection?: string;
  fileName?: string;
  /** Open AIR note handle as `note:<vault-relative-path>` for context; path tools use the path after the prefix. */
  fileId?: string;
  /** Absolute path of the connected-folder file open in the VS Code stage. */
  workspaceFilePath?: string;
  sources?: RetrievalResult[];
}

/** Rich notes carry `note:<vault-relative-path>` handles in chat context. */
export const CHAT_NOTE_FILE_ID_PREFIX = 'note:';

export function isChatRunContext(value: unknown): value is ChatRunContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.entries(value).some(([key, item]) => !['selection', 'fileName', 'fileId', 'workspaceFilePath', 'sources'].includes(key) || key !== 'sources' && (typeof item !== 'string' || item.length > 100_000))) return false;
  if (!('sources' in value) || value.sources === undefined) return true;
  if (!Array.isArray(value.sources) || value.sources.length > 50 || JSON.stringify(value.sources).length > 100_000) return false;
  return value.sources.every((source: unknown) => {
    if (!source || typeof source !== 'object') return false;
    const id = (key: string) => key in source && typeof Reflect.get(source, key) === 'string' && Reflect.get(source, key).length > 0 && Reflect.get(source, key).length <= 500;
    if (!id('chunkId') || !id('sourceVersionId') || !id('collectionId') || !('text' in source) || typeof source.text !== 'string' || !('score' in source) || typeof source.score !== 'number' || !Number.isFinite(source.score) || !('resolved' in source) || typeof source.resolved !== 'boolean' || !('anchor' in source) || !source.anchor || typeof source.anchor !== 'object') return false;
    const anchor = source.anchor;
    return 'sourceVersionId' in anchor && anchor.sourceVersionId === Reflect.get(source, 'sourceVersionId') && 'extractionVersion' in anchor && typeof anchor.extractionVersion === 'string' && 'kind' in anchor && ['page', 'text-range'].includes(String(anchor.kind)) && ['page', 'startByte', 'endByte'].every((key) => !(key in anchor) || Number.isSafeInteger(Reflect.get(anchor, key)) && Reflect.get(anchor, key) >= (key === 'page' ? 1 : 0));
  });
}

/** Reasoning effort values the Copilot Responses path accepts for plan and cloud models. */
export const CHAT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ChatReasoningEffort = (typeof CHAT_REASONING_EFFORTS)[number];

export interface ChatRunSettings {
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ChatReasoningEffort;
}

export function isChatReasoningEffort(value: unknown): value is ChatReasoningEffort {
  return typeof value === 'string' && (CHAT_REASONING_EFFORTS as readonly string[]).includes(value);
}

export function isChatRunSettings(value: unknown): value is ChatRunSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== 'temperature' && key !== 'maxOutputTokens' && key !== 'reasoningEffort')) return false;
  const { temperature, maxOutputTokens, reasoningEffort } = settings;
  return (temperature === undefined || (typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2))
    && (maxOutputTokens === undefined || (typeof maxOutputTokens === 'number' && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens >= 1))
    && (reasoningEffort === undefined || isChatReasoningEffort(reasoningEffort));
}

export interface ChatRunRequest {
  runId: string;
  model: string;
  conversation?: { id: string; assistantMessageId: string; continueFrom?: string; initialContent?: string };
  /** Optional provider connection identifier. When omitted the service uses its default connection. */
  provider?: string;
  messages: ChatTurn[];
  context?: ChatRunContext;
  settings?: ChatRunSettings;
  toolIds?: string[];
  /** Tools explicitly selected by the attached agent, also included in toolIds. */
  preferredToolIds?: string[];
  commandPermission?: 'ask' | 'allow-all';
  toolDefinitions?: ChatToolDefinition[];
  /**
   * Connected-folder path the stage currently shows. The service accepts it only
   * when it matches a registered connected root, then uses it as the Copilot
   * working directory for the run.
   */
  preferredWorkspaceRoot?: string;
}

export interface TextDeltaPayload { messageId: string; text: string; }
export interface MessageCompletePayload { messageId: string; text: string; }
export interface ToolArgumentsFragmentPayload { toolCallId: string; name: string; argumentsDelta: string; }
export interface ToolRequestPayload { toolCallId: string; name: string; arguments: Record<string, unknown>; approvalRequired?: boolean; }
export interface ToolResultPayload { toolCallId: string; status: 'ok' | 'error'; result?: unknown; message?: string; }
export interface UserInputRequestPayload { requestId: string; question: string; choices?: string[]; allowFreeform: boolean; transient?: boolean; url?: string; }
export interface SourceAttachmentPayload { messageId: string; sourceId: string; label: string; resolved?: boolean; }
export interface UsagePayload { inputTokens: number; outputTokens: number; }
export interface CompletionPayload { reason: 'stop' | 'length' | 'tool' | 'cancelled'; }
export interface FailurePayload { code: ChatProviderFailureCode | string; message: string; retryable?: boolean; status?: number; }

export type ChatProviderFailureCode = 'auth' | 'quota' | 'rate-limit' | 'tls' | 'network' | 'timeout' | 'context-limit' | 'capacity' | 'protocol' | 'cancelled' | 'unknown';
export interface ProviderFailure { code: ChatProviderFailureCode; message: string; retryable: boolean; status?: number; }
export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export interface ModelCapabilityDescriptor {
  model: string;
  tools: CapabilitySupport;
  vision: CapabilitySupport;
  streaming: CapabilitySupport;
  reasoning: CapabilitySupport;
  structuredOutput: CapabilitySupport;
  contextWindow: number | null;
  source: 'provider-metadata' | 'operator' | 'unknown';
}

export interface ChatEventPayloadMap {
  'text-delta': TextDeltaPayload;
  'reasoning-delta': { text: string };
  'message-complete': MessageCompletePayload;
  'tool-arguments-fragment': ToolArgumentsFragmentPayload;
  'tool-request': ToolRequestPayload;
  'tool-result': ToolResultPayload;
  'user-input-request': UserInputRequestPayload;
  'source-attachment': SourceAttachmentPayload;
  'usage': UsagePayload;
  'completion': CompletionPayload;
  'failure': FailurePayload;
}

export type ChatEventType = keyof ChatEventPayloadMap;

export type ChatEventEnvelope<T extends ChatEventType = ChatEventType> = {
  [K in T]: {
    protocolVersion: typeof CHAT_PROTOCOL_VERSION;
    eventId: string;
    runId: string;
    correlationId: string;
    sequence: number;
    timestamp: string;
    type: K;
    payload: ChatEventPayloadMap[K];
  };
}[T];

/**
 * A provider connection translates its native stream semantics into the canonical
 * chat event protocol. It never returns stored credentials to the renderer and
 * reports its capabilities honestly. A deterministic replay/local adapter can
 * implement this port with no live API key so implementation, error handling and
 * tests all exist without consuming provider resources.
 */
/** Host-supplied skill body for Copilot's session-scoped skillProvider. */
export type ProviderSkillDefinition = {
  /** Invocation name exposed to the skill tool (unique ignoring case). */
  name: string;
  description: string;
  /** Full skill instructions (SKILL.md body or plain text). */
  instructions: string;
  /** Optional absolute folder of supporting files for the skill. */
  directory?: string;
};

/** AIR Teams/presets mapped into Copilot custom agents for task/fleet dispatch. */
export type ProviderCustomAgentDefinition = {
  name: string;
  displayName?: string;
  description?: string;
  prompt: string;
  tools?: string[] | null;
  model?: string;
  /** Skill names to preload from the session skill catalog. */
  skills?: string[];
};

/** Soft budget for the Copilot session's current accounting window. */
export type ProviderSessionLimits = {
  maxAiCredits?: number;
};

/** Service-owned output constraints; these are not renderer chat settings. */
export interface ProviderRunRequest extends ChatRunRequest {
  outputSchema?: { name: string; schema: Record<string, unknown> };
  /** Service-derived conversation branch identity; never accepted from the renderer. */
  sessionScope?: string;
  /** Service-selected account identity for binding credentials throughout this run. */
  credentialIdentity?: string;
  /** Canonical roots from the service's connected-folder registry. */
  workspaceRoots?: string[];
  /** Preferred working directory among workspaceRoots; set by the service after validating preferredWorkspaceRoot. */
  workingDirectory?: string;
  /** Copilot-hosted MCP servers for this run; never accepted from the renderer HTTP body. */
  mcpServers?: Record<string, ProviderMcpServerConfig>;
  /**
   * Runtime hooks for Copilot SDK harness sessions and the lean local tool loop.
   * Present only on the service→providers boundary; never accepted from the
   * renderer HTTP body.
   */
  harness?: ProviderHarnessHooks;
  /** AIR reusable skills served through Copilot's skill tool; never from the renderer body. */
  skills?: ProviderSkillDefinition[];
  /** Teams/presets registered as Copilot custom agents for this run. */
  customAgents?: ProviderCustomAgentDefinition[];
  /** Optional soft AI-credits cap for the Copilot session window. */
  sessionLimits?: ProviderSessionLimits;
  /**
   * Service-selected execution path. `lean` is the privacy default for local
   * models; `full` is Copilot (cloud and local Full harness). Never from the
   * renderer HTTP body.
   */
  executionMode?: 'lean' | 'full';
}

/** Portable MCP handoff into the Copilot session (AIR→providers boundary only). */
export type ProviderMcpServerConfig =
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string>; tools?: string[] }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; workingDirectory?: string; tools?: string[] };

/** Tool and permission callbacks the Copilot session adapter invokes during a run. */
export interface ProviderHarnessHooks {
  /** Tool names that must wait for the AIR approval decision endpoint. */
  gatedToolNames: ReadonlySet<string>;
  approveTool: (request: { toolCallId: string; name: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => Promise<boolean>;
  requestUserInput?: (request: UserInputRequestPayload, signal?: AbortSignal) => Promise<{ answer: string; wasFreeform: boolean } | null>;
  invokeTool: (request: { toolId: string; name: string; toolCallId: string; arguments: Record<string, unknown> }, signal?: AbortSignal) => Promise<{ status: 'ok' | 'error'; result?: unknown; message?: string }>;
  /** Host-acquired MCP OAuth access token; null cancels the auth request. */
  requestMcpAuth?: (request: { serverName: string; serverUrl: string; reason: string }, signal?: AbortSignal) => Promise<string | null>;
}

export interface ProviderConnection {
  readonly id: string;
  capabilities(): ProviderCapability;
  modelDescriptor?(model: string): ModelCapabilityDescriptor;
  stream(request: ProviderRunRequest, signal?: AbortSignal): AsyncIterable<ChatEventEnvelope>;
  /** Implemented by connections whose capabilities().imageGeneration is true; other connections omit it. */
  generateImage?(request: ImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage[]>;
  /**
   * Implemented by connections that can list the models their endpoint exposes.
   * It reports a reachable-but-empty result distinctly from a failure; absent when
   * a connection has no listing transport (for example the local replay).
   */
  listModels?(signal?: AbortSignal): Promise<ProviderModelList>;
}

/** The outcome of listing the models a connected endpoint exposes. */
export type ModelReasoningOptions = { levels: ChatReasoningEffort[]; defaultLevel: ChatReasoningEffort };
export type ProviderModelList =
  | { ok: true; models: string[]; empty: boolean; reasoningByModel?: Record<string, ModelReasoningOptions> }
  | { ok: false; reason: 'auth' | 'not-found' | 'http' | 'parse' | 'network' | 'timeout'; status?: number; message: string };

export interface ProviderCapability {
  streaming: boolean;
  tools: boolean;
  images: boolean;
  imageGeneration: boolean;
  models: string[];
  protocol?: 'ollama' | 'openai-compatible' | 'openai-responses' | 'azure-openai' | 'anthropic' | 'gemini';
  modelCapabilities?: ModelCapabilityDescriptor[];
}
