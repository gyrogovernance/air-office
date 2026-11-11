export { bundledLemonadeCatalog, parseLemonadeCatalog, type LocalModelListing } from './lemonade-catalog.policy';
import type { ProviderConnection } from '@office/contracts/chat';
import type { ImageGenerationRequest, ImageGenerationResult, WebSearchProvider } from '@office/contracts/capability';
import { LocalReplayConnection } from './local-replay.adapter';
import type { LocalReplayOptions, ReplayStep } from './local-replay.adapter';
import type { ModelListResult } from './model-discovery.adapter';
import { OpenAiCompatibleConnection, OllamaConnection, AnthropicConnection, GeminiConnection, OpenAiResponsesConnection, AzureOpenAiConnection, ChatGptSignInConnection } from './copilot-provider.adapter';
import type { ProviderAdapterOptions } from './copilot-provider.adapter';
import type { ProviderCredentials } from './provider-credentials.port';
import { createEndpointSearchProvider } from './web-search.adapter';
import type { EndpointSearchProviderOptions } from './web-search.adapter';
import { stopSharedCopilotClient, steerCopilotRun, replaceCopilotRunCustomTools, isCopilotRunSteerable } from './copilot-session.adapter';
import { COPILOT_PROVIDER_INCOMPATIBILITIES, copilotSandboxNetworkPolicy, geminiOpenAiCompatibleBase, mapAirProviderToCopilotByok, providerBaseUrlAllowsLocalNetwork } from './copilot-provider.policy';
import { isLocalChatEndpoint, resolveChatExecutionMode, selectLeanTools, leanToolChoice, LEAN_LOCAL_SYSTEM_NOTE, LEAN_TOOL_CATALOG_LIMIT } from './lean-local.policy';
import type { ChatExecutionMode } from './lean-local.policy';
import { runLeanLocalSession } from './lean-local-session.adapter';
import { createModelHarnessStore } from './model-harness.adapter';
import type { ModelHarnessPreference, ModelHarnessStore } from './model-harness.adapter';

export type { LocalReplayOptions, ReplayStep };
export type { ProviderAdapterOptions as OpenAiCompatibleOptions, ProviderAdapterOptions as OllamaOptions, ProviderCredentials };
export { LocalReplayConnection, OpenAiCompatibleConnection, OllamaConnection, AnthropicConnection, GeminiConnection, OpenAiResponsesConnection, AzureOpenAiConnection, ChatGptSignInConnection };
export { stopSharedCopilotClient, steerCopilotRun, replaceCopilotRunCustomTools, isCopilotRunSteerable, COPILOT_PROVIDER_INCOMPATIBILITIES, copilotSandboxNetworkPolicy, geminiOpenAiCompatibleBase, mapAirProviderToCopilotByok, providerBaseUrlAllowsLocalNetwork };
export { isLocalChatEndpoint, resolveChatExecutionMode, selectLeanTools, leanToolChoice, LEAN_LOCAL_SYSTEM_NOTE, LEAN_TOOL_CATALOG_LIMIT, runLeanLocalSession, createModelHarnessStore };
export type { ModelHarnessPreference, ModelHarnessStore, ChatExecutionMode };
export { createEnvironmentCredentials, hasConfiguredCredential } from './environment-credentials.adapter';
export { createKeychainCredentials, createCredentialStore, createPlatformKeychainRunner, createProtectedKeychainRunner } from './keychain-credentials.adapter';
export type { KeychainCredentialsOptions, KeychainRunner, KeychainRun, CredentialStoreOptions, PlatformKeychainOptions } from './keychain-credentials.adapter';
export { createCredentialsBridgeRunner } from './credentials-bridge.adapter';
export { createProtectedCredentialStore } from './protected-credential.adapter';
export type { ProtectedCredentialStore, ProtectedCredentialStoreOptions } from './protected-credential.adapter';
export type { CredentialStore } from './provider-credentials.port';
export { createEndpointSearchProvider };
export type { EndpointSearchProviderOptions, WebSearchProvider };
export { createWebSearchSettings, WebSearchSettingsError, normalizeWebSearchLoaderOptions, WEB_SEARCH_LOADER_DEFAULTS, WEB_SEARCH_LOADER_LIMITS } from './web-search-settings.service';
export type { WebSearchSettings, WebSearchSettingsOptions, WebSearchSettingsStore, WebSearchLoaderOptions, WebSearchCheckRecord, WebSearchCheckReason } from './web-search-settings.service';
export { createWebSearchSettingsStore } from './web-search-settings.adapter';
export { createVaultWebSearchSettingsStore } from './web-search-settings-vault.adapter';
export { createDdgsSearchProvider } from './ddgs-search.adapter';
export type { DdgsSearchOptions } from './ddgs-search.adapter';
export { createWebPageLoader } from './web-page.adapter';
export type { ImageGenerationRequest, ImageGenerationResult };
export { createModelConnectionStore } from './model-connections.adapter';
export { createWorkspaceDefaultsStore, EMPTY_WORKSPACE_DEFAULTS } from './workspace-defaults.adapter';
export type { WorkspaceDefaults, WorkspaceDefaultsStore } from './workspace-defaults.adapter';
export { proposeWorkspaceDefaults, applyWorkspaceDefaults, PREFERRED_CHAT_MODELS, PREFERRED_EMBEDDING_MODELS, DOCUMENTED_EMBEDDING_DIMENSIONS, documentedEmbeddingDimensions } from './workspace-defaults.service';
export type { ModelCandidate, QuickStartProposal } from './workspace-defaults.service';
export { LemonadeModalityAdapter, LemonadeRealtimeAdapter } from './lemonade-modality.adapter';
export type { EmbeddingRequest, EmbeddingResponse, EmbeddingItem, RerankRequest, RerankResponse, RerankItem, TranscriptionRequest, TranscriptionResponse, SpeechRequest, LemonadeAudioRealtimeOptions } from './lemonade-modality.adapter';
export type { LemonadeRuntimeDescriptor as LemonadeModalityRuntimeDescriptor, LemonadeRequestOptions as LemonadeModalityRequestOptions } from './lemonade-modality.adapter';
export { getLemonadeRuntimeStatus, LemonadeStatusError } from './lemonade-status.adapter';
export type { LemonadeRuntimeDescriptor, LemonadeRuntimeStatus, LemonadeHealthState, LemonadeStatusFailureCode } from './lemonade-status.adapter';

