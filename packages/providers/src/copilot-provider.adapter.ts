import type { ChatEventEnvelope, ChatEventPayloadMap, ChatEventType, ProviderRunRequest, ProviderCapability, ProviderConnection } from '@office/contracts/chat';
import { CHAT_PROTOCOL_VERSION, isChatRunSettings } from '@office/contracts/chat';
import type { GeneratedImage, ImageGenerationRequest } from '@office/contracts/capability';
import type { ProviderCredentials } from './provider-credentials.port';
import type { ModelCapabilityDescriptor, ProviderProtocol } from './providers.domain.public';
import { listConnectionModels } from './model-discovery.adapter';
import type { ModelListResult } from './model-discovery.adapter';
import { requestOpenAiImages } from './image-generation.adapter';
import { mapAirProviderToCopilotByok } from './copilot-provider.policy';
import { runCopilotSession } from './copilot-session.adapter';
import { runLeanLocalSession } from './lean-local-session.adapter';
import { resolveChatExecutionMode } from './lean-local.policy';
import { classifyProviderFailure, providerRequiresCredential } from './provider-failure.adapter';

export interface ProviderAdapterOptions {
  id?: string;
  baseUrl: string;
  protocol?: ProviderProtocol | 'chatgpt-signin';
  /**
   * How the resolved credential is handed to Copilot BYOK.
   * ChatGPT plan OAuth uses bearer with per-request refresh; API keys use apiKey.
   */
  credentialKind?: 'api-key' | 'bearer';
  deployment?: string;
  apiVersion?: string;
  region?: string;
  headers?: Record<string, string>;
  modelCapabilities?: Record<string, Partial<Omit<ModelCapabilityDescriptor, 'model' | 'source'>>>;
  models?: string[];
  /** Image models configured for this connection. When nonempty the connection advertises image generation and serves /images/generations calls. */
  imageModels?: string[];
  credentials?: ProviderCredentials;
  /** Capture an account-specific credential resolver for the lifetime of a run. */
  bindCredentials?: (identity?: string) => Promise<{ credentials: ProviderCredentials; sessionIdentity: string; signal?: AbortSignal }>;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Private directory for Copilot CLI state; required for live chat sessions. */
  harnessHome?: string;
  workingDirectory?: string;
  /** Runtime-owned cancellation gate for a managed local provider. */
  inferenceSignal?: (model: string) => AbortSignal;
}

export type ProtocolConnectionOptions = ProviderAdapterOptions & { id: string };

abstract class CopilotProviderConnection implements ProviderConnection {
  abstract readonly id: string;
  protected readonly baseUrl: string;
  protected readonly models: string[];
  protected readonly imageModels: string[];
  protected readonly fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  protected readonly protocol: ProviderProtocol | 'chatgpt-signin';
  protected readonly credentialKind: 'api-key' | 'bearer';
  protected readonly deployment?: string;
  protected readonly apiVersion?: string;
  protected readonly region?: string;
  protected readonly headers: Record<string, string>;
  protected readonly modelCapabilities: Record<string, Partial<Omit<ModelCapabilityDescriptor, 'model' | 'source'>>>;
  protected readonly credentials?: ProviderCredentials;
  protected readonly bindCredentials?: (identity?: string) => Promise<{ credentials: ProviderCredentials; sessionIdentity: string; signal?: AbortSignal }>;
  protected readonly provider: 'openai' | 'ollama';
  protected readonly harnessHome?: string;
  protected readonly workingDirectory?: string;
  protected readonly inferenceSignal?: (model: string) => AbortSignal;
  readonly inputModalities?: readonly string[];

  constructor(provider: 'openai' | 'ollama', options: ProviderAdapterOptions) {
    if (!/^https?:\/\//.test(options.baseUrl)) throw new Error('A provider requires an http(s) base URL.');
    this.provider = provider;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.protocol = options.protocol ?? (provider === 'ollama' ? 'ollama' : 'openai-compatible');
    this.credentialKind = options.credentialKind ?? (this.protocol === 'chatgpt-signin' ? 'bearer' : 'api-key');
    this.deployment = options.deployment;
    this.apiVersion = options.apiVersion;
    this.region = options.region;
    this.headers = options.headers ?? {};
    this.modelCapabilities = options.modelCapabilities ?? {};
    this.models = options.models ?? [];
    this.imageModels = provider === 'openai' ? options.imageModels ?? [] : [];
    this.inputModalities = provider === 'ollama' ? ['text', 'image'] : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.credentials = options.credentials;
    this.bindCredentials = options.bindCredentials;
    this.harnessHome = options.harnessHome;
    this.workingDirectory = options.workingDirectory;
    this.inferenceSignal = options.inferenceSignal;
  }

  capabilities(): ProviderCapability {
    const protocol = this.protocol === 'chatgpt-signin' ? 'openai-responses' : this.protocol;
    return { streaming: true, tools: true, images: this.inputModalities?.includes('image') ?? false, imageGeneration: this.imageModels.length > 0, models: this.models, protocol, modelCapabilities: this.models.map((model) => this.modelDescriptor(model)) };
  }

  modelDescriptor(model: string): ModelCapabilityDescriptor {
    const configured = Object.hasOwn(this.modelCapabilities, model) ? this.modelCapabilities[model] : undefined;
    const support = (key: keyof Omit<ModelCapabilityDescriptor, 'model' | 'contextWindow' | 'source'>): ModelCapabilityDescriptor[typeof key] => configured?.[key] ?? 'unknown';
    return { model, tools: support('tools'), vision: support('vision'), streaming: support('streaming'), reasoning: support('reasoning'), structuredOutput: support('structuredOutput'), contextWindow: configured?.contextWindow ?? null, source: configured ? 'operator' : 'unknown' };
  }

  async generateImage(request: ImageGenerationRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
    if (!this.imageModels.length) throw new Error('This provider does not support image generation.');
    const token = await this.credentials?.resolve(this.id);
    const model = request.model ?? this.imageModels[0];
    return requestOpenAiImages({ baseUrl: this.baseUrl, fetchImpl: this.fetchImpl, authorization: token }, { ...request, ...(model ? { model } : {}) }, signal);
  }

  async describe(): Promise<{ id: string; baseUrl: string; models: string[]; hasCredential?: boolean }> {
    return { id: this.id, baseUrl: this.baseUrl, models: this.models, ...(this.provider === 'openai' ? { hasCredential: Boolean(await this.credentials?.resolve(this.id)) } : {}) };
  }

  async listModels(signal?: AbortSignal): Promise<ModelListResult> {
    const kind = this.protocol;
    return listConnectionModels({
      kind,
      baseUrl: this.baseUrl,
      headers: this.headers,
      credential: async () => (this.credentials ? this.credentials.resolve(this.id) : null),
      fetchImpl: this.fetchImpl,
      ...(signal ? { signal } : {})
    });
  }

  async *stream(request: ProviderRunRequest, signal?: AbortSignal): AsyncIterable<ChatEventEnvelope> {
    let sequence = 0;
    const envelope = <T extends ChatEventType>(type: T, payload: ChatEventPayloadMap[T]): ChatEventEnvelope<T> => ({ protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${request.runId}:${sequence}`, runId: request.runId, correlationId: request.runId, sequence: sequence++, timestamp: new Date().toISOString(), type, payload });
    if (this.inferenceSignal) {
      try {
        const runtimeSignal = this.inferenceSignal(request.model);
        signal = signal ? AbortSignal.any([signal, runtimeSignal]) : runtimeSignal;
      } catch (error) {
        yield envelope('failure', { code: 'local-ai-off', message: error instanceof Error ? error.message : 'Local AI is unavailable.', retryable: false });
        return;
      }
    }
    if (request.settings !== undefined && !isChatRunSettings(request.settings)) {
      yield envelope('failure', { code: 'invalid-run-settings', message: 'The generation settings are invalid.', retryable: false });
      return;
    }
    let token: string | null = null;
    let credentials = this.credentials;
    let sessionIdentity = this.id;
    try {
      if (this.bindCredentials) {
        const bound = await this.bindCredentials(request.credentialIdentity);
        credentials = bound.credentials;
        sessionIdentity = JSON.stringify([this.id, bound.sessionIdentity]);
        if (bound.signal) signal = signal ? AbortSignal.any([signal, bound.signal]) : bound.signal;
      }
      token = await credentials?.resolve(this.id) ?? null;
    } catch (error) {
      yield envelope('failure', { code: 'auth', message: error instanceof Error ? error.message : 'The provider credential could not be read.', retryable: false });
      return;
    }
    const executionMode = request.executionMode ?? resolveChatExecutionMode({
      providerId: this.id,
      baseUrl: this.baseUrl,
      fullHarnessEnabled: false
    });
    const needsCredential = this.credentialKind === 'bearer' || providerRequiresCredential(this.protocol === 'chatgpt-signin' ? 'openai-responses' : this.protocol, this.baseUrl);
    if (needsCredential && !token?.trim()) {
      yield envelope('failure', {
        code: 'auth',
        message: this.credentialKind === 'bearer'
          ? 'Sign in with ChatGPT in Cloud AI settings, then try again.'
          : 'Add an API key for this connection in Connections, then try again.',
        retryable: false
      });
      return;
    }
    const leanCompatible = this.protocol === 'openai-compatible' || this.protocol === 'ollama';
    if (executionMode === 'lean' && leanCompatible) {
      const leanBase = this.protocol === 'ollama' && !/\/v1$/i.test(this.baseUrl.replace(/\/$/, ''))
        ? `${this.baseUrl.replace(/\/$/, '')}/v1`
        : this.baseUrl;
      try {
        for await (const event of runLeanLocalSession({
          runId: request.runId,
          model: request.model,
          baseUrl: leanBase,
          apiKey: token,
          bearer: this.credentialKind === 'bearer' || Boolean(token),
          headers: this.headers,
          messages: request.messages,
          context: request.context,
          initialContent: request.conversation?.initialContent,
          settings: request.settings,
          toolDefinitions: request.toolDefinitions,
          preferredToolIds: request.preferredToolIds,
          harness: request.harness,
          skills: request.skills,
          signal,
          fetchImpl: this.fetchImpl
        })) {
          if (signal?.aborted && event.type !== 'completion' && event.type !== 'failure') continue;
          yield { ...event, eventId: `${request.runId}:${sequence}`, sequence: sequence++, correlationId: request.runId };
        }
      } catch (error) {
        if (signal?.aborted) {
          yield envelope('completion', { reason: 'cancelled' });
          return;
        }
        const failure = classifyProviderFailure(error, true);
        yield envelope('failure', { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.status !== undefined ? { status: failure.status } : {}) });
      }
      return;
    }
    if (!this.harnessHome) {
      yield envelope('failure', { code: 'protocol', message: 'The Copilot harness home directory is not configured.', retryable: false });
      return;
    }
    const mapped = mapAirProviderToCopilotByok({
      protocol: this.protocol,
      baseUrl: this.baseUrl,
      apiKey: this.credentialKind === 'bearer' ? null : token,
      bearer: this.credentialKind === 'bearer',
      deployment: this.deployment,
      apiVersion: this.apiVersion,
      headers: this.headers,
      model: request.model,
      ...(this.protocol === 'chatgpt-signin' ? {} : { maxOutputTokens: request.settings?.maxOutputTokens })
    });
    if (!mapped.ok) {
      yield envelope('failure', { code: 'protocol', message: mapped.reason, retryable: false });
      return;
    }
    if (this.credentialKind === 'bearer') {
      const connectionId = this.id;
      mapped.provider.bearerTokenProvider = async () => {
        const fresh = await credentials?.resolve(connectionId);
        if (!fresh?.trim()) throw new Error('Sign in with ChatGPT in Cloud AI settings, then try again.');
        return fresh;
      };
      delete mapped.provider.bearerToken;
      delete mapped.provider.apiKey;
    }
    try {
      for await (const event of runCopilotSession({
        runId: request.runId,
        model: mapped.model,
        provider: mapped.provider,
        connectionId: sessionIdentity,
        messages: request.messages,
        context: request.context,
        initialContent: request.conversation?.initialContent,
        conversationId: request.conversation?.id,
        sessionScope: request.sessionScope,
        workspaceRoots: request.workspaceRoots,
        resumeSessionId: request.conversation?.continueFrom,
        toolDefinitions: request.toolDefinitions,
        mcpServers: request.mcpServers,
        harness: request.harness,
        skills: request.skills,
        customAgents: request.customAgents,
        sessionLimits: request.sessionLimits,
        commandPermission: request.commandPermission,
        ...(request.settings?.reasoningEffort ? { reasoningEffort: request.settings.reasoningEffort } : {}),
        ...(this.protocol === 'chatgpt-signin' ? { chatgptPlanUsage: true } : {}),
        signal,
        baseDirectory: this.harnessHome,
        workingDirectory: request.workingDirectory ?? request.workspaceRoots?.[0] ?? this.workingDirectory,
        outputSchema: request.outputSchema
      })) {
        if (signal?.aborted && event.type !== 'completion' && event.type !== 'failure') continue;
        yield { ...event, eventId: `${request.runId}:${sequence}`, sequence: sequence++, correlationId: request.runId };
      }
    } catch (error) {
      if (signal?.aborted) {
        yield envelope('completion', { reason: 'cancelled' });
        return;
      }
      const failure = classifyProviderFailure(error, true);
      yield envelope('failure', { code: failure.code, message: failure.message, retryable: failure.retryable, ...(failure.status !== undefined ? { status: failure.status } : {}) });
    }
  }
}

export class AnthropicConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProtocolConnectionOptions) { super('openai', { ...options, protocol: 'anthropic' }); this.id = options.id; }
}

export class GeminiConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProtocolConnectionOptions) { super('openai', { ...options, protocol: 'gemini' }); this.id = options.id; }
}

export class OpenAiResponsesConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProtocolConnectionOptions) { super('openai', { ...options, protocol: options.protocol === 'chatgpt-signin' ? 'chatgpt-signin' : 'openai-responses' }); this.id = options.id; }
}

/** Managed ChatGPT plan connection: OAuth bearer into Copilot Responses BYOK. */
export class ChatGptSignInConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProtocolConnectionOptions) {
    super('openai', { ...options, protocol: 'chatgpt-signin', credentialKind: 'bearer' });
    this.id = options.id;
  }
}

export class AzureOpenAiConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProtocolConnectionOptions) { super('openai', { ...options, protocol: 'azure-openai' }); this.id = options.id; }
}

export class OpenAiCompatibleConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProviderAdapterOptions & { id: string }) { super('openai', options); this.id = options.id; }
}

export class OllamaConnection extends CopilotProviderConnection {
  readonly id: string;
  constructor(options: ProviderAdapterOptions) { super('ollama', options); this.id = options.id ?? 'ollama'; }
}