export { listConnectionModels, outcomeForResult } from './model-discovery.adapter';
export type { ModelListResult, ModelListRequest, ModelListSuccess, ModelListFailure } from './model-discovery.adapter';
export { parseModelConnection, selectableModels, discoverySummary } from './providers.domain.public';
export { createModelConnectionSettings, ModelConnectionSettingsError } from './model-connection-settings.service';
export type { ModelConnectionSettings, ModelConnectionSettingsOptions } from './model-connection-settings.service';
export { createChatGptSignInService, CHATGPT_SIGNIN_CALLBACK_PATH, CHATGPT_SIGNIN_SCOPE, CHATGPT_SIGNIN_REQUIRED_SCOPE } from './chatgpt-signin.service';
export { modelRegistryFromManagedModels, modelRegistryFromConnections, parseModelReference, resolveModelReference } from './model-registry.policy';
export type { ModelReference, ModelReferenceResolution, ModelReferenceState, ModelRegistryEntry, ModelRole } from './model-registry.policy';

/** Image generation failures a route translates into distinct status codes instead of string matching. */
export class ImageGenerationError extends Error {
  constructor(readonly code: 'unknown-provider' | 'unsupported' | 'engine-failed', message: string) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

/**
 * Nonsecret provider status for a settings surface. It names the connection, the
 * models it exposes, whether a credential is configured, and the capability
 * flags the connection actually serves; it never carries the credential value
 * itself.
 */
export interface ProviderStatus {
  id: string;
  models: string[];
  capabilities: { streaming: boolean; tools: boolean; images: boolean; imageGeneration: boolean };
}

export interface ProvidersService {
  connections(): ProviderConnection[];
  get(id: string): ProviderConnection | undefined;
  default(): ProviderConnection;
  /** Nonsecret status for each configured connection, safe to return to the renderer. */
  status(): ProviderStatus[];
  /**
   * Live model discovery for one connection through the one providers-owned list
   * transport. Returns the requested subset when the endpoint is reachable; the
   * configured list is returned only when the endpoint cannot be reached, and the
   * caller can distinguish that fallback through the connection's stored outcome.
   */
    discoverModels(id: string, signal?: AbortSignal): Promise<string[]>;
    /** The full listing result for a connection, including reachable-empty and classified failures. */
    listModels(id: string, signal?: AbortSignal): Promise<ModelListResult>;
  /** Generates images through a connection that advertises image generation; without a provider id it prefers a configured engine over the local replay. */
  generateImage(request: ImageGenerationRequest, providerId?: string, signal?: AbortSignal): Promise<ImageGenerationResult>;
}

/**
 * Composition factory. Given one or more provider connections, it exposes lookup,
 * a default, nonsecret status, and model discovery. The local replay connection
 * is always available so the workspace runs end to end without a configured live
 * provider.
 */
export function createProvidersService(connections: ProviderConnection[] = [new LocalReplayConnection()]): ProvidersService {
  if (connections.length === 0) throw new Error('A providers service requires at least one connection.');
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const generateImage = async (request: ImageGenerationRequest, providerId?: string, signal?: AbortSignal): Promise<ImageGenerationResult> => {
    const serve = async (connection: ProviderConnection): Promise<ImageGenerationResult> => {
      if (!connection.capabilities().imageGeneration || typeof connection.generateImage !== 'function') throw new ImageGenerationError('unsupported', 'This provider does not support image generation.');
      try { return { provider: connection.id, images: await connection.generateImage(request, signal) }; }
      catch (error) {
        if (error instanceof ImageGenerationError) throw error;
        throw new ImageGenerationError('engine-failed', error instanceof Error ? error.message : 'The image provider request failed.');
      }
    };
    if (providerId !== undefined) {
      const connection = byId.get(providerId);
      if (!connection) throw new ImageGenerationError('unknown-provider', 'Unknown provider.');
      return serve(connection);
    }
    const ordered = [...connections.filter((connection) => connection.id !== 'local-replay'), ...connections.filter((connection) => connection.id === 'local-replay')];
    const engine = ordered.find((connection) => connection.capabilities().imageGeneration && typeof connection.generateImage === 'function');
    if (!engine) throw new ImageGenerationError('unsupported', 'No configured provider supports image generation.');
    return serve(engine);
  };
  const listModels = async (connection: ProviderConnection, signal?: AbortSignal): Promise<ModelListResult> => {
    if (typeof connection.listModels === 'function') return connection.listModels(signal);
    return { ok: true, models: connection.capabilities().models, empty: connection.capabilities().models.length === 0 };
  };
  const discoverModels = async (id: string, signal?: AbortSignal): Promise<string[]> => {
    const connection = byId.get(id);
    if (!connection) return [];
    const result = await listModels(connection, signal);
    if (result.ok) return result.models;
    // Compatibility wrapper for existing consumers: callers that require a full
    // outcome use listModels; this fallback is intentionally visible in the API.
    return connection.capabilities().models;
  };
  return {
    connections: () => [...connections],
    get: (id: string) => byId.get(id),
    default: () => connections[0]!,
    status: () => connections.map((connection) => ({ id: connection.id, models: connection.capabilities().models, capabilities: (({ streaming, tools, images, imageGeneration }) => ({ streaming, tools, images, imageGeneration }))(connection.capabilities()) })),
    generateImage,
    listModels: async (id: string, signal?: AbortSignal) => {
      const connection = byId.get(id);
      if (!connection) return { ok: false, reason: 'not-found', message: 'Unknown provider.' };
      return listModels(connection, signal);
    },
    discoverModels
  };
}

/**
 * Builds provider connections from explicit configuration. A connection is only
 * created when the operator configured its endpoint, so an unconfigured provider
 * produces no connection and no fabricated capability. Credentials are supplied
 * through the credential port, never inline.
 */
export interface ProviderConfiguration {
  openai?: { id?: string; baseUrl: string; models?: string[]; imageModels?: string[] };
  ollama?: { id?: string; baseUrl: string; models?: string[] };
  credentials?: ProviderCredentials;
}

export function createConfiguredProviders(config: ProviderConfiguration): ProvidersService {
  const connections: ProviderConnection[] = [new LocalReplayConnection()];
  if (config.openai) connections.push(new OpenAiCompatibleConnection({ id: config.openai.id ?? 'openai', baseUrl: config.openai.baseUrl, ...(config.openai.models ? { models: config.openai.models } : {}), ...(config.openai.imageModels?.length ? { imageModels: config.openai.imageModels } : {}), ...(config.credentials ? { credentials: config.credentials } : {}) }));
  if (config.ollama) connections.push(new OllamaConnection({ baseUrl: config.ollama.baseUrl, ...(config.ollama.id ? { id: config.ollama.id } : {}), ...(config.ollama.models ? { models: config.ollama.models } : {}), ...(config.credentials ? { credentials: config.credentials } : {}) }));
  return createProvidersService(connections);
}
