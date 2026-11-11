import { createModelCatalogRoutes } from './model-catalog.route';
import { bootstrapRequestOrigin, desktopServiceOrigins, trustedServiceOrigin } from './service-origin.policy';
import { createReasoningComposition, REASONING_COLLECTION_ID } from './reasoning.composition';
import { exportConversationDatasetStream } from '@office/exports/domain';
import { episodicProjection } from '@office/memory/domain';
import { createStorageFolderRoutes } from './storage-folders.route';
import { createLocalModelScanRoutes } from './local-model-scan.route';
import { createStorageLocationRoutes } from './storage-location.route';
import { storageLocationStatus, prepareStorageLocation, createLocalInferenceControl } from '@office/runtime/service';
import { createLocalAiPowerRoutes } from './local-ai-power.route';
import { demoModelSettings } from './demo-model-settings.adapter';
import { demoReplayScript } from './demo-replay.script';
import { applyReranking, decideAutoIndex } from '@office/knowledge/service';
import { LemonadeManagementAdapter } from '@office/providers/lemonade-management';
import { CHAT_PROTOCOL_VERSION, CHAT_NOTE_FILE_ID_PREFIX, MAX_CHAT_TURN_CHARACTERS, isChatRunSettings, isChatRunContext, type ChatRunRequest, type ChatEventEnvelope } from '@office/contracts/chat';
import { FileOperationError, type FileAdapter, type FileErrorCode, fileErrorStatus } from '@office/contracts/file';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync, lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ModelConnection } from '@office/providers/domain';
import { createProvidersService, LocalReplayConnection, OllamaConnection, OpenAiCompatibleConnection, AnthropicConnection, GeminiConnection, OpenAiResponsesConnection, AzureOpenAiConnection, ChatGptSignInConnection, createChatGptSignInService, CHATGPT_SIGNIN_CALLBACK_PATH, createModelConnectionStore, createEnvironmentCredentials, createKeychainCredentials, createCredentialStore, createPlatformKeychainRunner, createProtectedCredentialStore, parseModelConnection, selectableModels, createModelConnectionSettings, ModelConnectionSettingsError, resolveModelReference, modelRegistryFromManagedModels, modelRegistryFromConnections, createWorkspaceDefaultsStore, proposeWorkspaceDefaults, applyWorkspaceDefaults, documentedEmbeddingDimensions, stopSharedCopilotClient, steerCopilotRun, replaceCopilotRunCustomTools, isCopilotRunSteerable, createModelHarnessStore, resolveChatExecutionMode } from '@office/providers/service';
import { createChatGptSignInRoutes } from './chatgpt-signin.route';
import { createModelSettingsRoutes } from './model-settings.route';
import { createWebSearchSettingsRoutes } from './web-search-settings.route';
import { createTodayWikipediaRoutes } from './today-wikipedia.route';
import { createCraftCatalogRoutes } from './craft-catalog.route';
import { createLemonadeActivityJournal } from './lemonade-activity.adapter';
import { createLemonadeActivityRoutes } from './lemonade-activity.route';
import { createLemonadeStatusRoutes } from './lemonade-status.route';
import { createLemonadeModalityRoutes } from './lemonade-modality.route';
import { createLemonadeCollectionRoutes } from './lemonade-collections.route';
import { createRealtimeRelay, type RealtimeRelayData } from './realtime-relay.service';
import { createLemonadeImportRoutes } from './lemonade-import.route';
import { registerLemonadeToolConnection, constrainLemonadeTools, LEMONADE_TOOL_CONNECTION_ID } from './lemonade-tools.adapter';
import { LemonadeModalityAdapter } from '@office/providers/service';
import type { ChatExecutionMode, CredentialStore, KeychainRun, ProviderCredentials, ProvidersService } from '@office/providers/service';
import { createSqliteChatRunStore, createVaultConversationStore, workspaceConversationPlacement, projectConversationRun, baselineSystemPrompt, activeLeaf, messagePath } from '@office/chat/service';
import type { ConversationStore, MessageAttachment, MessageError, MessageStatusEntry, MessageUsage, OutputBlock } from '@office/chat/service';
import { createFilesService, NodeAuthorizedFileAdapter, createFilesystemExplorer } from '@office/files/service';
import { externalFileId } from '@office/files/service';
import { createVaultWorkspaceStore, parsePortableWorkspaceNodes, WorkspaceError } from '@office/workspace/service';
import { ensureVaultLayout, readVaultVersion, writeVaultVersion } from '@office/vault/service';
import {
  actionSlugFromPath,
  actionRelative,
  packActionRelative,
  conversationIdFromPath,
  calendarPathForListId,
  defaultConversationPath,
  automationRelative,
  normalizeVaultRelative,
  VAULT_PATHS,
} from '@office/vault/domain';
import {
  resolveVaultRoot,
  resolveUnderVault,
} from '@office/vault/host';
import { atomicWriteText } from '@office/vault/atomic';
import { createExplorerRoutes, removeWorkspaceItem } from './explorer.route';
import { createWorkspaceKnowledgeRoutes } from './workspace-knowledge.route';
import { createSqliteDocumentStore, createDocumentsService, PythonExtractionWorker, ensureDocumentWorkerPython } from '@office/documents/service';
import { resolveAnchor } from '@office/documents/domain';
import type { ExtractionArtifact } from '@office/contracts/document';
import type { DocumentsService, ExtractionWorker } from '@office/documents/service';
import { pythonInterpreterPath, writePythonInterpreterPath } from './document-python-preference.adapter';
import { applyWorkbenchAppearance, fileInsideConnectedRoot, workbenchLaunchFromEnvironment, workbenchLoginBootstrap, workbenchRootAllowed, workbenchRootForFile, workbenchWorkspaceHref } from './workbench-file.adapter';
import { ensureDevWorkbench, ensureWorkbenchShellExtension, stopDevWorkbench, workbenchStartError } from './workbench-process.adapter';
import { createSqliteKnowledgeStore, createEmbeddingSelectionService, probeSqliteVec } from '@office/knowledge/service';
import type { KnowledgeService } from '@office/knowledge/service';
import { createSqliteJobStore, createJobsService } from '@office/jobs/service';
import type { JobsService } from '@office/jobs/service';
import { buildWorkspaceBundle, validateBundle, restoreRows } from '@office/exports/domain';
import { MAX_BUNDLE_BYTES } from '@office/contracts/export';
import { createVaultRichDocumentStore } from '@office/editor/rich-document-service';
import { validateRichDocument, documentMarkdown, ensureNativeRichDocument } from '@office/editor/rich-document-domain';
import type { RichDocumentRecord } from '@office/contracts/rich-document';
import { createVaultMethodsStore, createMarketCatalogService, createSqliteMarketSourceStore, createSqliteCraftStore, createCraftService } from '@office/methods/service';
import type { CraftResource } from '@office/methods/domain';
import { createCraftRoutes } from './craft.route';
import { createMarketCatalogRoutes } from './market-catalog.route';
import { createMarketDiscoveryRoutes } from './market-discovery.route';
import { validateDefinition, validateMethodsBundle, isAiSafetySkill } from '@office/methods/domain';
import type { MethodDefinition } from '@office/methods/domain';
import {
  AIR_OFFICE_AGENT_ID,
  buildGadgetPassPrompt,
  gadgetSystemPrompt,
  LAB_SOURCE_LIMIT,
  labGadgetToolDefinitions,
  metaEvaluationReferenceFile,
} from '@office/lab-pack/domain';
import {
  createKnowledgeFeedRegistry,
  defaultKnowledgeFeedRegistryPath,
  defaultLabPackLedgerPath,
  loadLabGadgets,
  loadLabGlossary,
  loadVaultLabApps,
  readLabFrameworkText,
  readVaultActionByPath,
  ensurePackActionsSeeded,
  seedLabPack,
  loadBundledCompositionCraftPackages,
  seedBundledCompositionCrafts,
  writeCustomVaultAction,
  removeCustomVaultAction,
  toVaultLabAppDescriptor,
} from '@office/lab-pack/service';
import type { LabAppDescriptor } from '@office/lab-pack/service';
import { actionDemoInput, actionStepPrompt, parseLabAppOverride } from '@office/lab-pack/domain';
import { createLocalMcpRoutes } from './local-mcp.route';
import { buildCopilotMcpServers, mcpEndpointsMatch, mcpServerKey, resolveCopilotWorkspaceRoots } from './copilot-workspace.adapter';
import { validateConnection as validateToolConnection } from '@office/tools/domain';
import { createVaultBackedToolStore, createToolsService, createLocalToolConnector, createCodeInterpreter, defaultChatToolIds, selectEnabledTools, leanView, leanCreate, leanEdit, leanDelete, leanMove, leanPathKind, leanGlob, leanGrep, resolveLeanPath, createWebFetchClient, mergeTodos, listCalendarEvents } from '@office/tools/service';
import type { CodeInterpreter, TodoItem } from '@office/tools/service';
import { createVaultMemoryStore, createMemoryService, validateMemoryContent } from '@office/memory/service';
import type { MemoryService } from '@office/memory/service';
import { createVaultAutomationStore, createAutomationsService } from '@office/automations/service';
import { portableAutomation, validateAutomation } from '@office/automations/domain';
import { createVaultCalendarStore } from '@office/calendar/store';
import { validateCalendarEvent, validateCalendarList } from '@office/calendar/domain';
import { createRemoteToolConnector } from '@office/tools/connector';
import { createMcpOAuthService, MCP_OAUTH_CALLBACK_PATH } from '@office/tools/oauth';
import { createMcpOAuthRoutes } from './mcp-oauth.route';
import { createEndpointSearchProvider, createDdgsSearchProvider, createWebSearchSettings, createVaultWebSearchSettingsStore, ImageGenerationError } from '@office/providers/service';
import { fetchedWebPages } from '@office/chat/domain';
import { validateToolArguments } from '@office/contracts/tool';
import { writeAutomationOutput } from './automation-output.adapter';
import { createCalendarExchange, calendarJsonTemplate } from './calendar-exchange.adapter';
import type { AutomationDefinition } from '@office/automations/domain';

class ChatAttachmentError extends Error {}
class ChatConfigurationError extends Error {}

function folderErrorResponse(error: unknown): Response {
  if (error instanceof WorkspaceError) return Response.json({ error: error.message, code: error.code }, { status: error.code === 'missing' ? 404 : 400 });
  return Response.json({ error: 'The folder operation failed.' }, { status: 400 });
}


const bootstrapToken = randomBytes(32).toString('base64url');
const port = Number(Bun.env.OFFICE_PORT ?? 4317);
/**
 * Resolves when the service is ready to report index jobs. The seed waits for
 * it, because an index job is reported through the job service, which the
 * seed starts before.
 */
let serviceReady: () => void = () => undefined;
const whenServiceReady = new Promise<void>((resolve) => { serviceReady = resolve; });
  const serviceBase = typeof process !== 'undefined' && process.env.OFFICE_PUBLIC_SERVICE_BASE ? process.env.OFFICE_PUBLIC_SERVICE_BASE : `http://127.0.0.1:${port}`;
/**
 * Runtime resource resolution. When the service runs from an installed desktop
 * artifact, the worker sources and the sqlite-vec extension are read from the
 * `resources/` directory next to the executable; in development they come from
 * the repository tree. OFFICE_RESOURCE_ROOT overrides both for local testing.
 */
const resourceRoot = Bun.env.OFFICE_RESOURCE_ROOT ?? (() => {
  const bundled = join(dirname(process.execPath), 'resources');
  return existsSync(bundled) ? bundled : null;
})();
const sourceResourceRoot = () => fileURLToPath(new URL('../../../', import.meta.url));
/** Staged desktop resources, including code-server for on-demand Code. */
const workbenchResourceRoot = Bun.env.OFFICE_RESOURCE_ROOT
  ?? resourceRoot
  ?? join(sourceResourceRoot(), 'apps', 'desktop', 'resources');
/**
 * Storage defaults to the per-user application data directory in development
 * and installed builds. Explicit environment paths retain their ownership.
 * Keep roots aligned with the desktop host (`office_profile`): Windows LocalAppData,
 * macOS Application Support, Linux XDG data home.
 */
function defaultOfficeProfileRoot(profile: 'Data' | 'Demo'): string {
  if (process.env.LOCALAPPDATA || process.env.APPDATA) {
    return join(process.env.LOCALAPPDATA ?? process.env.APPDATA!, 'AIR Office', profile);
  }
  if (process.platform === 'darwin') {
    return join(process.env.HOME ?? tmpdir(), 'Library', 'Application Support', 'AIR Office', profile);
  }
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, 'AIR Office', profile);
  }
  return join(process.env.HOME ?? tmpdir(), '.local', 'share', 'AIR Office', profile);
}
const defaultDataRoot = Bun.env.OFFICE_DATA_ROOT ?? defaultOfficeProfileRoot(Bun.env.OFFICE_DEMO_MODE === '1' ? 'Demo' : 'Data');
if (Bun.env.AIR_VAULT_ROOT !== undefined && !Bun.env.AIR_VAULT_ROOT.trim()) {
  throw new Error('AIR_VAULT_ROOT is set but empty. Unset it to use the default vault, or set a non-empty path.');
}
if (Bun.env.AIR_VAULT_ROOT === undefined) Bun.env.AIR_VAULT_ROOT = join(defaultDataRoot, 'vault');
const vaultRoot = resolveVaultRoot(Bun.env.AIR_VAULT_ROOT);
ensureVaultLayout(vaultRoot);
const storageConfig = Bun.env.OFFICE_STORAGE_CONFIG ?? join(defaultDataRoot, 'private', 'storage-location.json');
/** The models folder can sit outside the data root, so the host names it. */
const defaultModelsRoot = Bun.env.OFFICE_LEMONADE_MODELS_DIR ?? Bun.env.OFFICE_DEFAULT_LOCAL_AI_DIR ?? Bun.env.OFFICE_DEV_LOCAL_AI_DIR ?? join(defaultDataRoot, 'models');
const defaultStorage = {
  private: join(defaultDataRoot, 'private'), public: join(defaultDataRoot, 'public'), models: defaultModelsRoot, cache: join(defaultDataRoot, 'cache'),
  workspace: Bun.env.OFFICE_RUNTIME_DIR ?? join(defaultDataRoot, 'private', 'workspace'),
  files: Bun.env.OFFICE_FILES_ROOT ?? join(defaultDataRoot, 'private', 'files'),
  localAi: Bun.env.OFFICE_DEFAULT_LOCAL_AI_DIR ?? Bun.env.OFFICE_DEV_LOCAL_AI_DIR ?? defaultModelsRoot
};
if (process.argv.includes('--prepare-storage')) { console.log(JSON.stringify(await prepareStorageLocation(storageConfig, defaultStorage))); process.exit(0); }
const storage = await storageLocationStatus(storageConfig, defaultStorage);
const workspaceRoot = storage.current.workspace!;
const privateRoot = storage.current.private!;
if (readVaultVersion(vaultRoot) === null) writeVaultVersion(vaultRoot);
const runtimeRoot = Bun.env.OFFICE_RUNTIME_DIR ?? join(privateRoot, 'workspace');
const scratchRoot = storage.current.cache!;
mkdirSync(privateRoot, { recursive: true });
mkdirSync(storage.current.public!, { recursive: true });
mkdirSync(storage.current.models!, { recursive: true });
mkdirSync(scratchRoot, { recursive: true });
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = scratchRoot;
/**
 * Credential source selection. The operator can pin the environment adapter with
 * OFFICE_CREDENTIALS=environment for hosted mode. Packaged desktop passes the
 * Electron credentials bridge. Browser `bun run dev` on Windows/macOS has no
 * bridge, so secrets land in a private file vault under this profile instead of
 * failing with "Desktop credentials require the Electron host credentials bridge."
 */
const keychainRun: KeychainRun = async (command, args, stdin) => {
  const child = Bun.spawn([command, ...args], { stdin: stdin === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' });
  if (stdin !== undefined && child.stdin) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [stdout] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code: await child.exited, stdout };
  } finally {
    clearTimeout(timeout);
  }
};
const keychainService = Bun.env.OFFICE_KEYCHAIN_SERVICE ?? 'air-office/provider';
const keychainRunner = createPlatformKeychainRunner(process.platform, keychainRun, {
  fileDirectory: Bun.env.OFFICE_CREDENTIALS_DIR ?? join(privateRoot, 'provider-credentials'),
});
const environment = createEnvironmentCredentials(Bun.env);
const keychain = createKeychainCredentials({ runner: keychainRunner, service: keychainService });
const credentials: ProviderCredentials = Bun.env.OFFICE_CREDENTIALS === 'environment'
  ? environment
  : { resolve: async (providerId: string) => (await keychain.resolve(providerId)) ?? environment.resolve(providerId) };
/** Broker store for PUT/DELETE credential routes. Presence combines the keychain with environment configuration. */
const credentialStore: CredentialStore = createCredentialStore({
  runner: keychainRunner,
  service: keychainService,
  additionalPresence: async (providerId: string) => (await environment.resolve(providerId)) !== null,
  initialIdentifiers: () => [...modelConnections.list().flatMap((item) => [item.id, ...(item.retiredCredentialIds ?? []), ...(item.credentialId ? [item.credentialId] : [])]), ...toolStore.connections().flatMap((item) => [item.id, `mcp-oauth-${Buffer.from(item.id).toString('base64url')}`])]
});
const storageLocationRoutes = createStorageLocationRoutes(storageConfig, defaultStorage, Bun.env.OFFICE_DEMO_MODE !== '1' && (!Bun.env.OFFICE_RUNTIME_DIR || Boolean(Bun.env.OFFICE_STORAGE_CONFIG)) && Bun.env.OFFICE_LEMONADE_MODE !== 'attached' && !['OFFICE_CHAT_DATABASE_PATH', 'OFFICE_DOCUMENTS_DATABASE_PATH', 'OFFICE_KNOWLEDGE_DATABASE_PATH', 'OFFICE_JOBS_DATABASE_PATH', 'OFFICE_MEMORY_DATABASE_PATH'].some((name) => Bun.env[name]));
mkdirSync(runtimeRoot, { recursive: true });
// Office chat Copilot working directory is the vault root; connected roots stay
// authorized separately through the existing permission handler.
if (!lstatSync(vaultRoot).isDirectory() || lstatSync(vaultRoot).isSymbolicLink()) throw new Error('AIR_VAULT_ROOT must be a regular directory.');
const copilotWorkdir = realpathSync(vaultRoot);
const modelSeeds: ModelConnection[] = [];
if (Bun.env.OFFICE_OPENAI_BASE_URL) modelSeeds.push(parseModelConnection({ id: 'openai', name: 'OpenAI compatible', kind: 'openai-compatible', baseUrl: Bun.env.OFFICE_OPENAI_BASE_URL, models: Bun.env.OFFICE_OPENAI_MODELS?.split(',').filter(Boolean) ?? [], imageModels: Bun.env.OFFICE_OPENAI_IMAGE_MODELS?.split(',').filter(Boolean) ?? [] }));
if (Bun.env.OFFICE_OLLAMA_BASE_URL) modelSeeds.push(parseModelConnection({ id: 'ollama', name: 'Ollama', kind: 'ollama', baseUrl: Bun.env.OFFICE_OLLAMA_BASE_URL, models: Bun.env.OFFICE_OLLAMA_MODELS?.split(',').filter(Boolean) ?? [], imageModels: [] }));
const modelConnections = createModelConnectionStore(join(privateRoot, 'providers.sqlite'), modelSeeds);
const workspaceDefaults = createWorkspaceDefaultsStore(join(privateRoot, 'providers.sqlite'));
const modelHarness = createModelHarnessStore(vaultRoot);
const managedLemonadeProviderId = 'managed-local';
const managedChatGptProviderId = 'chatgpt-signin';
const localInference = createLocalInferenceControl();
const demoMode = Bun.env.OFFICE_DEMO_MODE === '1';
// Packaged desktop Demo has no separate Bun supervisor: the service owns a
// loopback mock runtime so Models / tools / embeddings still answer.
if (demoMode) {
  Bun.env.OFFICE_CREDENTIALS ??= 'environment';
  Bun.env.OFFICE_KEYCHAIN_SERVICE ??= 'air-office/demo-provider';
  Bun.env.OFFICE_LEMONADE_EMBEDDING_MODEL ??= 'Demo-Embedding';
  Bun.env.OFFICE_LEMONADE_EMBEDDING_REVISION ??= 'demo-v1';
  Bun.env.OFFICE_LEMONADE_EMBEDDING_DIMENSIONS ??= '64';
  Bun.env.OFFICE_KNOWLEDGE_EMBEDDING_MODE ??= 'demo';
  if (!Bun.env.OFFICE_LEMONADE_BASE_ORIGIN) {
    const { startDemoRuntime } = await import('../../../tools/demo-runtime.adapter');
    const runtime = startDemoRuntime();
    Bun.env.OFFICE_LEMONADE_BASE_ORIGIN = runtime.url.origin;
    Bun.env.OFFICE_LEMONADE_TOKEN ??= 'demo-local-only';
    Bun.env.OFFICE_LEMONADE_MODE ??= 'attached';
    Bun.env.OFFICE_LEMONADE_RELEASE ??= 'demo';
  }
}
function lemonadeDescriptorFromEnv() {
  if (!Bun.env.OFFICE_LEMONADE_BASE_ORIGIN) return null;
  return {
    instanceId: Bun.env.OFFICE_LEMONADE_INSTANCE_ID ?? 'air-lemonade',
    generation: Number(Bun.env.OFFICE_LEMONADE_GENERATION ?? 0),
    release: Bun.env.OFFICE_LEMONADE_RELEASE ?? 'unknown',
    baseOrigin: Bun.env.OFFICE_LEMONADE_BASE_ORIGIN,
    resolveSecret: async () => Bun.env.OFFICE_LEMONADE_TOKEN ?? '',
    inference: localInference,
  };
}
let lemonadeDescriptor = lemonadeDescriptorFromEnv();
const getLemonadeDescriptor = () => lemonadeDescriptor;
const lemonadeBootstrapStatus = () => ({ kind: Bun.env.OFFICE_LEMONADE_MODE === 'embedded' ? 'embedded' : 'attached', generation: lemonadeDescriptor?.generation ?? null, baseOrigin: lemonadeDescriptor?.baseOrigin ?? null, release: lemonadeDescriptor?.release ?? '2026.42.1', state: lemonadeDescriptor ? 'configured' : 'stopped' });
const DEV_SUPERVISOR_BASE = Bun.env.OFFICE_DEV_SUPERVISOR_BASE ?? 'http://127.0.0.1:4330';
let lemonadeEnsure: Promise<typeof lemonadeDescriptor> | null = null;
const managedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (method === 'GET' && /\/models\/?$/.test(url.pathname)) return fetch(input, init);
  let model: string | undefined;
  if (typeof init?.body === 'string') {
    const body: unknown = JSON.parse(init.body);
    if (body && typeof body === 'object' && 'model' in body && typeof body.model === 'string') model = body.model;
  }
  const gate = localInference.signal(model);
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return fetch(input, { ...init, signal: caller ? AbortSignal.any([caller, gate]) : gate });
};
const bootstrap = { authenticated: true, protocol: 1, demo: demoMode, privacy: { storage: 'service-owned', browserStorage: 'preferences-and-recovery-drafts', hostedProvider: 'content-required-for-each-request', credentials: 'os-keychain-or-host-configuration' } };
const copilotHarnessHome = join(privateRoot, 'copilot-sdk');
mkdirSync(copilotHarnessHome, { recursive: true });
// ChatGPT OAuth account records hold access, refresh, and ID tokens together.
// On Windows the OS keychain rejects that blob (UTF-16 Credential Manager cap),
// so these credentials use service-owned files under the private data root.
const chatgptCredentials = createProtectedCredentialStore({ directory: join(privateRoot, 'chatgpt-credentials') });
const chatgptSignIn = createChatGptSignInService({
  redirectUrl: `http://127.0.0.1:${port}${CHATGPT_SIGNIN_CALLBACK_PATH}`,
  credentials: {
    resolve: (id) => chatgptCredentials.resolve(id),
    store: (id, secret) => chatgptCredentials.store(id, secret),
    forget: (id) => chatgptCredentials.forget(id),
    // ChatGPT clearAll forgets account ids one by one. This port method must
    // never forward to the shared provider keychain wipe.
    forgetAll: () => chatgptCredentials.forgetAll()
  }
});
const chatgptSignInRoutes = createChatGptSignInRoutes(chatgptSignIn);
function managedLemonadeProvider() {
  if (!lemonadeDescriptor) return null;
  if (demoMode) return new LocalReplayConnection({ id: managedLemonadeProviderId, capabilities: { models: ['Demo-Chat'], imageGeneration: false }, script: (request) => demoReplayScript(request, chatNoteSnapshotOrThrow) });
  try {
    // Lemonade's OpenAI-compatible mount authenticates with Authorization Bearer,
    // so managed-local must use Copilot BYOK bearerToken rather than apiKey.
    return new OpenAiCompatibleConnection({ id: managedLemonadeProviderId, baseUrl: new URL('/v1', lemonadeDescriptor.baseOrigin).href, credentials: { resolve: () => lemonadeDescriptor.resolveSecret() }, credentialKind: 'bearer', fetchImpl: managedFetch, inferenceSignal: localInference.signal, harnessHome: copilotHarnessHome, workingDirectory: copilotWorkdir });
  } catch { return null; }
}
function managedChatGptProvider() {
  if (demoMode) return null;
  return new ChatGptSignInConnection({
    id: managedChatGptProviderId,
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chatgpt-signin',
    credentialKind: 'bearer',
    credentials: {
      resolve: async () => {
        try { return await chatgptSignIn.accessToken(); }
        catch (error) {
          if (error instanceof Error && /sign in|plan usage|expired|refreshed/i.test(error.message)) throw error;
          return null;
        }
      }
    },
    bindCredentials: async (identity) => {
      const accountId = identity === undefined ? (await chatgptSignIn.accounts()).activeAccountId : identity || null;
      return { sessionIdentity: accountId ?? 'signed-out', ...(accountId ? { signal: chatgptSignIn.accountSignal(accountId) } : {}), credentials: { resolve: () => accountId ? chatgptSignIn.accessToken(accountId) : Promise.resolve(null) } };
    },
    harnessHome: copilotHarnessHome,
    workingDirectory: copilotWorkdir
  });
}
// Chat offers the union of observed and manually entered models; the union is a
// derived selectable view and is not written back, so a refresh cannot turn a
// user's manual ID into a claimed observation.
const connectionSettings = createModelConnectionSettings({
  store: modelConnections,
  credentials: { resolve: (id) => id.startsWith('model-key-') ? keychain.resolve(id) : credentials.resolve(id) },
  credentialStore: {
    ...credentialStore,
    configured: (id) => Bun.env.OFFICE_CREDENTIALS === 'environment' && !id.startsWith('model-key-')
      ? environment.resolve(id).then((value) => value !== null)
      : credentialStore.configured(id)
  },
  reload: () => { providers = configuredProviders(); }
});
const demoModelRegistry = modelRegistryFromConnections([{ id: 'local-replay', models: ['local-replay'], modelCapabilities: {} }]);
let managedModelRegistry: ReturnType<typeof modelRegistryFromManagedModels> = [];
const refreshModelReferenceRegistry = async () => {
  const saved = [...demoModelRegistry, ...modelRegistryFromConnections(modelConnections.list())];
  if (!lemonadeDescriptor) return saved;
  try {
    const raw = await new LemonadeManagementAdapter(lemonadeDescriptor).listInstalledModels();
    managedModelRegistry = modelRegistryFromManagedModels(raw);
  } catch {
    // A transient Lemonade hiccup must not wipe the last-known managed
    // registry: models stay resolvable while the daemon restarts.
  }
  return [...saved, ...managedModelRegistry];
};
const modelReferenceRegistry = () => [...demoModelRegistry, ...modelRegistryFromConnections(modelConnections.list()), ...managedModelRegistry];
const resolveScheduledModel = (step: Extract<import('@office/automations/domain').WorkflowStep, { kind: 'prompt' }>) => {
  const reference = step.modelReference ?? (step.providerId && step.modelId ? { providerId: step.providerId, modelId: step.modelId, role: 'chat' as const } : null);
  if (reference) {
    const resolution = resolveModelReference(reference, modelReferenceRegistry());
    if (resolution.state !== 'available') throw new Error(resolution.message);
    return resolution.reference;
  }
  return null;
};

const configuredProviders = () => {
  const managed = managedLemonadeProvider();
  const chatgpt = managedChatGptProvider();
  return createProvidersService([new LocalReplayConnection(demoMode ? { script: (request) => demoReplayScript(request, chatNoteSnapshotOrThrow) } : {}), ...(managed ? [managed] : []), ...(chatgpt ? [chatgpt] : []), ...modelConnections.list().map((connection) => {
    if (demoMode && connection.id.startsWith('demo-')) return new LocalReplayConnection({ id: connection.id, capabilities: { models: selectableModels(connection), imageGeneration: false }, script: (request) => demoReplayScript(request, chatNoteSnapshotOrThrow) });
    const options = { ...connection, models: selectableModels(connection), credentials: { resolve: () => connectionSettings.credential(connection) }, harnessHome: copilotHarnessHome, workingDirectory: copilotWorkdir, ...(lemonadeDescriptor && new URL(connection.baseUrl).origin === new URL(lemonadeDescriptor.baseOrigin).origin ? { fetchImpl: managedFetch, inferenceSignal: localInference.signal } : {}) };
      return connection.kind === 'ollama' ? new OllamaConnection(options) : connection.kind === 'anthropic' ? new AnthropicConnection(options) : connection.kind === 'gemini' ? new GeminiConnection(options) : connection.kind === 'openai-responses' ? new OpenAiResponsesConnection(options) : connection.kind === 'azure-openai' ? new AzureOpenAiConnection(options) : new OpenAiCompatibleConnection(options);
  })]);
};
let providers: ProvidersService = configuredProviders();
const modelCatalogRoutes = createModelCatalogRoutes(getLemonadeDescriptor);
const storageFolderRoutes = createStorageFolderRoutes();
const localModelScanRoutes = createLocalModelScanRoutes(join(privateRoot, 'model-scan.json'), getLemonadeDescriptor, !demoMode, undefined, storage.current.models);
const modelSettingsRoutes = createModelSettingsRoutes(demoMode ? demoModelSettings(connectionSettings) : connectionSettings, [managedLemonadeProviderId, managedChatGptProviderId]);
const lemonadeCollectionRoutes = createLemonadeCollectionRoutes(getLemonadeDescriptor);
const lemonadeModalityRoutes = createLemonadeModalityRoutes(getLemonadeDescriptor);
const lemonadeActivityJournal = createLemonadeActivityJournal(join(privateRoot, 'lemonade-activity.sqlite'), lemonadeDescriptor);
const lemonadeStatusRoutes = createLemonadeImportRoutes(getLemonadeDescriptor, {
  authorizationPath: Bun.env.OFFICE_LEMONADE_IMPORT_AUTHORIZATION,
  privateModelsDirectory: Bun.env.OFFICE_LEMONADE_MODELS_DIR
}, createLemonadeActivityRoutes(getLemonadeDescriptor, lemonadeActivityJournal, createLemonadeStatusRoutes(getLemonadeDescriptor)));

const chatPath = Bun.env.OFFICE_CHAT_DATABASE_PATH ?? join(vaultRoot, '.air', 'runtime', 'chat-runs.sqlite');
const store = createSqliteChatRunStore(chatPath);
store.interrupt();
const conversations: ConversationStore = createVaultConversationStore(vaultRoot);
const workspace = createVaultWorkspaceStore({
  vaultRoot,
  conversations: workspaceConversationPlacement(conversations),
});
const active = new Map<string, AbortController>();
// Pending approvals and user-input waits are process-local: they die with the
// service process. Reopened chats recover only still-live interactions.
const toolApprovals = new Map<string, { runId: string; request: { toolCallId: string; name: string; arguments: Record<string, unknown> }; resolve: (approved: boolean) => void }>();
const userInputRequests = new Map<string, { runId: string; request: import('@office/contracts/chat').UserInputRequestPayload; resolve: (answer: { answer: string; wasFreeform: boolean } | null) => void; choices: string[]; allowFreeform: boolean }>();
const filesystem = createFilesystemExplorer({ databasePath: join(privateRoot, 'filesystem.sqlite'), onAuthorizationRevoked: () => { for (const controller of active.values()) controller.abort(); } });
const explorerRoutes = createExplorerRoutes(workspace, filesystem);
const folders = {
  list: () => workspace.list().filter((node) => node.kind === 'program' || node.kind === 'folder'),
  get: (id: string) => { const node = workspace.get(id); return node && node.kind !== 'mount' ? node : null; },
  create: (input: { id: string; name: string; parentId: string | null; instruction: string }) => input.parentId
    ? workspace.create({ ...input, kind: 'folder', parentId: input.parentId })
    : workspace.create({ ...input, kind: 'program', parentId: null }),
  update: workspace.update,
  delete: (id: string, policy: 'keep-chats' | 'delete-chats') => removeWorkspaceItem(workspace, filesystem, id, policy) !== null,
  chatInstruction: workspace.instruction
};
const documentStore = createSqliteDocumentStore(Bun.env.OFFICE_DOCUMENTS_DATABASE_PATH ?? join(privateRoot, 'documents.sqlite'));
const richDocuments = createVaultRichDocumentStore(vaultRoot);
const methods = createVaultMethodsStore(vaultRoot);
const craftStore = createSqliteCraftStore(join(vaultRoot, '.air', 'runtime', 'crafts.sqlite'));
seedBundledCompositionCrafts(craftStore);
const marketSourceStore = createSqliteMarketSourceStore(join(vaultRoot, '.air', 'runtime', 'market-sources.sqlite'));
const marketCatalog = createMarketCatalogService({ sources: marketSourceStore, methods });
const marketCatalogRoutes = createMarketCatalogRoutes(marketCatalog);
const marketDiscoveryRoutes = createMarketDiscoveryRoutes();
const toolStore = createVaultBackedToolStore({ sqlitePath: join(privateRoot, 'tools.sqlite'), vaultRoot });

/**
 * Installed builds use the frozen reader and never prepare Python dependencies.
 * An interpreter explicitly selected in settings can replace that reader.
 * Development retains the host preparation path.
 */
const workerRoot = Bun.env.OFFICE_WORKER_ROOT ?? (resourceRoot ? join(resourceRoot, 'workers', 'documents') : join(sourceResourceRoot(), 'workers', 'documents'));
const sqliteVecPath = Bun.env.OFFICE_SQLITE_VEC_PATH ?? [resourceRoot ? join(resourceRoot, 'external', 'sqlite-vec', 'vec0.dll') : null, join(sourceResourceRoot(), 'external', 'sqlite-vec', 'vec0.dll')].find((candidate) => candidate !== null && existsSync(candidate)) ?? null;
const preferredWorkbenchPython = pythonInterpreterPath(privateRoot);
if (preferredWorkbenchPython && !Bun.env.OFFICE_PYTHON) Bun.env.OFFICE_PYTHON = preferredWorkbenchPython;
async function startExtractionWorker(interpreter?: string): Promise<ExtractionWorker | null> {
  if (interpreter) {
    try { return await PythonExtractionWorker.start({ command: [interpreter, '-m', 'office_documents.main'], cwd: workerRoot, env: { PYTHONPATH: join(workerRoot, 'src') } }); }
    catch { return null; }
  }
  // Installed builds use only the frozen reader. Host uv/Python discovery can
  // hang, download runtimes, or flash consoles and must not run at startup.
  if (resourceRoot) {
    const executable = join(resourceRoot, 'workers', 'documents-runtime', `air-office-documents${process.platform === 'win32' ? '.exe' : ''}`);
    if (!existsSync(executable)) {
      console.warn(JSON.stringify({ component: 'documents', operation: 'worker-start', outcome: 'unavailable', reason: 'The packaged document reader is missing from this install.' }));
      return null;
    }
    try { return await PythonExtractionWorker.start({ command: [executable] }); }
    catch { console.warn(JSON.stringify({ component: 'documents', operation: 'worker-start', outcome: 'unavailable', reason: 'The packaged document reader could not start.' })); return null; }
  }
  let pythonPath: string | null = null;
  try { pythonPath = ensureDocumentWorkerPython(workerRoot); }
  catch (error) {
    console.warn(JSON.stringify({ component: 'documents', operation: 'worker-start', outcome: 'unavailable', reason: error instanceof Error ? error.message : 'Python discovery failed.' }));
    return null;
  }
  if (!pythonPath) {
    console.warn(JSON.stringify({ component: 'documents', operation: 'worker-start', outcome: 'unavailable', reason: 'No usable Python 3.11+ interpreter was found for the documents worker.' }));
    return null;
  }
  try {
    return await PythonExtractionWorker.start({ command: [pythonPath, '-m', 'office_documents.main'], cwd: workerRoot, env: { PYTHONPATH: join(workerRoot, 'src') } });
  } catch (error) {
    console.warn(JSON.stringify({ component: 'documents', operation: 'worker-start', outcome: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' }));
    return null;
  }
}
let extractionWorker: ExtractionWorker | null = await startExtractionWorker(preferredWorkbenchPython ?? undefined);
let documents: DocumentsService = createDocumentsService(documentStore, extractionWorker ?? undefined);
const knowledgeStore = createSqliteKnowledgeStore(Bun.env.OFFICE_KNOWLEDGE_DATABASE_PATH ?? join(vaultRoot, '.air', 'runtime', 'knowledge.sqlite'));
const embeddingSelection = createEmbeddingSelectionService(knowledgeStore, {
  demo: Bun.env.OFFICE_KNOWLEDGE_EMBEDDING_MODE === 'demo' || Bun.env.NODE_ENV === 'test',
  initial: Bun.env.OFFICE_LEMONADE_EMBEDDING_MODEL && Bun.env.OFFICE_LEMONADE_EMBEDDING_REVISION ? { model: Bun.env.OFFICE_LEMONADE_EMBEDDING_MODEL, revision: Bun.env.OFFICE_LEMONADE_EMBEDDING_REVISION, dimensions: Number(Bun.env.OFFICE_LEMONADE_EMBEDDING_DIMENSIONS ?? 0), mode: 'runtime' } : undefined,
  // Always wire the callback. Desktop starts Lemonade on demand, so the
  // descriptor is often null at boot and only appears after ensureLemonadeRuntime.
  // Capturing "unavailable" at construction made downloaded models unusable.
  runtimeEmbed: async (selection, texts, signal) => {
    const descriptor = lemonadeDescriptor ?? await ensureLemonadeRuntime();
    if (!descriptor) throw new Error('The managed embedding runtime is unavailable.');
    const response = await new LemonadeModalityAdapter(descriptor).embeddings({ model: selection.model, input: [...texts] }, { signal });
    if (response.data.length !== texts.length || new Set(response.data.map((item) => item.index)).size !== texts.length || response.data.some((item) => item.index < 0 || item.index >= texts.length)) throw new Error('The embedding response has invalid batch indices.');
    return [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding) as number[][];
  }
});
let knowledge: KnowledgeService = embeddingSelection.snapshot().knowledge;
const workspaceKnowledgeRoutes = createWorkspaceKnowledgeRoutes({
  workspace,
  filesystem,
  documents,
  knowledge: () => knowledge,
  note: (id) => {
    const record = richDocuments.get(id);
    return record && !trashedNoteIds().has(id) ? ensureNativeRichDocument(record) : null;
  },
  index: ({ collectionId, versionId }) => {
    const artifact = documents.artifact(versionId);
    if (!artifact) return;
    try { knowledge.materializeFullText({ collectionId, sourceVersionId: versionId, artifact }); } catch { /* keep UI responsive */ }
    if (!localEmbeddingsEnabled()) return;
    void knowledge.indexSourceVersion({ collectionId, sourceVersionId: versionId, artifact }).catch(() => undefined);
  }
});
const localEmbeddingsEnabled = () => embeddingSelection.selection()?.mode === 'demo' || localInference.enabled();
/**
 * Produces the extraction artifact for one source.
 *
 * Plain text and markdown carry their own text, so their artifact is built
 * here and stored, exactly as a worker extraction would be. The stored artifact
 * is what a later rebuild reads back: without it the rebuild finds no source
 * for the collection and commits an empty index that still reports success.
 */
const extractionArtifactFor = async (versionId: string, absolutePath: string, filename: string, bytes: Uint8Array): Promise<ExtractionArtifact | null> => {
  if (/\.(md|txt)$/i.test(filename)) {
    return documents.recordArtifact(versionId, { extractor: 'inline-text', extractorVersion: '1', extractionVersion: 'anchor-v1', text: new TextDecoder('utf-8').decode(bytes), pageCount: null, warnings: [], contentHash: '', createdAt: new Date().toISOString() });
  }
  if (!extractionWorker) return null;
  return documents.extract(versionId, absolutePath);
};
/**
 * The Lab pack install targets. They read the live knowledge service and the
 * document store, so a reinstall after a reset installs into the current
 * stores rather than into the ones that existed at startup.
 */
const labPackKnowledgeTarget = {
  hasCollection: (id: string) => knowledge.collections().some((collection) => collection.id === id),
  createCollection: (id: string, name: string) => { knowledge.createCollection(id, name); },
  hasDocument: (documentId: string) => documents.documents(null).some((document) => document.id === documentId),
  // A shipped document counts as installed only when it exists, carries
  // extracted text, and has searchable chunks. Text without chunks is not
  // findable, so the seed reinstalls the index step instead of trusting the
  // ledger. Embedding vectors remain a separate, optional concern.
  isIndexed: (documentId: string) => {
    const document = documents.documents(null).find((entry) => entry.id === documentId);
    if (!document) return false;
    const versions = documents.versions(document.id);
    return versions.length > 0 && versions.every((version) => {
      const artifact = documents.artifact(version.id);
      return artifact !== null && artifact.text.trim().length > 0 && knowledge.sourceChunkCount(version.id) > 0;
    });
  },
  ingest: ({ documentId, name, collectionId, bytes }: { documentId: string; name: string; collectionId: string; bytes: Uint8Array }) => {
    const result = documents.ingest({ documentId, name, collectionId, bytes });
    return { versionId: result.version.id, created: result.created };
  },
  // The text is stored first. A document with text is installed and can be
  // reached by a full-text search even when no embedding model is selected.
  extract: async ({ versionId, absolutePath, filename, bytes }: { versionId: string; absolutePath: string; filename: string; bytes: Uint8Array }) => {
    const artifact = await extractionArtifactFor(versionId, absolutePath, filename, bytes);
    if (!artifact) throw new Error(`Could not extract ${filename}. The document extraction worker is unavailable.`);
  },
  // Full-text chunks are always written so shipped documents are searchable
  // before any embedding model is selected. Vectors are added when local
  // embeddings are available.
  index: async ({ collectionId, versionId }: { collectionId: string; versionId: string }) => {
    const artifact = documents.artifact(versionId);
    if (!artifact) throw new Error('The document text was not extracted, so it cannot be indexed.');
    knowledge.materializeFullText({ collectionId, sourceVersionId: versionId, artifact });
    if (!localEmbeddingsEnabled()) return;
    await knowledge.indexSourceVersion({ collectionId, sourceVersionId: versionId, artifact });
  },
};
const labPackSeed = await seedLabPack({
  enabled: (Bun.env.OFFICE_LAB_PACK ?? 'true').toLowerCase() !== 'false',
  ledgerPath: defaultLabPackLedgerPath(privateRoot),
  methods: { get: (id) => methods.get(id), save: (definition) => methods.save(definition) },
  knowledge: labPackKnowledgeTarget,
  knowledgeInBackground: true,
});
if (labPackSeed.errors.length) {
  console.warn(JSON.stringify({ component: 'lab-pack', operation: 'seed', errors: labPackSeed.errors }));
}
void labPackSeed.knowledgeTask?.then(async () => {
  if (labPackSeed.errors.length) {
    console.warn(JSON.stringify({ component: 'lab-pack', operation: 'seed', errors: labPackSeed.errors }));
  }
  // The shipped documents are installed by now, so the ones that still wait
  // for an index are indexed. A document in a collection is there to be
  // found, and the embedding model is selected, so there is nothing left to
  // ask the user for.
  await whenServiceReady;
  await ensureEmbeddingSelection();
  autoIndexPendingCollections();
});
const knowledgeFeeds = createKnowledgeFeedRegistry(defaultKnowledgeFeedRegistryPath(privateRoot));
function availableActions(): LabAppDescriptor[] {
  ensurePackActionsSeeded(vaultRoot, loadLabGadgets());
  const actions: LabAppDescriptor[] = loadVaultLabApps(vaultRoot, loadLabGadgets(), (filename) => readLabFrameworkText(filename)).map((action) => ({
    id: action.id,
    name: action.name,
    description: action.description,
    prompts: action.prompts,
    system: action.system,
    runPrompts: action.runPrompts,
    edited: action.edited,
    icon: action.icon,
    custom: action.custom,
  }));
  const seen = new Set(actions.map((action) => action.id));
  for (const record of craftStore.list()) {
    if (!record.enabled || record.package.runtime !== 'composition') continue;
    for (const automation of record.package.automations) for (const step of automation.steps) {
      if (step.kind !== 'action') continue;
      const id = `craft-action-${createHash('sha256').update(JSON.stringify([record.package.id, step.actionPath, step.definition])).digest('hex')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      actions.push({ id, name: step.definition.name, description: `Included in ${record.package.name}.`, prompts: step.definition.runPrompts, runPrompts: step.definition.runPrompts, system: step.definition.system, icon: '✨', edited: false, custom: false });
    }
  }
  return actions;
}
async function executeAction(actionId: string, source: string, instructions: string, signal: AbortSignal, options?: { connection?: ReturnType<typeof providers.default>; model?: string; credentialIdentity?: string; definition?: Pick<LabAppDescriptor, 'name' | 'system' | 'runPrompts'> }): Promise<{ actionId: string; name: string; steps: string[]; summary: string }> {
  if (!source.trim()) throw new Error('Supply the source text to process.');
  if (source.length > LAB_SOURCE_LIMIT) throw new Error(`The source exceeds ${LAB_SOURCE_LIMIT} characters. Select a smaller section; no text was truncated.`);
  const action = options?.definition ?? availableActions().find((item) => item.id === actionId);
  if (!action) throw new Error('This Action is no longer available.');
  const connection = options?.connection ?? providers.default();
  const model = options?.model || connection.capabilities().models[0] || 'local-replay';
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: action.system }];
  const results: string[] = [];
  for (const [index, basePrompt] of action.runPrompts.entries()) {
    const prompt = actionStepPrompt({ prompt: basePrompt, index, source, instructions });
    messages.push({ role: 'user', content: prompt });
    const parts: string[] = [];
    const requestMessages = model === 'local-replay' ? [{ role: 'user' as const, content: actionDemoInput({ source, instructions }) }] : [...messages];
    for await (const event of connection.stream({ runId: crypto.randomUUID(), model, messages: requestMessages, ...(options?.credentialIdentity !== undefined ? { credentialIdentity: options.credentialIdentity } : {}) }, signal)) {
      if (event.type === 'text-delta') parts.push(event.payload.text);
      if (event.type === 'failure') throw new Error(event.payload.message);
    }
    const result = parts.join('');
    if (!result.trim()) throw new Error('The model returned no text for this Action step.');
    messages.push({ role: 'assistant', content: result });
    results.push(result);
  }
  return { actionId, name: action.name, steps: results, summary: results.map((result, index) => `## Step ${index + 1}\n\n${result}`).join('\n\n') };
}
const knowledgeSeedTarget = labPackKnowledgeTarget;
const jobs: JobsService = createJobsService(createSqliteJobStore(Bun.env.OFFICE_JOBS_DATABASE_PATH ?? join(privateRoot, 'jobs.sqlite')));
lemonadeActivityJournal.importHistorical(jobs.list());
jobs.recover();
const filesRoot = Bun.env.OFFICE_FILES_ROOT ?? join(storage.current.private!, 'files');
const fileAdapter: FileAdapter = new NodeAuthorizedFileAdapter({ root: filesRoot });
const files = createFilesService(fileAdapter, filesystem);
await fileAdapter.authorize();
/**
 * Capability services behind the builtin tools. Web research has a built-in
 * engine that needs no API key and no service the user has to run, so search
 * works out of the box; the address of a search service the user runs, such
 * as a local SearXNG instance, is a stored setting that takes its place when
 * it is set. The environment variable seeds that address on first start. A
 * malformed endpoint leaves the built-in engine in place rather than
 * preventing startup.
 */
const searchWorkerExecutable = 'air-office-web-search' + (process.platform === 'win32' ? '.exe' : '');
const searchWorkerPath = Bun.env.OFFICE_SEARCH_WORKER ?? (resourceRoot
  ? join(resourceRoot, 'workers', 'web-search', searchWorkerExecutable)
  : join(sourceResourceRoot(), 'workers', 'web-search', 'dist', `${process.platform}-${process.arch}`, 'air-office-web-search', searchWorkerExecutable));
const webSearchSettings = createWebSearchSettings({
  store: createVaultWebSearchSettingsStore(vaultRoot, Bun.env.OFFICE_SEARCH_ENDPOINT),
  createProvider: (endpoint, loaderOptions) => { try { return createEndpointSearchProvider({ endpoint, id: 'searxng', ...(loaderOptions ?? {}) }); } catch { return null; } },
  createBuiltInProvider: (loaderOptions) => { try { return createDdgsSearchProvider({ command: [searchWorkerPath], ...(loaderOptions ?? {}) }); } catch { return null; } }
});
const webSearchSettingsRoutes = createWebSearchSettingsRoutes(webSearchSettings);
const todayWikipediaRoutes = createTodayWikipediaRoutes();
const craftCatalogRoutes = createCraftCatalogRoutes();
const memory: MemoryService = createMemoryService(createVaultMemoryStore(vaultRoot));
const codeInterpreter: CodeInterpreter = createCodeInterpreter({ ...(Bun.env.OFFICE_CODE_RUNTIME ? { runtime: Bun.env.OFFICE_CODE_RUNTIME } : {}) });
// Vault notes and connected-root files use lean path tools (view/create/edit/glob/grep)
// plus apply_markdown_note. Copilot first-party tools cover shell and broader FS on full harness.
const NOTE_ID_PREFIX = CHAT_NOTE_FILE_ID_PREFIX;
const noteFileId = (id: string): string => `${NOTE_ID_PREFIX}${id}`;
const trashedNoteIds = (): Set<string> => new Set(richDocuments.trashed().map((record) => record.id));
async function chatNoteSnapshot(record: RichDocumentRecord): Promise<{ id: string; name: string; version: string; content: string } | null> {
  const document = await ensureNativeRichDocument(record);
  if (!document) return null;
  const handle = document.path ?? richDocuments.pathOf(document.id) ?? document.id;
  return { id: noteFileId(handle), name: `${document.title}.note`, version: record.updatedAt, content: documentMarkdown(document) };
}
const chatNoteSnapshotOrThrow = async (fileId: string): Promise<NonNullable<Awaited<ReturnType<typeof chatNoteSnapshot>>>> => {
  const id = String(fileId ?? '');
  if (!id.startsWith(NOTE_ID_PREFIX)) throw new FileOperationError('file-not-found', 'AIR notes require a note:<vault-path> handle. Use view / edit for vault or connected-folder paths.');
  const key = id.slice(NOTE_ID_PREFIX.length);
  const record = richDocuments.get(key);
  const file = record && !trashedNoteIds().has(record.id) ? await chatNoteSnapshot(record) : null;
  if (!file) throw new FileOperationError('file-not-found', 'The note is unavailable. Open it from Documents and try again.');
  return file;
};
function leanRoots() {
  return {
    vaultRoot,
    connectedRoots: filesystem.roots().map((root) => root.path),
    deniedRoots: [privateRoot],
  };
}

const webFetch = createWebFetchClient();
/** Per chat-run checklist snapshots for todo_write (v1 is run-scoped only). */
const runTodoState = new Map<string, TodoItem[]>();

const tools = createToolsService(toolStore, {
  'builtin:view': async ({ path, view_range }) => {
    const range = Array.isArray(view_range) && view_range.length === 2
      ? [Number(view_range[0]), Number(view_range[1])] as [number, number]
      : undefined;
    return leanView({ path: String(path ?? ''), ...(range ? { view_range: range } : {}) }, leanRoots());
  },
  'builtin:create': async ({ path, file_text }) => leanCreate({ path: String(path ?? ''), file_text: String(file_text ?? '') }, leanRoots()),
  'builtin:edit': async ({ path, old_str, new_str }) => leanEdit({
    path: String(path ?? ''),
    old_str: String(old_str ?? ''),
    new_str: String(new_str ?? ''),
  }, leanRoots()),
  'builtin:delete': async ({ path }) => {
    const target = String(path ?? '');
    const normalized = target.replace(/\\/g, '/');
    if (/(?:^|\/)notes\//.test(normalized) && (normalized.endsWith('.md') || normalized.endsWith('.note.json'))) {
      if (richDocuments.trash(target)) return { path: target, deleted: true, trashed: true };
    }
    return leanDelete({ path: target }, leanRoots());
  },
  'builtin:move': async ({ path, to }) => leanMove({ path: String(path ?? ''), to: String(to ?? '') }, leanRoots()),
  'builtin:glob': async ({ pattern, path }) => leanGlob({
    pattern: String(pattern ?? ''),
    ...(path !== undefined && path !== null && String(path).trim() ? { path: String(path) } : {}),
  }, leanRoots()),
  'builtin:grep': async (input) => leanGrep({
    pattern: String(input.pattern ?? ''),
    ...(input.path !== undefined && input.path !== null && String(input.path).trim() ? { path: String(input.path) } : {}),
    ...(typeof input.output_mode === 'string' ? { output_mode: input.output_mode as 'content' | 'files_with_matches' | 'count' } : {}),
    ...(typeof input.glob === 'string' ? { glob: input.glob } : {}),
    ...(input['-i'] !== undefined ? { '-i': Boolean(input['-i']) } : {}),
    ...(input['-A'] !== undefined ? { '-A': Number(input['-A']) } : {}),
    ...(input['-B'] !== undefined ? { '-B': Number(input['-B']) } : {}),
    ...(input['-C'] !== undefined ? { '-C': Number(input['-C']) } : {}),
    ...(input['-n'] !== undefined ? { '-n': Boolean(input['-n']) } : {}),
    ...(input.head_limit !== undefined ? { head_limit: Number(input.head_limit) } : {}),
    ...(input.multiline !== undefined ? { multiline: Boolean(input.multiline) } : {}),
  }, leanRoots()),
  'builtin:apply-markdown-note': async ({ path, markdown }) => {
    const store = richDocuments as ReturnType<typeof createVaultRichDocumentStore>;
    const result = store.applyMarkdown(String(path), typeof markdown === 'string' ? markdown : undefined);
    return { path: String(path), document: result.document, warnings: result.warnings };
  },
  'builtin:web-search': async (input, signal) => {
    const query = String(input.query ?? '').trim();
    if (!query) throw new Error('A search query is required.');
    const provider = webSearchSettings.provider();
    if (!provider) throw new Error('Web search is switched off for this workspace. Turn it on in Settings.');
    const limit = Number.isFinite(Number(input.limit)) ? Math.min(Math.max(Math.trunc(Number(input.limit)), 1), 10) : 5;
    const found = await provider.search(query, { limit }, signal);
    return { query: found.query, results: found.results.map((row) => ({ url: row.url, title: row.title, snippet: row.snippet })) };
  },
  'builtin:web-fetch': async (input, signal) => webFetch.fetch({
    url: String(input.url ?? ''),
    ...(input.max_chars !== undefined ? { max_chars: Number(input.max_chars) } : {}),
  }, signal),
  'builtin:knowledge-search': async (input, signal) => {
    const query = String(input.query ?? '').trim();
    if (!query) throw new Error('A search query is required.');
    const known = new Set(knowledge.collections().map((collection) => collection.id));
    const requested = Array.isArray(input.collectionIds)
      ? input.collectionIds.map((id) => String(id)).filter((id) => known.has(id) && id !== REASONING_COLLECTION_ID)
      : [...known].filter((id) => id !== REASONING_COLLECTION_ID);
    if (!requested.length) return { hits: [] };
    const mode = (typeof input.mode === 'string' && ['full-text', 'vector', 'hybrid'].includes(input.mode)
      ? input.mode
      : 'full-text') as 'full-text' | 'vector' | 'hybrid';
    const limit = Number.isFinite(Number(input.limit)) ? Math.min(Math.max(Math.trunc(Number(input.limit)), 1), 50) : 10;
    const policy = { canRead: (collectionId: string) => collectionId !== REASONING_COLLECTION_ID && known.has(collectionId) };
    const embeddingSnapshot = embeddingSelection.snapshot();
    const embedding = mode === 'full-text' ? undefined : (await embeddingSnapshot.provider.embed([query], signal))[0];
    const results = await embeddingSnapshot.knowledge.retrieve({
      collectionIds: requested,
      query: { mode, text: query, embedding, index: embeddingSnapshot.identity, limit },
      policy,
    });
    return {
      hits: results.map((row) => ({
        collectionId: row.collectionId,
        sourceVersionId: row.sourceVersionId,
        text: row.text,
        score: row.score,
      })),
    };
  },
  'builtin:open-path': async ({ path }) => {
    const resolved = leanPathKind(String(path ?? ''), leanRoots());
    return { ...resolved, opened: true };
  },
  'builtin:open-in-code': async ({ path }) => {
    const absolute = resolveLeanPath(String(path ?? ''), leanRoots());
    const connected = filesystem.roots().map((root) => root.path);
    const target = workbenchRootForFile(absolute, vaultRoot, connected);
    if (!target) throw new Error('That file is outside the Library and connected folders.');
    const resolved = leanPathKind(String(path ?? ''), leanRoots());
    let libraryRoot: string;
    let openedRoot: string;
    try {
      libraryRoot = realpathSync(vaultRoot);
      openedRoot = realpathSync(target.rootPath);
    } catch {
      libraryRoot = resolve(vaultRoot);
      openedRoot = resolve(target.rootPath);
    }
    // Library files open on the stage. Code may mount connected folders only.
    if (openedRoot === libraryRoot) return { ...resolved, opened: true };
    return { ...resolved, opened: true, surface: 'code', rootPath: target.rootPath, filePath: target.filePath.replace(/\\/g, '/') };
  },
  'builtin:todo-write': async () => {
    throw new Error('todo_write requires an active chat run.');
  },
  'builtin:generate-image': async ({ prompt, provider }, signal) => providers.generateImage({ prompt: String(prompt) }, typeof provider === 'string' ? provider : undefined, signal),
  'builtin:run-code': async ({ code, language }, signal) => codeInterpreter.execute({ code: String(code), ...(typeof language === 'string' ? { language } : {}) }, signal),
  'builtin:memory-search': async ({ query, limit }) => ({
    memories: memory.recall(typeof query === 'string' ? query : undefined, typeof limit === 'number' ? limit : undefined).memories.map((fact) => ({
      id: fact.id,
      content: fact.content,
      path: 'memory/facts.jsonl',
    })),
  }),
  'builtin:memory-remember': async ({ content, conversationId }) => ({ memory: memory.remember({ content: String(content), ...(typeof conversationId === 'string' ? { conversationId } : {}) }) }),
  'builtin:memory-update': async ({ id, content }) => {
    const updated = memory.update(String(id), String(content));
    if (!updated) throw new Error('Unknown memory id.');
    return { memory: updated };
  },
  'builtin:memory-forget': async ({ id }) => ({ forgotten: memory.forget(String(id)) }),
});
async function completeProviderText(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], model: string, signal: AbortSignal): Promise<string> {
  const connection = providers.default();
  const runId = crypto.randomUUID();
  let text = '';
  for await (const event of connection.stream({ runId, model: model || connection.capabilities().models[0] || 'local-replay', messages }, signal)) {
    if (event.type === 'text-delta') text += event.payload.text;
  }
  if (!text.trim()) throw new Error('The model returned no text.');
  return text;
}
async function runLabGadgetTool(gadgetId: string, text: string, instructions: string, signal: AbortSignal) {
  if (!text.trim()) throw new Error('Supply the source text to process.');
  if (text.length > LAB_SOURCE_LIMIT) throw new Error(`The source exceeds ${LAB_SOURCE_LIMIT} characters. Select a smaller section; no text was truncated.`);
  const gadget = loadLabGadgets().find((item) => item.id === gadgetId);
  if (!gadget) throw new Error('Unknown Lab review app.');
  const model = providers.default().capabilities().models[0] || 'local-replay';
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: gadgetSystemPrompt(gadgetId) }];
  const passes: string[] = [];
  for (const [index, basePrompt] of gadget.prompts.entries()) {
    const filename = gadgetId === 'meta-evaluation' ? metaEvaluationReferenceFile(index) : null;
    const prompt = buildGadgetPassPrompt({
      gadgetId,
      basePrompt,
      passIndex: index,
      text,
      instructions: typeof instructions === 'string' ? instructions : '',
      ...(filename ? { referenceText: readLabFrameworkText(filename) } : {}),
    });
    messages.push({ role: 'user', content: prompt });
    const output = await completeProviderText(messages, model, signal);
    messages.push({ role: 'assistant', content: output });
    passes.push(output);
  }
  return { gadget: gadgetId, name: gadget.name, passes, humanVerification: 'pending', summary: passes.join('\n\n-----\n\n') };
}
for (const definition of labGadgetToolDefinitions(loadLabGadgets())) {
  const existing = tools.definitions().find((item) => item.id === definition.id);
  tools.saveDefinition(existing ? { ...definition, enabled: existing.enabled } : definition);
  const gadgetId = definition.id.replace(/^builtin:lab-/, '');
  tools.setHandler(definition.id, async (input, signal) => runLabGadgetTool(gadgetId, String(input.text ?? ''), String(input.instructions ?? ''), signal));
}
registerLemonadeToolConnection(tools, lemonadeDescriptor);
/** Starts Lemonade through the Electron host control bridge or the browser-dev supervisor. */
function syncProvidersFromRuntime(): void {
  providers = configuredProviders();
}

async function ensureLemonadeRuntime(): Promise<typeof lemonadeDescriptor> {
  if (lemonadeDescriptor) {
    // Lazy start used to set the descriptor without rebuilding providers, so
    // managed-local stayed missing and the composer kept showing Unavailable.
    if (!providers.get(managedLemonadeProviderId)) syncProvidersFromRuntime();
    return lemonadeDescriptor;
  }
  if (Bun.env.OFFICE_DEV_LAZY_LEMONADE !== '1' || demoMode) return null;
  lemonadeEnsure ??= (async () => {
    const hostControl = Bun.env.OFFICE_HOST_CONTROL_URL;
    const hostToken = Bun.env.OFFICE_HOST_CONTROL_TOKEN;
    const startUrl = hostControl
      ? new URL('/lemonade/start', hostControl).href
      : `${DEV_SUPERVISOR_BASE}/lemonade/start`;
    const response = await fetch(startUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      ...(hostToken ? { headers: { 'x-air-host-token': hostToken } } : {}),
    });
    const body = await response.json().catch(() => null) as { environment?: Record<string, unknown>; error?: unknown } | null;
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The local AI runtime could not be started.');
    const environment = body?.environment && typeof body.environment === 'object' ? body.environment : null;
    if (!environment || typeof environment.OFFICE_LEMONADE_BASE_ORIGIN !== 'string') throw new Error('The local AI runtime did not return a usable address.');
    for (const [key, value] of Object.entries(environment)) {
      if (typeof value === 'string') Bun.env[key] = value;
    }
    lemonadeDescriptor = lemonadeDescriptorFromEnv();
    registerLemonadeToolConnection(tools, lemonadeDescriptor);
    syncProvidersFromRuntime();
    console.info(`Local AI ready at ${Bun.env.OFFICE_LEMONADE_BASE_ORIGIN}`);
    return lemonadeDescriptor;
  })().catch((error) => {
    console.warn(`Local AI unavailable: ${error instanceof Error ? error.message : 'Local AI could not start.'}`);
    return null;
  }).finally(() => { lemonadeEnsure = null; });
  return lemonadeEnsure;
}
// Demo / OFFICE_CREDENTIALS=environment runs without the native keychain helper.
// MCP OAuth still prefers the keychain when present, but absence must resolve to
// null — otherwise loopback Demo discover fails with a sanitized 502.
const toolCredentialResolve = async (id: string): Promise<string | null> => {
  if (demoMode || Bun.env.OFFICE_CREDENTIALS === 'environment') {
    try { return await keychain.resolve(id); }
    catch { return environment.resolve(id); }
  }
  return keychain.resolve(id);
};
const mcpOAuth = createMcpOAuthService({
  connection: (id) => id === LEMONADE_TOOL_CONNECTION_ID ? undefined : tools.connections().find((item) => item.id === id),
  redirectUrl: `http://127.0.0.1:${port}${MCP_OAUTH_CALLBACK_PATH}`,
  credentials: {
    resolve: (id) => toolCredentialResolve(id),
    store: (id, secret) => credentialStore.store(id, secret),
    forget: (id) => credentialStore.forget(id),
    forgetAll: () => credentialStore.forgetAll()
  }
});
const mcpOAuthRoutes = createMcpOAuthRoutes(mcpOAuth);
const remoteTools = createRemoteToolConnector({
  credentials: async (connectionId, endpoint) => {
    if (connectionId === LEMONADE_TOOL_CONNECTION_ID) return await lemonadeDescriptor?.resolveSecret() ?? null;
    const connection = tools.connections().find((item) => item.id === connectionId);
    if (endpoint !== undefined && connection?.endpoint !== endpoint) throw new Error('This tool connection changed. Discover its tools again.');
    return (connection?.kind === 'mcp' ? await mcpOAuth.accessToken(connectionId) : null) ?? await toolCredentialResolve(connectionId);
  },
  refreshCredentials: (connectionId, rejectedToken) => mcpOAuth.accessToken(connectionId, rejectedToken)
});
const localTools = createLocalToolConnector({
  installationDirectory: join(runtimeRoot, 'local-mcp'),
  credentials: (connectionId) => toolCredentialResolve(connectionId),
  nodeExecutable: Bun.env.OFFICE_MCP_NODE_EXECUTABLE,
  npmCliPath: Bun.env.OFFICE_MCP_NPM_CLI_PATH
});
const localMcpRoutes = createLocalMcpRoutes(tools, localTools);
const remoteToolRestoration = new Map<string, Promise<ReadonlySet<string>>>();
async function ensureRemoteToolHandler(definition: import('@office/contracts/tool').ToolDefinition): Promise<void> {
  const connection = tools.connections().find((item) => item.id === definition.connectionId);
  if (!connection || !connection.enabled) throw new Error('The tool connection is turned off.');
  if (connection.kind === 'builtin') return;
  if (connection.local) {
    if (!localTools.status(connection).running) throw new Error('Start this local MCP connection from Tools settings before using it.');
    return;
  }
  let restore = remoteToolRestoration.get(connection.id);
  if (!restore) {
    restore = (async () => {
      const discovered = constrainLemonadeTools(connection, await remoteTools.discover(connection), localInference);
      if (remoteToolRestoration.get(connection.id) !== restore) throw new Error('The tool connection changed while it was being prepared. Try again.');
      const saved = tools.definitions(true).filter((tool) => tool.connectionId === connection.id);
      const matches = discovered.filter(({ definition: actual }) => saved.some((expected) => expected.id === actual.id && expected.name === actual.name && expected.effect === actual.effect && JSON.stringify(expected.inputSchema) === JSON.stringify(actual.inputSchema)));
      remoteTools.install(matches, (id, handler) => tools.setHandler(id, handler));
      return new Set(matches.map(({ definition: actual }) => actual.id));
    })();
    remoteToolRestoration.set(connection.id, restore);
  }
  try {
    const restoredIds = await restore;
    const current = tools.definitions(true).find((tool) => tool.id === definition.id);
    if (!restoredIds.has(definition.id) || !current || current.name !== definition.name || current.effect !== definition.effect || JSON.stringify(current.inputSchema) !== JSON.stringify(definition.inputSchema)) throw new Error('This connected tool has changed. Discover it again and review its fields before using it.');
  }
  catch (error) { if (remoteToolRestoration.get(connection.id) === restore) remoteToolRestoration.delete(connection.id); throw error; }
}
const calendarStore = createVaultCalendarStore(vaultRoot);
tools.setHandler('builtin:calendar-list', async (input) => listCalendarEvents({
  events: calendarStore.events(),
  pathForCalendarId: calendarPathForListId,
  ...(typeof input.from === 'string' ? { from: input.from } : {}),
  ...(typeof input.to === 'string' ? { to: input.to } : {}),
  ...(typeof input.calendarPath === 'string' ? { calendarPath: input.calendarPath } : {}),
  ...(input.limit !== undefined ? { limit: Number(input.limit) } : {}),
}));
const automations = createAutomationsService(
  createVaultAutomationStore({ vaultRoot, occurrencesPath: join(vaultRoot, '.air', 'runtime', 'automations.sqlite') }),
  jobs,
  {
    run: async (step, signal, context) => {
      if (step.kind === 'calendar-event' || step.kind === 'chat-message') return writeAutomationOutput(step, context, calendarStore, conversations);
      if (step.kind === 'action') {
        const slug = actionSlugFromPath(step.actionPath);
        const action = step.definition ?? availableActions().find((item) => item.id === slug || actionRelative(item.id) === step.actionPath || packActionRelative(item.id) === step.actionPath || item.id === step.actionPath);
        const connection = providers.get(step.providerId);
        if (!action) throw new Error('This action is no longer available.');
        if (!connection) throw new Error('This model connection is no longer available.');
        const result = await executeAction(action.id, step.source, step.instructions, signal, { connection, model: step.modelId, definition: action });
        return result.summary;
      }
      if (step.kind === 'tool') {
        const definition = tools.definitions().find((item) => item.id === step.toolId);
        if (!definition) throw new Error('This tool is no longer available.');
        await ensureRemoteToolHandler(definition);
        const result = await tools.invoke(step.toolId, step.input, signal);
        if (result.status !== 'succeeded') throw new Error(result.error ?? 'The tool step failed.');
        return result.result;
      }
      await refreshModelReferenceRegistry();
      const reference = resolveScheduledModel(step);
      const connection = reference ? providers.get(reference.providerId) : step.providerId ? providers.get(step.providerId) : providers.default();
      if (!reference || !connection) throw new Error('Choose an available model for this scheduled prompt.');
      const result: string[] = [];
      const runId = crypto.randomUUID();
      for await (const event of connection.stream({ runId, model: reference.modelId, messages: [{ role: 'user', content: step.prompt }] }, signal)) {
        if (event.type === 'text-delta') result.push(event.payload.text);
        if (event.type === 'failure') throw new Error(event.payload.message);
        if (event.type === 'completion' && event.payload.reason === 'cancelled') throw new Error('The scheduled prompt was cancelled.');
      }
      return result.join('');
    }
  }
);
function modelIsUnassigned(providerId?: string, modelId?: string): boolean {
  return providerId === 'unassigned' || modelId === 'unassigned' || !providerId || !modelId;
}

function validateScheduledDefinition(definition: AutomationDefinition, calendarPaths: Set<string>, confirmed: boolean) {
  for (const step of definition.steps) {
    if (step.kind === 'action') {
      const slug = actionSlugFromPath(step.actionPath);
      if (!step.definition && !availableActions().some((item) => item.id === slug || actionRelative(item.id) === step.actionPath || packActionRelative(item.id) === step.actionPath || item.id === step.actionPath)) throw new Error('Choose an available action.');
      // Unassigned models are chosen later in Actions or chat, not when a craft is enabled.
      if (!modelIsUnassigned(step.providerId, step.modelId) && (!providers.get(step.providerId) || !resolveScheduledModel({ kind: 'prompt', prompt: '', modelReference: { providerId: step.providerId, modelId: step.modelId, role: 'chat' } }))) throw new Error('Choose an available model.');
    }
    if (step.kind === 'prompt') {
      if (modelIsUnassigned(step.providerId, step.modelId) && !step.modelReference) continue;
      const reference = resolveScheduledModel(step);
      if (!reference) throw new Error('Choose a model for each scheduled prompt.');
      if (reference && !providers.get(reference.providerId)) throw new Error('Choose an available provider.');
      if (!reference && step.providerId && !providers.get(step.providerId)) throw new Error('Choose an available provider.');
    }
    if (step.kind === 'calendar-event' && !calendarPaths.has(step.calendarPath)) throw new Error('Choose an existing result calendar.');
    if (step.kind === 'chat-message') {
      const conversationId = conversationIdFromPath(step.conversationPath) ?? step.conversationPath;
      if (!conversations.load(conversationId)) throw new Error('Choose an existing result chat.');
    }
    if (step.kind === 'tool' && definition.enabled) {
      const selected = tools.definitions(true).find((tool) => tool.id === step.toolId);
      if (!selected || !validateToolArguments(selected.inputSchema, step.input)) throw new Error('Choose an enabled tool and provide inputs that match its fields.');
      if (selected.effect === 'mutate' && !confirmed) throw new Error('This schedule may change data when it runs. Confirm that you want to allow it.');
    }
  }
}
function calendarPathSet() {
  return new Set(calendarStore.lists().map((list) => calendarPathForListId(list.id)));
}
const calendarExchange = createCalendarExchange(calendarStore, automations, validateScheduledDefinition);
const crafts = createCraftService({
  store: craftStore, methods, automations,
  memoryEnabled: () => memory.enabled(),
  setMemoryEnabled: (enabled) => { memory.setEnabled(enabled); if (enabled && localEmbeddingsEnabled()) reasoning.resume(); else reasoning.interrupt(); },
  humanMarkEnabled: () => craftStore.list().some(item => item.package.id === 'the-human-mark' && item.enabled),
  hasHumanMarkSkill: () => methods.list().some(item => item.kind === 'skill' && item.value.id === 'lab-skill-the-human-mark'),
  bundledCompositionCrafts: loadBundledCompositionCraftPackages,
  validateAutomation: (definition, confirmed) => validateScheduledDefinition(definition, calendarPathSet(), confirmed),
  action: (pathOrId) => {
    const slug = actionSlugFromPath(pathOrId) ?? pathOrId;
    const action = availableActions().find((item) => item.id === slug || actionRelative(item.id) === pathOrId || packActionRelative(item.id) === pathOrId || item.id === pathOrId);
    return action ? { name: action.name, system: action.system, runPrompts: action.runPrompts } : null;
  },
  resources: () => {
    const connections = tools.connections();
    const resources: CraftResource[] = [
      ...modelReferenceRegistry().filter(item => item.roles.includes('chat') || item.roles.includes('background')).map(item => ({ kind: 'model' as const, id: JSON.stringify([item.providerId, item.modelId]), label: `${item.modelId} (${item.providerId})`, available: providers.get(item.providerId) !== null && providers.get(item.providerId) !== undefined, model: { providerId: item.providerId, modelId: item.modelId } })),
      { kind: 'embedding', id: 'workspace.embedding', label: embeddingSelection.selection()?.model ?? 'Choose an embedding model in Settings', available: embeddingSelection.selection() !== null },
      ...tools.definitions().map(item => ({ kind: 'tool' as const, id: item.id, label: item.name, available: item.enabled && connections.some(connection => connection.id === item.connectionId && connection.enabled), connectionId: item.connectionId, effect: item.effect })),
      ...connections.filter(item => item.kind === 'mcp').map(item => ({ kind: 'mcp' as const, id: item.id, label: item.name, available: item.enabled })),
      ...knowledge.collections().filter(item => item.id !== REASONING_COLLECTION_ID).map(item => ({ kind: 'knowledge' as const, id: item.id, label: item.name, available: true })),
      ...calendarStore.lists().map(item => ({ kind: 'calendar' as const, id: calendarPathForListId(item.id), label: item.name, available: true })),
      ...conversations.summaries(200, 0).map(item => ({ kind: 'conversation' as const, id: defaultConversationPath(item.id), label: item.title, available: true })),
    ];
    return resources;
  },
});
const craftRoutes = createCraftRoutes(crafts, refreshModelReferenceRegistry);
tools.setHandler('builtin:schedule-run', async ({ path }) => {
  const relative = String(path ?? '');
  const occurrence = await automations.runNow(relative);
  return { occurrence, job: occurrence.jobId ? jobs.get(occurrence.jobId) : null, path: relative };
});
tools.setHandler('builtin:action-run', async ({ path, source, instructions }, signal) => {
  const relative = String(path ?? '');
  const action = toVaultLabAppDescriptor(readVaultActionByPath(vaultRoot, relative), (filename) => readLabFrameworkText(filename));
  return executeAction(action.id, String(source), typeof instructions === 'string' ? instructions : '', signal, {
    definition: { name: action.name, system: action.system, runPrompts: action.runPrompts },
  });
});
ensurePackActionsSeeded(vaultRoot, loadLabGadgets());
const automationTimer = setInterval(() => { void automations.tick().catch(() => undefined); }, 15_000);
void automations.tick().catch(() => undefined);
const fileRoute = (code: FileErrorCode, message: string) => Response.json({ error: { code, message } }, { status: fileErrorStatus[code] });
/** Logs route-level operation outcomes only. It never logs file content or credentials. */
const logOperation = (operation: string, outcome: string) => console.info(JSON.stringify({ component: 'files', operation, outcome }));

const OUTPUT_BLOCK_KINDS = new Set(['text', 'reasoning', 'tool', 'image']);
const OUTPUT_BLOCK_STATES = new Set(['pending', 'running', 'ok', 'error']);
const ATTACHMENT_KINDS = new Set(['file', 'note', 'collection', 'url', 'chat']);

/**
 * Validates the structured half of a message: model identity, output blocks,
 * status history, usage, error and file references. Returns the parsed fields
 * or an error string, so a caller answers with a plain message rather than
 * letting malformed history reach storage.
 */
const parseStructuredMessageFields = (body: Record<string, unknown>): { error: string } | { fields: {
  modelId?: string | null; modelIndex?: number; output?: OutputBlock[]; statusHistory?: MessageStatusEntry[]; usage?: MessageUsage | null; error?: MessageError | null; files?: string[]; attachments?: MessageAttachment[];
} } => {
  const fields: Record<string, unknown> = {};
  if (body.modelId !== undefined) {
    if (body.modelId !== null && typeof body.modelId !== 'string') return { error: 'Invalid model identifier' };
    fields.modelId = body.modelId;
  }
  if (body.modelIndex !== undefined) {
    if (typeof body.modelIndex !== 'number' || !Number.isSafeInteger(body.modelIndex) || body.modelIndex < 0 || body.modelIndex > 32) return { error: 'Invalid model index' };
    fields.modelIndex = body.modelIndex;
  }
  if (body.output !== undefined) {
    if (!Array.isArray(body.output) || body.output.length > 500) return { error: 'Output must be a list of at most 500 blocks' };
    const blocks: OutputBlock[] = [];
    for (const raw of body.output) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Each output block must be an object' };
      const block = raw as Record<string, unknown>;
      if (typeof block.kind !== 'string' || !OUTPUT_BLOCK_KINDS.has(block.kind)) return { error: 'Unknown output block kind' };
      const parsed: OutputBlock = { kind: block.kind as OutputBlock['kind'] };
      if (block.text !== undefined && (typeof block.text !== 'string' || block.text.length > 400_000)) return { error: 'Output block text is too long' };
      if (typeof block.text === 'string') parsed.text = block.text;
      if (typeof block.toolCallId === 'string') parsed.toolCallId = block.toolCallId;
      if (typeof block.name === 'string') parsed.name = block.name;
      if (block.arguments !== undefined && (typeof block.arguments !== 'object' || block.arguments === null || Array.isArray(block.arguments))) return { error: 'Tool block arguments must be an object' };
      if (block.arguments !== undefined) parsed.arguments = block.arguments as Record<string, unknown>;
      if (block.result !== undefined) parsed.result = block.result;
      if (block.status !== undefined) {
        if (typeof block.status !== 'string' || !OUTPUT_BLOCK_STATES.has(block.status)) return { error: 'Unknown output block state' };
        parsed.status = block.status as OutputBlock['status'];
      }
      if (typeof block.message === 'string') parsed.message = block.message;
      if (typeof block.sourceId === 'string') parsed.sourceId = block.sourceId;
      if (typeof block.mimeType === 'string') parsed.mimeType = block.mimeType;
      // assistant-ui shows "Thought for Ns" only when the host keeps these times.
      if (typeof block.startedAt === 'string' && block.startedAt.length <= 64) parsed.startedAt = block.startedAt;
      if (typeof block.completedAt === 'string' && block.completedAt.length <= 64) parsed.completedAt = block.completedAt;
      blocks.push(parsed);
    }
    fields.output = blocks;
  }
  if (body.statusHistory !== undefined) {
    if (!Array.isArray(body.statusHistory) || body.statusHistory.length > 200) return { error: 'Status history must be a list of at most 200 entries' };
    const entries: MessageStatusEntry[] = [];
    for (const raw of body.statusHistory) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Each status entry must be an object' };
      const entry = raw as Record<string, unknown>;
      if (typeof entry.at !== 'string' || typeof entry.label !== 'string' || entry.label.length > 200 || (entry.state !== 'running' && entry.state !== 'ok' && entry.state !== 'error')) return { error: 'Invalid status entry' };
      entries.push({ at: entry.at, label: entry.label, state: entry.state, ...(typeof entry.detail === 'string' ? { detail: entry.detail } : {}) });
    }
    fields.statusHistory = entries;
  }
  if (body.usage !== undefined && body.usage !== null) {
    const usage = body.usage as Record<string, unknown>;
    if (typeof usage !== 'object' || usage === null || Array.isArray(usage) || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number' || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) || usage.inputTokens < 0 || usage.outputTokens < 0) return { error: 'Invalid usage counters' };
    fields.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  } else if (body.usage !== undefined) fields.usage = null;
  if (body.error !== undefined && body.error !== null) {
    const failure = body.error as Record<string, unknown>;
    if (typeof failure !== 'object' || failure === null || Array.isArray(failure) || typeof failure.code !== 'string' || typeof failure.message !== 'string') return { error: 'Invalid error record' };
    fields.error = { code: failure.code, message: failure.message, ...(failure.retryable === true ? { retryable: true } : {}) };
  } else if (body.error !== undefined) fields.error = null;
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || body.files.length > 200 || body.files.some((file) => typeof file !== 'string' || file.length > 500)) return { error: 'Invalid file references' };
    fields.files = body.files as string[];
  }
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments) || body.attachments.length > 50) return { error: 'Too many attachments' };
    const attachments: MessageAttachment[] = [];
    for (const raw of body.attachments) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'Each attachment must be an object' };
      const attachment = raw as Record<string, unknown>;
      if (typeof attachment.id !== 'string' || typeof attachment.label !== 'string' || typeof attachment.kind !== 'string' || !ATTACHMENT_KINDS.has(attachment.kind)) return { error: 'Invalid attachment' };
      attachments.push({ id: attachment.id, kind: attachment.kind as MessageAttachment['kind'], label: attachment.label, ...(typeof attachment.version === 'string' ? { version: attachment.version } : {}) });
    }
    fields.attachments = attachments;
  }
  return { fields };
};

/**
 * Narrows optional bundle fields back to store types on import. The exporter
 * already whitelists each field on write; this keeps an imported row inside the
 * same shape if the bundle came from another source.
 */
const toOutputBlocks = (value: unknown): OutputBlock[] => Array.isArray(value)
  ? value.filter((block): block is OutputBlock => typeof block === 'object' && block !== null && typeof (block as Record<string, unknown>).kind === 'string' && OUTPUT_BLOCK_KINDS.has((block as Record<string, unknown>).kind as string))
  : [];

const toStatusHistory = (value: unknown): MessageStatusEntry[] => Array.isArray(value)
  ? value.filter((entry): entry is MessageStatusEntry => typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).at === 'string' && typeof (entry as Record<string, unknown>).label === 'string')
  : [];

const toAttachments = (value: unknown): MessageAttachment[] => Array.isArray(value)
  ? value.filter((item): item is MessageAttachment => typeof item === 'object' && item !== null && ATTACHMENT_KINDS.has(String((item as Record<string, unknown>).kind)))
  : [];

const toStringList = (value: unknown, max: number): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : [];
const reasoning = createReasoningComposition({
  privateRoot, vaultRoot, conversations, memory, knowledge: () => knowledge, jobs,
  embeddingReady: () => embeddingSelection.selection() !== null && localEmbeddingsEnabled(),
  embedding: async (text, signal) => { const vectors = await embeddingSelection.snapshot().provider.embed([text], signal); if (!vectors[0]) throw new Error('No query embedding was returned.'); return vectors[0]; },
  inputTokenLimit: () => embeddingSelection.selection()?.inputTokenLimit ?? 512,
  rerank: async (query, records, signal): Promise<import('@office/memory/service').MemoryRanking> => {
    const ids = records.map(record => record.record_id);
    const selection = embeddingSelection.selection();
    if (!selection?.rerankModel) return { ids, method: 'embedding', reason: 'not-configured' };
    if (!lemonadeDescriptor || !modelReferenceRegistry().some(model => model.modelId === selection.rerankModel && model.providerId === managedLemonadeProviderId && model.roles.includes('rerank'))) return { ids, method: 'embedding', reason: 'unavailable' };
    const documents = records.map(episodicProjection);
    const byteLimit = (selection.rerankTokenLimit ?? 512) - 32;
    if (documents.some(document => new TextEncoder().encode(query + '\n' + document).byteLength > byteLimit)) return { ids, method: 'embedding', reason: 'input-limit' };
    try {
      const result = await new LemonadeModalityAdapter(lemonadeDescriptor).rerank({ model: selection.rerankModel, query, documents }, { signal });
      return { ids: applyReranking(records, result.results).map(record => record.record_id), method: 'reranker' };
    } catch (error) { if (signal?.aborted) throw error; return { ids, method: 'embedding', reason: 'failed' }; }
  },
  foregroundBusy: () => active.size > 0 || !localEmbeddingsEnabled(),
});
if (!localEmbeddingsEnabled()) reasoning.interrupt();
const recallMemory = async (input: Record<string, unknown>, scope?: { conversationId: string; leafId: string }, signal?: AbortSignal) => ({
  ...memory.recall(typeof input.query === 'string' ? input.query : undefined, Math.min(typeof input.limit === 'number' ? input.limit : 6, 6)),
  exchanges: await reasoning.search(typeof input.query === 'string' ? input.query : '', Math.min(typeof input.limit === 'number' ? input.limit : 3, 3), scope, signal, scope ? conversations.load(scope.conversationId)?.messages.find(message => message.id === scope.leafId && message.role === 'user')?.content : undefined),
});
tools.setHandler('builtin:memory-search', (input, signal) => {
  // Local AI may come online after boot interrupted reasoning; resume before search.
  if (memory.enabled() && localEmbeddingsEnabled()) reasoning.resume();
  return recallMemory(input, undefined, signal).then((result) => ({
    ...result,
    memories: result.memories.map((fact) => ({ id: fact.id, content: fact.content, path: 'memory/facts.jsonl' })),
  }));
});
function scheduleReasoning(conversationId: string, leafId?: string) {
  const graph = conversations.load(conversationId);
  const leaf = leafId ?? (graph ? activeLeaf(graph) : null);
  if (leaf) reasoning.schedule(conversationId, leaf);

}
const reasoningTimer = setInterval(() => { void reasoning.drain(); }, 3000);
reasoningTimer.unref();
/** Jobs currently indexing, so a second request for the same unit is refused rather than duplicated. */
const activeIndexing = new Set<string>();
/** Per-job cancellation flags checked between embedding batches. */
const indexCancellations = new Map<string, Set<string>>();

/**
 * Indexes one stored source version into its collection, without a user action.
 *
 * A document that lives in a collection is there to be found. A full-text
 * search reaches it once its text is stored, and the vector index reaches it
 * once the embedding model is selected. The index is built in the background,
 * so the document is usable immediately and the vectors arrive after.
 *
 * The decision is recorded on the job, so a document that was not indexed
 * says why rather than silently staying invisible.
 */
function autoIndexVersion(input: { collectionId: string | null | undefined; versionId: string; content: string }): void {
  if (!localEmbeddingsEnabled()) return;
  // A stored extraction artifact is the richer source, so it is used when it
  // exists. A source that was submitted as plain text has no artifact yet,
  // and its own text is indexed instead.
  const stored = documents.artifact(input.versionId);
  const artifact: ExtractionArtifact = stored ?? { extractor: 'inline-text', extractorVersion: '1', extractionVersion: 'anchor-v1', text: input.content, pageCount: null, warnings: [], contentHash: '', createdAt: new Date().toISOString() };
  const decision = decideAutoIndex({
    collectionId: input.collectionId,
    hasText: artifact.text.trim().length > 0,
    collectionKnown: input.collectionId ? knowledge.collections().some((collection) => collection.id === input.collectionId) : false,
    embeddingAvailable: embeddingSelection.selection() !== null
  });
  if (!decision.index) return;
  const collectionId = input.collectionId!;
  const snapshot = embeddingSelection.snapshot();
  const started = jobs.start('index-source', `index:${collectionId}:${input.versionId}:${JSON.stringify(snapshot.identity)}`);
  if (activeIndexing.has(started.job.id)) return;
  activeIndexing.add(started.job.id);
  const cancelled = new Set<string>();
  indexCancellations.set(started.job.id, cancelled);
  void (async () => {
    try {
      await jobs.run(started.job.id, async (report) => {
        report(0.1, 'chunk');
        await snapshot.knowledge.indexSourceVersion({
          collectionId,
          sourceVersionId: input.versionId,
          artifact,
          isCancelled: () => cancelled.has(started.job.id),
          report: (progress, checkpoint) => report(0.1 + progress * 0.9, checkpoint)
        });
      });
    } catch (error) {
      const current = jobs.get(started.job.id);
      if (current && !['succeeded', 'failed', 'cancelled'].includes(current.state)) jobs.transition(started.job.id, cancelled.has(started.job.id) ? 'cancelled' : 'failed', error instanceof Error ? error.message : 'Indexing failed.');
    } finally { activeIndexing.delete(started.job.id); indexCancellations.delete(started.job.id); }
  })();
}
/**
 * Asks the managed runtime how wide the vectors of an embedding model are.
 *
 * The width is part of the index identity, so an index built with the wrong
 * width can never be read. When the runtime cannot answer yet (common right
 * after a download), known models fall back to their documented width.
 */
const probeEmbeddingDimensions = async (model: string): Promise<number | null> => {
  if (lemonadeDescriptor) {
    try {
      const result = await new LemonadeModalityAdapter(lemonadeDescriptor).embeddings({ model, input: ['Embedding dimension check.'] });
      const vector = result.data[0]?.embedding;
      if (Array.isArray(vector) && vector.length > 0 && vector.length <= 65536 && vector.every((value) => Number.isFinite(value))) return vector.length;
    } catch { /* fall through to documented width */ }
  }
  return documentedEmbeddingDimensions(model);
};

/**
 * Indexes every stored document that belongs to a collection and has not been
 * indexed yet.
 *
 * The documents in a collection are there to be found, so they are indexed
 * without a user action. A document that was stored before an embedding model
 * was selected is indexed now, because the model that makes it reachable
 * exists now.
 */
/**
 * Adopts an embedding model when none is selected but one is already installed.
 *
 * Collections and memory search wait on this selection. Preferring the stored
 * workspace default, then the preferred Quick Start model, keeps indexing
 * working without asking the user to press Save again after every restart.
 */
async function ensureEmbeddingSelection(): Promise<boolean> {
  if (embeddingSelection.selection()) return true;
  if (!localInference.enabled() && Bun.env.OFFICE_KNOWLEDGE_EMBEDDING_MODE !== 'demo' && Bun.env.NODE_ENV !== 'test') return false;
  // Desktop keeps Lemonade stopped until first use. Start it before probing
  // dimensions or adopting a downloaded embedding model.
  if (Bun.env.OFFICE_KNOWLEDGE_EMBEDDING_MODE !== 'demo' && Bun.env.NODE_ENV !== 'test') await ensureLemonadeRuntime();
  const registry = await refreshModelReferenceRegistry();
  const installed = registry.filter((entry) => entry.providerId === managedLemonadeProviderId && entry.roles.includes('embedding'));
  if (installed.length === 0) return false;
  const defaults = workspaceDefaults.read();
  const proposed = proposeWorkspaceDefaults({ registry: installed, current: defaults }).embedding;
  const model = (defaults.embeddingModel && installed.some((entry) => entry.modelId === defaults.embeddingModel) ? defaults.embeddingModel : null)
    ?? proposed?.modelId
    ?? null;
  if (!model) return false;
  const revision = (defaults.embeddingModel === model ? defaults.embeddingRevision : null) ?? model;
  const dimensions = (defaults.embeddingModel === model ? defaults.embeddingDimensions : null) ?? await probeEmbeddingDimensions(model);
  if (!revision || !dimensions) return false;
  try {
    knowledge = embeddingSelection.select({ model, revision, dimensions, mode: 'runtime' }).knowledge;
    applyWorkspaceDefaults(workspaceDefaults, {
      embedding: { providerId: managedLemonadeProviderId, modelId: model, roles: ['embedding'], reason: 'preferred-embedding-model' },
      embeddingRevision: revision,
      embeddingDimensions: dimensions
    });
    return true;
  } catch {
    return false;
  }
}

function autoIndexPendingCollections(): void {
  if (!embeddingSelection.selection() || !localEmbeddingsEnabled()) return;
  for (const collection of knowledge.collections()) {
    if (collection.id === REASONING_COLLECTION_ID) continue;
    // A collection whose index was built with another model is rebuilt as a
    // whole, because a single source cannot replace a generation.
    if (knowledge.indexStatus(collection.id).rebuildRequired) { rebuildCollectionInBackground(collection.id); continue; }
    for (const document of documents.documents(collection.id)) {
      for (const version of documents.versions(document.id)) {
        const artifact = documents.artifact(version.id);
        if (!artifact || !artifact.text.trim()) continue;
        // A source that is already indexed under the current generation is
        // left alone. Re-embedding it on every restart would cost the user
        // minutes of local compute for an index that already exists.
        if (knowledge.isSourceIndexed(collection.id, version.id)) continue;
        autoIndexVersion({ collectionId: collection.id, versionId: version.id, content: artifact.text });
      }
    }
  }
}

/**
 * Rebuilds the index of a collection in the background.
 *
 * A rebuild replaces the whole generation of a collection, so it is used when
 * the embedding model changed and the sources are already extracted.
 */
function rebuildCollectionInBackground(collectionId: string): void {
  const versions = documents.documents(collectionId).flatMap((document) => documents.versions(document.id));
  const sources = versions.flatMap((version) => { const artifact = documents.artifact(version.id); return artifact ? [{ sourceVersionId: version.id, artifact }] : []; });
  if (sources.length === 0) return;
  const snapshot = embeddingSelection.snapshot();
  const started = jobs.start('rebuild-collection', `rebuild:${collectionId}:${crypto.randomUUID()}`);
  const cancelled = new Set<string>(); indexCancellations.set(started.job.id, cancelled); activeIndexing.add(started.job.id);
  void jobs.run(started.job.id, async (report) => {
    await snapshot.knowledge.rebuildCollection({ collectionId, sources, report, isCancelled: () => cancelled.has(started.job.id) });
  }).catch(() => undefined).finally(() => { activeIndexing.delete(started.job.id); indexCancellations.delete(started.job.id); });
}

const tokenEqual = (provided: string) => {
  const expected = Buffer.from(bootstrapToken);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
function projectRun(runId: string, event: ChatEventEnvelope) {
  const run = store.get(runId);
  const target = run?.request.conversation;
  if (!run || !target) return;
  const message = conversations.load(target.id)?.messages.find((item) => item.id === target.assistantMessageId);
  if (!message || message.runId !== runId) return;
  const projected = projectConversationRun(message, run.state, event, target.initialContent);
  conversations.updateMessage(target.id, message.id, projected);
  if (event.type === 'completion' && event.payload.reason === 'stop') scheduleReasoning(target.id, message.id);
  if (event.type === 'failure' || event.type === 'completion' && event.payload.reason !== 'tool') conversations.setMeta(target.id, { unreadAt: event.timestamp });
}
function appendRunEvent(event: ChatEventEnvelope) {
  store.append(event);
  projectRun(event.runId, event);
}
function recoverConversationRuns(id: string) {
  for (const message of conversations.load(id)?.messages ?? []) {
    if (!message.runId || message.complete || message.error || ['cancelled', 'length'].includes(message.statusHistory.at(-1)?.label ?? '')) continue;
    let cursor = -1;
    for (;;) {
      const events = store.events(message.runId, cursor);
      if (!events.length) break;
      for (const event of events) { projectRun(message.runId, event); cursor = event.sequence; }
    }
  }
}
const failRun = (runId: string, code: string, message: string) => {
  const run = store.get(runId);
  if (!run || run.status !== 'running') return;
  const sequence = run.state.lastSequence + 1;
  appendRunEvent({ protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${runId}:${sequence}`, runId, correlationId: runId, sequence, timestamp: new Date().toISOString(), type: 'failure', payload: { code, message, retryable: true } });
};
/**
 * Cross-origin policy for the loopback UI. The web app runs on a different port
 * than the service, so every authenticated response must carry the caller's
 * origin or the browser blocks it. Only loopback origins and the desktop
 * `air-office://` origin are allowed; any other origin receives no CORS header.
 * Preflight is answered here.
 */
const allowedOrigin = (request: Request): string | null => {
  return trustedServiceOrigin(request.headers.get('origin') ?? '');
};
const withCors = (response: Response, origin: string | null): Response => {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
const realtimeRelay = createRealtimeRelay({
  getDescriptor: getLemonadeDescriptor,
  authorize(request) { const authorization = request.headers.get('authorization') ?? ''; return authorization.startsWith('Bearer ') && tokenEqual(authorization.slice(7)); },
  allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173', ...desktopServiceOrigins, ...(Bun.env.OFFICE_WEB_ORIGIN ? [Bun.env.OFFICE_WEB_ORIGIN] : [])]
});
async function stopHostLemonadeRuntime(): Promise<void> {
  const hostControl = Bun.env.OFFICE_HOST_CONTROL_URL;
  const hostToken = Bun.env.OFFICE_HOST_CONTROL_TOKEN;
  if (!hostControl || !hostToken) return;
  try {
    await fetch(new URL('/lemonade/stop', hostControl), {
      method: 'POST',
      headers: { 'x-air-host-token': hostToken },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    /* host may already have stopped */
  }
  lemonadeDescriptor = null;
  delete Bun.env.OFFICE_LEMONADE_BASE_ORIGIN;
  delete Bun.env.OFFICE_LEMONADE_TOKEN;
  delete Bun.env.OFFICE_LEMONADE_MODE;
  syncProvidersFromRuntime();
}
const localAiPowerRoutes = createLocalAiPowerRoutes({
  control: localInference,
  getDescriptor: getLemonadeDescriptor,
  canStart: () => Bun.env.OFFICE_DEV_LAZY_LEMONADE === '1' && !demoMode,
  ensure: ensureLemonadeRuntime,
  owned: () => Bun.env.OFFICE_LEMONADE_MODE === 'embedded',
  onDisabled() {
    reasoning.interrupt();
    for (const [id, cancelled] of indexCancellations) cancelled.add(id);
    realtimeRelay.stopSessions();
    void stopHostLemonadeRuntime();
  },
  onEnabled() { if (memory.enabled()) reasoning.resume(); },
});
const server = Bun.serve<RealtimeRelayData>({ hostname: '127.0.0.1', port, maxRequestBodySize: 34_000_000, idleTimeout: 120, websocket: realtimeRelay.websocket, async fetch(request, upgradeServer) {
  const url = new URL(request.url);
  const origin = allowedOrigin(request);
  if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, last-event-id', 'Access-Control-Max-Age': '600' } }), origin);
  if (url.pathname === '/api/v1/local-ai/realtime') { const response = realtimeRelay.upgrade(request, upgradeServer); return response ? withCors(response, origin) : undefined; }
  const ticketResponse = await realtimeRelay.ticketRoute(request);
  if (ticketResponse) return withCors(ticketResponse, origin);
  return withCors(await route(request), origin);
} });
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health') return Response.json({ ready: true, demo: demoMode, protocol: 1, instanceId: Bun.env.OFFICE_SERVICE_INSTANCE_ID ?? null });
  if (url.pathname === '/bootstrap' && request.method === 'POST') {
    const origin = bootstrapRequestOrigin(request);
    if (!origin) return new Response('Forbidden', { status: 403 });
    return Response.json({ token: bootstrapToken, protocol: 1, serviceBase, demo: demoMode, lemonade: lemonadeBootstrapStatus() }, { headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === MCP_OAUTH_CALLBACK_PATH && request.method === 'GET') { server.timeout(request, 120); return mcpOAuthRoutes(request); }
  if (url.pathname === CHATGPT_SIGNIN_CALLBACK_PATH && request.method === 'GET') { server.timeout(request, 120); return chatgptSignInRoutes(request); }
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || !tokenEqual(authorization.slice(7))) return new Response('Unauthorized', { status: 401 });
  // Start Lemonade only for work that needs the runtime, not for power/status probes.
  if (
    (url.pathname.startsWith('/api/v1/local-ai/') && url.pathname !== '/api/v1/local-ai/power')
    || url.pathname === '/api/v1/model-catalog'
    || url.pathname === '/api/v1/knowledge/embedding-model'
    || url.pathname === '/api/v1/knowledge/embedding-probe'
    || url.pathname === '/api/v1/index'
  ) {
    await ensureLemonadeRuntime();
  }
  if (url.pathname.startsWith('/api/v1/cloud/chatgpt')) { server.timeout(request, 120); return chatgptSignInRoutes(request); }
  if (/^\/api\/v1\/tools\/connections\/[^/]+\/local\//.test(url.pathname)) { server.timeout(request, 150); return localMcpRoutes(request); }
  if (/^\/api\/v1\/tools\/connections\/[^/]+\/oauth\//.test(url.pathname)) { server.timeout(request, 120); return mcpOAuthRoutes(request); }
  if (url.pathname === '/api/v1/knowledge/embedding-model' && request.method === 'GET') {
    if (!embeddingSelection.selection() && await ensureEmbeddingSelection()) autoIndexPendingCollections();
    return Response.json({ ...(embeddingSelection.selection() ?? { model: '', revision: '', dimensions: 0, mode: 'runtime' }), configured: embeddingSelection.selection() !== null, runtimeAvailable: lemonadeDescriptor !== null });
  }
  if (/^\/api\/v1\/tools\/connections\/[^/]+\/discover$/.test(url.pathname) || url.pathname === '/api/v1/tools/invoke') server.timeout(request, 120);
  if (url.pathname.startsWith('/api/v1/model-connections')) server.timeout(request, 30);
  if (url.pathname === '/api/v1/bootstrap') return Response.json(bootstrap);
  if (url.pathname === '/api/v1/workbench/workspace' && request.method === 'POST') {
    // Start the workbench only when Code is opened, same idea as demo on demand.
    try {
      // User data lives under the private profile (writable), not next to
      // packaged resources — paths with spaces like "AIR Office" also require
      // spawning bundled node.exe instead of code-server.cmd (see workbench-process).
      const dataDir = join(privateRoot, 'code-server');
      const alreadyRunning = Boolean(workbenchLaunchFromEnvironment());
      if (!alreadyRunning) await ensureDevWorkbench(workbenchResourceRoot, dataDir);
      let launch = workbenchLaunchFromEnvironment();
      if (launch?.dataDir) {
        const shell = ensureWorkbenchShellExtension(workbenchResourceRoot, launch.dataDir);
        // A running code-server will not load a newly catalogued extension until restart.
        if (shell.needsRestart && alreadyRunning) {
          stopDevWorkbench();
          await ensureDevWorkbench(workbenchResourceRoot, dataDir);
          launch = workbenchLaunchFromEnvironment();
        }
      }
      if (!launch) return Response.json({ href: null, error: workbenchStartError() ?? 'Code is not available.' });
      const body = await request.json().catch(() => null) as { rootPath?: unknown; filePath?: unknown; appearance?: unknown } | null;
      const rootPath = typeof body?.rootPath === 'string' ? body.rootPath.trim() : '';
      const filePath = typeof body?.filePath === 'string' ? body.filePath : '';
      const connectedPaths = filesystem.roots().map((root) => root.path);
      // Optional folder only. Empty launch is a bare workbench. Connected folders may
      // open; the Library root is never mounted as the Code tree.
      let folders: string[] = [];
      let file: string | null = null;
      if (rootPath) {
        if (!workbenchRootAllowed(rootPath, copilotWorkdir, connectedPaths)) {
          return Response.json({ error: 'That folder is not available to Code.' }, { status: 403 });
        }
        folders = [rootPath];
        file = filePath ? fileInsideConnectedRoot(rootPath, filePath) : null;
        if (filePath && !file) return Response.json({ error: 'That file is outside the Code folder.' }, { status: 403 });
      }
      if (launch.dataDir) {
        applyWorkbenchAppearance(launch.dataDir, body?.appearance === 'light' ? 'light' : 'dark', {
          pythonInterpreter: pythonInterpreterPath(privateRoot),
          codeServerRoot: join(workbenchResourceRoot, 'code-server'),
        });
      }
      const href = workbenchWorkspaceHref({
        base: launch.base,
        folders,
        filePath: file,
        token: launch.token,
        dataDir: launch.dataDir
      });
      // Auth none: no login bootstrap / token handoff. Password mode still
      // returns token + bootstrap for older hosts that expect them.
      return Response.json({
        href,
        token: launch.token,
        ...(launch.token ? { bootstrap: workbenchLoginBootstrap(href, launch.token) } : {}),
        auth: launch.token ? 'password' : 'none',
        ...(folders[0] ? { folder: folders[0] } : {}),
        vaultRoot: copilotWorkdir,
      });
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : 'start failed';
      console.warn(JSON.stringify({ component: 'workbench', status: 'failed', error: detail }));
      return Response.json({ href: null, error: workbenchStartError() ?? (detail && detail !== 'start failed' ? detail : 'Code could not be opened.') });
    }
  }
  if (url.pathname === '/api/v1/documents/python' && request.method === 'GET') {
    return Response.json({ path: pythonInterpreterPath(privateRoot), workerAvailable: Boolean(extractionWorker) });
  }
  if (url.pathname === '/api/v1/documents/python' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { path?: unknown } | null;
    const interpreter = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!interpreter) return Response.json({ error: 'Provide a Python interpreter path.' }, { status: 400 });
    writePythonInterpreterPath(privateRoot, interpreter);
    Bun.env.OFFICE_PYTHON = interpreter;
    extractionWorker = await startExtractionWorker(interpreter);
    documents = createDocumentsService(documentStore, extractionWorker ?? undefined);
    return Response.json({ path: interpreter, workerAvailable: Boolean(extractionWorker) });
  }
  if (url.pathname === '/api/v1/data/starters' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
    if (body?.confirmed !== true) return Response.json({ error: 'Confirm restoring starter content.' }, { status: 409 });
    const reinstall = await seedLabPack({
      enabled: (Bun.env.OFFICE_LAB_PACK ?? 'true').toLowerCase() !== 'false',
      ledgerPath: defaultLabPackLedgerPath(privateRoot),
      methods: { get: (id) => methods.get(id), save: (definition) => methods.save(definition) },
      knowledge: labPackKnowledgeTarget,
      reinstall: true,
      knowledgeInBackground: true,
    });
    if (reinstall.errors.length) console.warn(JSON.stringify({ component: 'lab-pack', operation: 'restore-starters', errors: reinstall.errors }));
    void reinstall.knowledgeTask?.then(() => {
      if (reinstall.errors.length) console.warn(JSON.stringify({ component: 'lab-pack', operation: 'restore-starters', errors: reinstall.errors }));
    });
    return Response.json({
      methodsRestored: reinstall.methodsAdded.length,
      documentsRestored: reinstall.knowledgeAdded.length,
      documentsPending: true,
      errors: reinstall.errors,
    });
  }
  if (url.pathname === '/api/v1/data/workspace' && request.method === 'DELETE') {
    const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
    if (body?.confirmed !== true) return Response.json({ error: 'Confirm deleting all private workspace content.' }, { status: 409 });
    if (active.size || activeIndexing.size) return Response.json({ error: 'Finish active conversations or indexing before clearing workspace content.' }, { status: 409 });
    if (indexCancellations.size) return Response.json({ error: 'Finish active background operations before clearing workspace content.' }, { status: 409 });
    const conversationsDeleted = conversations.clearWorkspace();
    const documentsDeleted = documents.clearPersonalData();
    const collectionsDeleted = knowledge.clearPersonalData();
    const notesDeleted = richDocuments.clearAll();
    methods.clearAll();
    memory.clear();
    craftStore.clear();
    crafts.snapshot();
    reasoning.clear();
    jobs.clearPersonalData();
    automations.clearPersonalData();
    calendarStore.clearPersonalData();
    workspace.clearPersonalData();
    filesystem.clearPersonalData();
    toolStore.clearPersonalData();
    connectionSettings.clearPersonalData();
    const credentials = await credentialStore.forgetAll();
    const oauth = await mcpOAuth.clearAll();
    const chatgpt = await chatgptSignIn.clearAll();
    const credentialFailures = [...credentials.failed, ...oauth.failed, ...chatgpt.failed];
    // The shipped defaults are part of the product, not user data. The reset
    // removed them along with everything else, so they are installed again
    // from the packaged sources. The ledger is reinstalled with them, so a
    // second reset repeats the same outcome instead of skipping the seed.
    // The framework documents are extracted in the background, because
    // extracting the shipped PDFs takes seconds and the answer must not wait
    // for it.
    const reinstall = await seedLabPack({
      enabled: (Bun.env.OFFICE_LAB_PACK ?? 'true').toLowerCase() !== 'false',
      ledgerPath: defaultLabPackLedgerPath(privateRoot),
      methods: { get: (id) => methods.get(id), save: (definition) => methods.save(definition) },
      knowledge: labPackKnowledgeTarget,
      reinstall: true,
      knowledgeInBackground: true,
    });
    if (reinstall.errors.length) console.warn(JSON.stringify({ component: 'lab-pack', operation: 'reseed', errors: reinstall.errors }));
    void reinstall.knowledgeTask?.then(() => {
      if (reinstall.errors.length) console.warn(JSON.stringify({ component: 'lab-pack', operation: 'reseed', errors: reinstall.errors }));
    });
    const defaults = { methodsRestored: reinstall.methodsAdded.length, documentsRestored: reinstall.knowledgeAdded.length, documentsPending: true, errors: reinstall.errors };
    if (credentialFailures.length) return Response.json({ error: 'Workspace content was cleared, but some credentials could not be removed securely. Retry credential removal in Connections.', credentialsFailed: credentialFailures.length, conversationsDeleted, documentsDeleted, collectionsDeleted, notesDeleted, defaults }, { status: 502 });
    return Response.json({ conversationsDeleted, documentsDeleted, collectionsDeleted, notesDeleted, providerCredentialsRemoved: credentials.removed + oauth.removed, defaults });
  }
  if (url.pathname === '/api/v1/data/sample' && request.method === 'POST') {
    if (!demoMode) return Response.json({ error: 'Sample research content is available in Demo mode.' }, { status: 409 });
    const { seedDemoContent } = await import('../../../tools/demo-content.adapter');
    const call = async <T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> => {
      const response = await route(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: request.headers.get('authorization') ?? '', 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      if (!response.ok) throw new Error('Sample content could not be prepared.');
      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    };
    try { await seedDemoContent(call); }
    catch { return Response.json({ error: 'Sample research content could not be prepared.' }, { status: 500 }); }
    return Response.json({ ready: true });
  }
  if (url.pathname === '/api/v1/data/cache' && request.method === 'DELETE') {
    const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
    if (body?.confirmed !== true) return Response.json({ error: 'Confirm clearing temporary cache files.' }, { status: 409 });
    if (active.size > 0) return Response.json({ error: 'Wait for active AI requests to finish before clearing temporary files.' }, { status: 409 });
    if (activeIndexing.size > 0) return Response.json({ error: 'Wait for active indexing to finish before clearing temporary files.' }, { status: 409 });
    let cleared = 0;
    for (const entry of readdirSync(scratchRoot, { withFileTypes: true })) {
      const path = join(scratchRoot, entry.name);
      if (!entry.name.startsWith('air-')) continue;
      rmSync(path, { recursive: true, force: true });
      cleared++;
    }
    return Response.json({ cleared });
  }
  const powerResponse = await localAiPowerRoutes(request, url);
  if (powerResponse) return powerResponse;
  const locationResponse = await storageLocationRoutes(request, url);
  if (locationResponse) return locationResponse;
  const folderResponse = await storageFolderRoutes(request, url);
  if (folderResponse) return folderResponse;
  const scanResponse = await localModelScanRoutes(request, url);
  if (scanResponse) return scanResponse;
  const marketCatalogResponse = await marketCatalogRoutes(request, url);
  if (marketCatalogResponse) return marketCatalogResponse;
  const craftResponse = await craftRoutes(request, url);
  if (craftResponse) return craftResponse;
  const marketDiscoveryResponse = await marketDiscoveryRoutes(request, url);
  if (marketDiscoveryResponse) return marketDiscoveryResponse;
  const modelCatalogResponse = await modelCatalogRoutes(request, url);
  if (modelCatalogResponse) return modelCatalogResponse;
  const lemonadeCollectionResponse = await lemonadeCollectionRoutes(request, url);
  if (lemonadeCollectionResponse) return lemonadeCollectionResponse;
  const lemonadeModalityResponse = await lemonadeModalityRoutes(request, url);
  if (lemonadeModalityResponse) return lemonadeModalityResponse;
  const lemonadeStatusResponse = await lemonadeStatusRoutes(request, url);
  if (lemonadeStatusResponse) return lemonadeStatusResponse;
  const workspaceKnowledgeResponse = await workspaceKnowledgeRoutes(request);
  if (workspaceKnowledgeResponse) return workspaceKnowledgeResponse;
  const explorerResponse = await explorerRoutes(request);
  if (explorerResponse) return explorerResponse;
  // Conversation graph routes. A conversation is created implicitly on first
  // append; the graph is service-owned and survives restart.
  if (url.pathname === '/api/v1/folders' && request.method === 'GET') return Response.json({ folders: folders.list() });
  if (url.pathname === '/api/v1/folders' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; parentId?: unknown; instruction?: unknown } | null;
    if (!body || typeof body.id !== 'string' || typeof body.name !== 'string' || typeof body.instruction !== 'undefined' && typeof body.instruction !== 'string' || typeof body.parentId !== 'undefined' && body.parentId !== null && typeof body.parentId !== 'string') return Response.json({ error: 'Invalid folder details.' }, { status: 400 });
    try { return Response.json({ folder: folders.create({ id: body.id, name: body.name, parentId: typeof body.parentId === 'string' ? body.parentId : null, instruction: typeof body.instruction === 'string' ? body.instruction : '' }) }, { status: 201 }); }
    catch (error) { return folderErrorResponse(error); }
  }
  const folderPath = url.pathname.match(/^\/api\/v1\/folders\/([^/]+)$/);
  if (folderPath && (request.method === 'PATCH' || request.method === 'DELETE')) {
    let folderId: string;
    try { folderId = decodeURIComponent(folderPath[1]!); } catch { return Response.json({ error: 'Invalid folder identifier.' }, { status: 400 }); }
    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => null) as { name?: unknown; parentId?: unknown; instruction?: unknown } | null;
      if (!body || Object.keys(body).length === 0 || body.name !== undefined && typeof body.name !== 'string' || body.instruction !== undefined && typeof body.instruction !== 'string' || body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') return Response.json({ error: 'Invalid folder update.' }, { status: 400 });
      try { const folder = folders.update(folderId, body as { name?: string; parentId?: string | null; instruction?: string }); return folder ? Response.json({ folder }) : Response.json({ error: 'Unknown folder.' }, { status: 404 }); }
      catch (error) { return folderErrorResponse(error); }
    }
    const body = await request.json().catch(() => null) as { policy?: unknown } | null;
    if (body?.policy !== 'keep-chats' && body?.policy !== 'delete-chats') return Response.json({ error: 'Choose whether to keep chats at the root or delete them.' }, { status: 400 });
    return folders.delete(folderId, body.policy) ? new Response(null, { status: 204 }) : Response.json({ error: 'Unknown folder.' }, { status: 404 });
  }
  if (url.pathname === '/api/v1/conversations' && request.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 200);
    if (!Number.isSafeInteger(limit) || limit < 1) return Response.json({ error: 'Invalid list limit' }, { status: 400 });
    const folderId = url.searchParams.get('folderId');
    const archived = url.searchParams.get('archived');
    const tag = url.searchParams.get('tag');
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: 'Invalid list offset' }, { status: 400 });
    const conversations_ = conversations.summaries(limit, offset, {
      archived: archived === 'include' ? 'include' : archived === 'true',
      ...(folderId !== null ? { folderId: folderId || null } : {}),
      ...(tag ? { tag } : {})
    });
    return Response.json({ conversations: conversations_ });
  }
  if (url.pathname === '/api/v1/conversations/search' && request.method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    if (query.length > 200) return Response.json({ error: 'Search query is too long' }, { status: 400 });
    return Response.json({ results: conversations.search(query, { includeArchived: url.searchParams.get('includeArchived') === 'true' }) });
  }
  if (url.pathname === '/api/v1/conversations' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { conversationId?: unknown } | null;
    if (!body || typeof body.conversationId !== 'string' || !body.conversationId || body.conversationId.length > 200) return Response.json({ error: 'A conversation identifier is required' }, { status: 400 });
    return Response.json({ conversation: conversations.ensure(body.conversationId) }, { status: 201 });
  }
  const historyPath = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/history$/);
  if (historyPath && request.method === 'GET') {
    let conversationId: string;
    try { conversationId = decodeURIComponent(historyPath[1]!); } catch { return Response.json({ error: 'Invalid conversation identifier' }, { status: 400 }); }
    if (!conversations.load(conversationId)) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
    const after = url.searchParams.get('after');
    const before = url.searchParams.get('before');
    const leafId = url.searchParams.get('leafId');
    const fromEnd = url.searchParams.get('from') === 'end' || url.searchParams.get('tail') === '1';
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (!Number.isSafeInteger(limit) || limit < 1) return Response.json({ error: 'Invalid history limit' }, { status: 400 });
    // Branch-path pages (before / from=end / leafId) use historyPage. Plain after
    // cursors keep the older chronological history() shape for existing callers.
    if (before || fromEnd || leafId) {
      const page = conversations.historyPage(conversationId, {
        limit,
        ...(before ? { before } : after !== null ? { after } : { fromEnd: true }),
        ...(leafId ? { leafId } : {}),
      });
      if (!page) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
      return Response.json({
        conversation: conversations.loadMeta(conversationId),
        messages: page.messages,
        hasEarlier: page.hasEarlier,
        hasLater: page.hasLater,
        leafId: page.leafId,
      });
    }
    return Response.json({ messages: conversations.history(conversationId, after, limit) });
  }
  const conversationPath = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/);
  if (conversationPath && (request.method === 'GET' || request.method === 'PATCH' || request.method === 'DELETE')) {
    let conversationId: string;
    try { conversationId = decodeURIComponent(conversationPath[1]!); } catch { return Response.json({ error: 'Invalid conversation identifier' }, { status: 400 }); }
    if (request.method === 'GET') {
      recoverConversationRuns(conversationId);
      const graph = conversations.load(conversationId);
      if (!graph) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
      return Response.json({ conversation: graph });
    }
    if (request.method === 'DELETE') { conversations.delete(conversationId); return new Response(null, { status: 204 }); }
    const body = await request.json().catch(() => null) as { title?: unknown; pinned?: unknown; archived?: unknown; tags?: unknown; folderId?: unknown; unreadAt?: unknown } | null;
    if (!body) return Response.json({ error: 'A conversation update is required' }, { status: 400 });
    const update: { title?: string; pinned?: boolean; archivedAt?: string | null; tags?: string[]; folderId?: string | null; unreadAt?: string | null } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200) return Response.json({ error: 'A conversation title is required' }, { status: 400 });
      update.title = body.title.trim();
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') return Response.json({ error: 'Pinned state must be true or false' }, { status: 400 });
      update.pinned = body.pinned;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') return Response.json({ error: 'Archive state must be true or false' }, { status: 400 });
      update.archivedAt = body.archived ? new Date().toISOString() : null;
    }
    if (body.tags !== undefined) {
      const tags = body.tags;
      if (!Array.isArray(tags) || tags.length > 25 || tags.some((tag) => typeof tag !== 'string' || tag.trim().length < 1 || tag.trim().length > 40)) return Response.json({ error: 'Tags must be between 1 and 40 characters, with at most 25 of them' }, { status: 400 });
      update.tags = [...new Set((tags as string[]).map((tag) => tag.trim()))];
    }
    if (body.folderId !== undefined && body.folderId !== null) {
      if (typeof body.folderId !== 'string' || body.folderId.length > 200) return Response.json({ error: 'Invalid folder identifier' }, { status: 400 });
      if (!folders.get(body.folderId)) return Response.json({ error: 'Unknown folder' }, { status: 400 });
      update.folderId = body.folderId;
    } else if (body.folderId === null) update.folderId = null;
    if (body.unreadAt !== undefined && body.unreadAt !== null) {
      if (typeof body.unreadAt !== 'string' || Number.isNaN(Date.parse(body.unreadAt))) return Response.json({ error: 'Invalid read timestamp' }, { status: 400 });
      update.unreadAt = body.unreadAt;
    } else if (body.unreadAt === null) update.unreadAt = null;
    if (Object.keys(update).length === 0) return Response.json({ error: 'A conversation update is required' }, { status: 400 });
    if (!conversations.load(conversationId)) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
    return Response.json({ conversation: conversations.setMeta(conversationId, update) });
  }
  const turnsPath = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/turns$/);
  if (turnsPath && request.method === 'POST') {
    let conversationId: string;
    try { conversationId = decodeURIComponent(turnsPath[1]!); } catch { return Response.json({ error: 'Invalid conversation identifier' }, { status: 400 }); }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('userId' in body) || typeof body.userId !== 'string' || !body.userId || body.userId.length > 200 || !('assistantId' in body) || typeof body.assistantId !== 'string' || !body.assistantId || body.assistantId.length > 200 || body.assistantId === body.userId || !('parentId' in body) || body.parentId !== null && typeof body.parentId !== 'string' || !('content' in body) || typeof body.content !== 'string' || !body.content || body.content.length > 200_000) return Response.json({ error: 'Invalid turn' }, { status: 400 });
    const structured = parseStructuredMessageFields(Object.fromEntries(Object.entries(body)));
    if ('error' in structured) return Response.json({ error: structured.error }, { status: 400 });
    const current = conversations.load(conversationId);
    if (!current) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
    if (body.parentId !== null && !current.messages.some(message => message.id === body.parentId)) return Response.json({ error: 'The parent must belong to this conversation' }, { status: 400 });
    try {
      const graph = conversations.appendTurn({ conversationId, userId: body.userId, assistantId: body.assistantId, parentId: body.parentId, content: body.content, attachments: structured.fields.attachments ?? [] });
      scheduleReasoning(conversationId, body.userId);
      return Response.json({ conversation: graph }, { status: 201 });
    } catch { return Response.json({ error: 'The turn could not be saved' }, { status: 409 }); }
  }
  const messagesPath = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
  if (messagesPath && request.method === 'POST') {
    let conversationId: string;
    try { conversationId = decodeURIComponent(messagesPath[1]!); } catch { return Response.json({ error: 'Invalid conversation identifier' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { id?: unknown; parentId?: unknown; role?: unknown; content?: unknown; complete?: unknown; runId?: unknown } | null;
    const validRole = typeof body?.role === 'string' && ['system', 'user', 'assistant'].includes(body.role);
    if (!body || typeof body.id !== 'string' || !body.id || body.id.length > 200 || (body.parentId !== null && typeof body.parentId !== 'string') || !validRole || typeof body.content !== 'string' || body.content.length > 200_000 || typeof body.complete !== 'boolean' || (body.runId !== undefined && body.runId !== null && typeof body.runId !== 'string')) return Response.json({ error: 'Invalid message' }, { status: 400 });
    const structured = parseStructuredMessageFields(body as unknown as Record<string, unknown>);
    if ('error' in structured) return Response.json({ error: structured.error }, { status: 400 });
    if (body.parentId !== null && !conversations.load(conversationId)?.messages.some((message) => message.id === body.parentId)) return Response.json({ error: 'The parent must belong to this conversation' }, { status: 400 });
    const graph = conversations.appendMessage({ conversationId, id: body.id, parentId: (body.parentId as string | null) ?? null, role: body.role as 'system' | 'user' | 'assistant', content: body.content, complete: body.complete, runId: (body.runId as string | null | undefined) ?? null, ...structured.fields });
    scheduleReasoning(conversationId, body.id);
    return Response.json({ conversation: graph }, { status: 201 });
  }
  if (messagesPath && request.method === 'DELETE') {
    let conversationId: string;
    try { conversationId = decodeURIComponent(messagesPath[1]!); } catch { return Response.json({ error: 'Invalid conversation identifier' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { messageIds?: unknown } | null;
    if (!body || !Array.isArray(body.messageIds) || body.messageIds.length === 0 || body.messageIds.length > 1000 || body.messageIds.some((id) => typeof id !== 'string' || !id || id.length > 200)) return Response.json({ error: 'Invalid message deletion' }, { status: 400 });
    const messageIds = [...new Set(body.messageIds as string[])];
    const graph = conversations.load(conversationId);
    if (!graph) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
    const known = new Set(graph.messages.map((message) => message.id));
    if (messageIds.some((id) => !known.has(id))) return Response.json({ error: 'Unknown message in this deletion' }, { status: 400 });
    const removed = new Set(messageIds);
    if (graph.messages.some((message) => !removed.has(message.id) && message.parentId && removed.has(message.parentId))) return Response.json({ error: 'Deleting these messages would leave replies without a parent' }, { status: 400 });
    const updatedGraph = conversations.deleteMessages(conversationId, messageIds);
    scheduleReasoning(conversationId);
    return Response.json({ conversation: updatedGraph });
  }
  const messageRoute = url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/messages\/([^/]+)$/);
  if (messageRoute && request.method === 'PATCH') {
    let conversationId: string;
    let messageId: string;
    try { conversationId = decodeURIComponent(messageRoute[1]!); messageId = decodeURIComponent(messageRoute[2]!); } catch { return Response.json({ error: 'Invalid message path' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { content?: unknown; complete?: unknown } | null;
    if (!body || (body.content !== undefined && (typeof body.content !== 'string' || body.content.length > 200_000)) || (body.complete !== undefined && typeof body.complete !== 'boolean')) return Response.json({ error: 'Invalid message update' }, { status: 400 });
    const structured = parseStructuredMessageFields(body as unknown as Record<string, unknown>);
    if ('error' in structured) return Response.json({ error: structured.error }, { status: 400 });
    const update: { content?: string; complete?: boolean; output?: OutputBlock[]; statusHistory?: MessageStatusEntry[]; usage?: MessageUsage | null; error?: MessageError | null; files?: string[]; attachments?: MessageAttachment[] } = { ...structured.fields };
    if (typeof body.content === 'string') update.content = body.content;
    if (typeof body.complete === 'boolean') update.complete = body.complete;
    if (!conversations.load(conversationId)) return Response.json({ error: 'Unknown conversation' }, { status: 404 });
    const updatedGraph = conversations.updateMessage(conversationId, messageId, update);
    scheduleReasoning(conversationId, messageId);
    return Response.json({ conversation: updatedGraph });
  }
  const modelSettingsResponse = await modelSettingsRoutes(request, url);
  if (modelSettingsResponse) return modelSettingsResponse;
  const webSearchSettingsResponse = await webSearchSettingsRoutes(request, url);
  if (webSearchSettingsResponse) return webSearchSettingsResponse;
  const todayWikipediaResponse = await todayWikipediaRoutes(request, url);
  if (todayWikipediaResponse) return todayWikipediaResponse;
  const craftCatalogResponse = await craftCatalogRoutes(request, url);
  if (craftCatalogResponse) return craftCatalogResponse;
  if (url.pathname === '/api/v1/providers' && request.method === 'GET') {
    // The status names each connection, its models, and whether a credential is
    // configured. It never carries the credential value itself.
    if (localInference.enabled() && !lemonadeDescriptor) await ensureLemonadeRuntime();
    else if (lemonadeDescriptor && !providers.get(managedLemonadeProviderId)) syncProvidersFromRuntime();
    const connections = new Map(connectionSettings.list().map((connection) => [connection.id, connection]));
    const registry = await refreshModelReferenceRegistry();
    const chatgptAccounts = demoMode ? { accounts: [], activeAccountId: null as string | null } : await chatgptSignIn.accounts();
    const chatgptReady = chatgptAccounts.accounts.some((account) => account.active && account.planUsageAvailable);
    const status = await Promise.all(providers.status().map(async (provider) => {
      const connection = connections.get(provider.id);
      const listing = provider.id === managedLemonadeProviderId || (provider.id === managedChatGptProviderId && chatgptReady)
        ? await providers.listModels(provider.id, request.signal)
        : null;
      const name = connection?.name
        ?? (provider.id === managedLemonadeProviderId ? 'Local'
          : provider.id === managedChatGptProviderId ? 'ChatGPT'
            : 'Demo model');
      const credentialConfigured = provider.id === managedChatGptProviderId
        ? chatgptReady
        : connection ? await connectionSettings.configured(connection) : false;
      return {
        ...provider,
        ...(listing?.ok ? { models: listing.models, ...(listing.reasoningByModel ? { reasoningByModel: listing.reasoningByModel } : {}) } : provider.id === managedChatGptProviderId ? { models: [] } : {}),
        modelFacts: registry.filter((entry) => entry.providerId === provider.id),
        name,
        credentialConfigured
      };
    }));
    return Response.json({ providers: status });
  }
  const providerCredential = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/credential$/);
  if (providerCredential && (request.method === 'PUT' || request.method === 'DELETE')) {
    let providerId: string;
    try { providerId = decodeURIComponent(providerCredential[1]!); } catch { return Response.json({ error: 'Invalid provider identifier' }, { status: 400 }); }
    if (!providers.get(providerId)) return Response.json({ error: 'Unknown provider' }, { status: 404 });
    if (providerId === managedLemonadeProviderId) return Response.json({ error: 'Managed local runtime credentials are supplied only by the native host.' }, { status: 409 });
    if (providerId === managedChatGptProviderId) return Response.json({ error: 'ChatGPT credentials come from Sign in with ChatGPT in Cloud AI settings.' }, { status: 409 });
    const outcome = (operation: string, state: string) => console.info(JSON.stringify({ component: 'providers', operation, provider: providerId, outcome: state }));
    try {
      if (request.method === 'PUT') {
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || !('secret' in body)) return Response.json({ error: 'A provider secret is required' }, { status: 400 });
        await connectionSettings.save({ connection: connectionSettings.get(providerId), secret: body.secret });
        outcome('credential-store', 'stored');
        return Response.json({ providerId, credentialConfigured: true });
      }
      const removal = await connectionSettings.forget(providerId);
      outcome('credential-forget', removal.credentialRemoval);
      return Response.json({ providerId, credentialConfigured: removal.credentialConfigured });
    } catch (error) {
      outcome(request.method === 'PUT' ? 'credential-store' : 'credential-forget', 'failed');
      const status = error instanceof ModelConnectionSettingsError ? { invalid: 400, missing: 404, conflict: 409, 'credential-write': 503, 'credential-delete': 502, discovery: 502 }[error.code] : 503;
      return Response.json({ error: error instanceof ModelConnectionSettingsError ? error.message : 'The credential operation could not complete.' }, { status });
    }
  }
  const providerModels = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/models$/);
  if (providerModels && request.method === 'GET') {
    let providerId: string;
    try { providerId = decodeURIComponent(providerModels[1]!); } catch { return Response.json({ error: 'Invalid provider identifier' }, { status: 400 }); }
    if (!providers.get(providerId)) return Response.json({ error: 'Unknown provider' }, { status: 404 });
    const discovery = new AbortController();
    const timeout = setTimeout(() => discovery.abort(), 15_000);
    try {
      const listing = await providers.listModels(providerId, discovery.signal);
      const models = listing.ok ? listing.models : providers.get(providerId)?.capabilities().models ?? [];
      return Response.json({ provider: providerId, models, listing, fallback: !listing.ok });
    } finally { clearTimeout(timeout); }
  }
  const toolApprovalPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/tool-approval$/);
  if (toolApprovalPath && request.method === 'POST') {
    let runId: string;
    try { runId = decodeURIComponent(toolApprovalPath[1]!); } catch { return Response.json({ error: 'Invalid run ID.' }, { status: 400 }); }
    const decision = await request.json().catch(() => null) as { toolCallId?: unknown; approved?: unknown } | null;
    if (!decision || typeof decision.toolCallId !== 'string' || typeof decision.approved !== 'boolean') return Response.json({ error: 'Invalid tool decision.' }, { status: 400 });
    const key = `${runId}:${decision.toolCallId}`;
    const pending = toolApprovals.get(key);
    if (!pending) return Response.json({ error: 'This approval is no longer pending.' }, { status: 409 });
    pending.resolve(decision.approved);
    return Response.json({ ok: true });
  }
  const userInputPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/user-input$/);
  if (userInputPath && request.method === 'POST') {
    let runId: string;
    try { runId = decodeURIComponent(userInputPath[1]!); } catch { return Response.json({ error: 'Invalid run ID.' }, { status: 400 }); }
    const decision: unknown = await request.json().catch(() => null);
    if (!decision || typeof decision !== 'object' || !('requestId' in decision) || typeof decision.requestId !== 'string' || !('answer' in decision) || !(decision.answer === null || typeof decision.answer === 'string' && decision.answer.length <= 100_000) || !('wasFreeform' in decision) || typeof decision.wasFreeform !== 'boolean') return Response.json({ error: 'Invalid answer.' }, { status: 400 });
    const pending = userInputRequests.get(`${runId}:${decision.requestId}`);
    if (!pending) return Response.json({ error: 'This question is no longer pending.' }, { status: 409 });
    if (decision.answer !== null && (decision.wasFreeform ? !pending.allowFreeform : !pending.choices.includes(decision.answer))) return Response.json({ error: 'Choose an allowed answer.' }, { status: 400 });
    pending.resolve(decision.answer === null ? null : { answer: decision.answer, wasFreeform: decision.wasFreeform });
    return Response.json({ ok: true });
  }
  const steerPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/steer$/);
  if (steerPath && request.method === 'POST') {
    let runId: string;
    try { runId = decodeURIComponent(steerPath[1]!); } catch { return Response.json({ error: 'Invalid run ID.' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { prompt?: unknown } | null;
    if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) return Response.json({ error: 'Invalid steer prompt.' }, { status: 400 });
    if (!store.get(runId) || store.get(runId)?.status !== 'running') return Response.json({ error: 'This run is not accepting steering.' }, { status: 409 });
    if (!isCopilotRunSteerable(runId)) return Response.json({ error: 'Steering is unavailable for this run.' }, { status: 409 });
    try {
      const ok = await steerCopilotRun(runId, body.prompt);
      if (!ok) return Response.json({ error: 'Steering is unavailable for this run.' }, { status: 409 });
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: 'The steer prompt could not be delivered.' }, { status: 502 });
    }
  }
  const liveToolsPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/tools$/);
  if (liveToolsPath && request.method === 'POST') {
    let runId: string;
    try { runId = decodeURIComponent(liveToolsPath[1]!); } catch { return Response.json({ error: 'Invalid run ID.' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { toolIds?: unknown } | null;
    if (!body || !Array.isArray(body.toolIds) || body.toolIds.length > 200 || body.toolIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200)) {
      return Response.json({ error: 'Invalid tool selection.' }, { status: 400 });
    }
    const run = store.get(runId);
    if (!run || run.status !== 'running') return Response.json({ error: 'This run is not accepting tool changes.' }, { status: 409 });
    if (!isCopilotRunSteerable(runId)) return Response.json({ error: 'Live tool changes are unavailable for this run.' }, { status: 409 });
    try {
      const enabledTools = tools.definitions(true);
      const selectedTools = selectEnabledTools(body.toolIds, enabledTools);
      if (new Set(selectedTools.map((tool) => tool.name)).size !== selectedTools.length) return Response.json({ error: 'Selected tools have the same name. Choose one of the conflicting tools.' }, { status: 400 });
      const { servers: mcpServers, hostedConnectionIds } = await buildCopilotMcpServers({
        selectedTools,
        connections: tools.connections(),
        localInstallRoot: join(runtimeRoot, 'local-mcp'),
        nodeExecutable: Bun.env.OFFICE_MCP_NODE_EXECUTABLE ?? Bun.which('node'),
        accessToken: async (connectionId) => (await mcpOAuth.accessToken(connectionId)) ?? await toolCredentialResolve(connectionId)
      });
      void mcpServers;
      const customTools = selectedTools.filter((tool) => !hostedConnectionIds.has(tool.connectionId));
      const ok = await replaceCopilotRunCustomTools(runId, customTools.map(({ id, name, description, inputSchema }) => ({ id, name, description, inputSchema })));
      if (!ok) return Response.json({ error: 'Live tool changes are unavailable for this run.' }, { status: 409 });
      return Response.json({ ok: true, toolIds: customTools.map((tool) => tool.id) });
    } catch {
      return Response.json({ error: 'The tool selection could not be applied to this run.' }, { status: 502 });
    }
  }
  const interactionPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)\/interactions$/);
  if (interactionPath && request.method === 'GET') {
    let runId: string;
    try { runId = decodeURIComponent(interactionPath[1]!); } catch { return Response.json({ error: 'Invalid run ID.' }, { status: 400 }); }
    if (!store.get(runId)) return Response.json({ error: 'Run not found.' }, { status: 404 });
    return Response.json({
      approvals: [...toolApprovals.values()].filter((pending) => pending.runId === runId).map((pending) => pending.request),
      questions: [...userInputRequests.values()].filter((pending) => pending.runId === runId).map((pending) => pending.request)
    }, { headers: { 'cache-control': 'no-store' } });
  }
  const runPath = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)(\/events)?$/);
  if (runPath && (request.method === 'GET' && runPath[2] || request.method === 'DELETE' && !runPath[2])) {
    let runId: string;
    try { runId = decodeURIComponent(runPath[1]!); } catch { return new Response('Invalid run ID', { status: 400 }); }
    if (!runId || runId.length > 200) return new Response('Invalid run ID', { status: 400 });
    const run = store.get(runId);
    if (!run) return new Response('Run not found', { status: 404 });
    if (request.method === 'DELETE') {
      active.get(runId)?.abort();
      if (run.status === 'running') {
        const sequence = run.state.lastSequence + 1;
        appendRunEvent({ protocolVersion: CHAT_PROTOCOL_VERSION, eventId: `${runId}:${sequence}`, runId, correlationId: runId, sequence, timestamp: new Date().toISOString(), type: 'completion', payload: { reason: 'cancelled' } });
      }
      return new Response(null, { status: 204 });
    }
    if (request.signal.aborted) return new Response('Request aborted', { status: 499 });
    const after = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? -1);
    if (!Number.isSafeInteger(after) || after < -1) return new Response('Invalid replay cursor', { status: 400 });
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const IDLE_TIMEOUT_MS = 30000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let cursor = after;
        let lastWriteAt = Date.now();
        const stop = () => { stopped = true; clearTimeout(timer); request.signal.removeEventListener('abort', abort); };
        const abort = () => { if (!stopped) { stop(); controller.close(); } };
        request.signal.addEventListener('abort', abort, { once: true });
        const pump = () => {
          if (stopped) return;
          // Backpressure: `desiredSize` shrinks as events queue and recovers as
          // the client reads, so a slow reader pauses the pump instead of the
          // stream buffering without bound — or, with a lifetime counter,
          // stalling for good once a tool-heavy run passes its cap.
          if ((controller.desiredSize ?? 1) <= 0) { timer = setTimeout(pump, 50); return; }
          const available = store.events(runId, cursor);
          for (const event of available) { cursor = event.sequence; controller.enqueue(encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`)); lastWriteAt = Date.now(); }
          if (Date.now() - lastWriteAt >= 5000) { controller.enqueue(encoder.encode(': keep-alive\n\n')); lastWriteAt = Date.now(); }
          const current = store.get(runId)!;
          if (current.status !== 'running' && cursor >= current.state.lastSequence) { stop(); controller.close(); return; }
          timer = setTimeout(pump, available.length === 256 ? 0 : 100);
        };
        pump();
      },
      cancel() { stopped = true; clearTimeout(timer); }
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
  }
  if (url.pathname === '/api/v1/runs' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as ChatRunRequest | null;
    if (body?.preferredToolIds !== undefined && (!Array.isArray(body.preferredToolIds) || !Array.isArray(body.toolIds) || body.preferredToolIds.length > 100 || body.preferredToolIds.some((id) => typeof id !== 'string' || !body.toolIds?.includes(id)) || new Set(body.preferredToolIds).size !== body.preferredToolIds.length)) return Response.json({ error: 'Invalid preferred tools.' }, { status: 400 });
    if (!body || (body.commandPermission !== undefined && body.commandPermission !== 'ask' && body.commandPermission !== 'allow-all') || (body.settings !== undefined && !isChatRunSettings(body.settings)) || typeof body.runId !== 'string' || !body.runId || body.runId.length > 200 || typeof body.model !== 'string' || !body.model || body.model.length > 200 || (body.provider !== undefined && (typeof body.provider !== 'string' || !body.provider || body.provider.length > 200)) || (body.preferredWorkspaceRoot !== undefined && (typeof body.preferredWorkspaceRoot !== 'string' || !body.preferredWorkspaceRoot || body.preferredWorkspaceRoot.length > 1000 || body.preferredWorkspaceRoot.includes('\0'))) || !Array.isArray(body.messages) || body.messages.some((message) => typeof message !== 'object' || message === null || !['system', 'user', 'assistant', 'tool', 'assistant-tool-calls'].includes(String(message.role)) || typeof message.content !== 'string' || message.content.length > MAX_CHAT_TURN_CHARACTERS || message.role === 'tool' && (typeof message.toolCallId !== 'string' || !message.toolCallId) || message.role === 'assistant-tool-calls' && (!Array.isArray(message.calls) || message.calls.length > 16 || message.calls.some((call) => typeof call.toolCallId !== 'string' || typeof call.name !== 'string' || typeof call.arguments !== 'object' || call.arguments === null || Array.isArray(call.arguments)))) || (body.toolIds !== undefined && (!Array.isArray(body.toolIds) || body.toolIds.length > 100 || body.toolIds.some((id) => typeof id !== 'string') || new Set(body.toolIds).size !== body.toolIds.length)) || (body.context !== undefined && !isChatRunContext(body.context))) return Response.json({ error: 'Invalid run request' }, { status: 400 });
    if (body.messages.some(message => message.role === 'user' && message.attachments !== undefined && (!Array.isArray(message.attachments) || message.attachments.length > 5 || message.attachments.some(item => !item || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id) || typeof item.label !== 'string' || item.label.length > 200 || typeof item.mediaType !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(item.mediaType) || item.data !== undefined)))) return Response.json({ error: 'Invalid attachment reference.' }, { status: 400 });
    if (body.provider === managedLemonadeProviderId) {
      if (!localInference.enabled()) return Response.json({ error: 'Local AI is off. Turn it on in the sidebar when you need it.', code: 'local-ai-off' }, { status: 409 });
      const resolution = resolveModelReference({ providerId: body.provider, modelId: body.model, role: 'chat' }, await refreshModelReferenceRegistry());
      if (resolution.state !== 'available') return Response.json({ error: resolution.message, code: resolution.state }, { status: 409 });
    }
    if (body.conversation !== undefined) {
      const target = body.conversation;
      if (typeof target !== 'object' || target === null || typeof target.id !== 'string' || typeof target.assistantMessageId !== 'string' || target.initialContent !== undefined || (target.continueFrom !== undefined && typeof target.continueFrom !== 'string')) return Response.json({ error: 'Invalid conversation target' }, { status: 400 });
      const message = conversations.load(target.id)?.messages.find((item) => item.id === target.assistantMessageId);
      if (!message || message.role !== 'assistant' || message.complete) return Response.json({ error: 'An incomplete assistant message is required' }, { status: 409 });
      if (target.continueFrom !== undefined) {
        const previous = store.get(target.continueFrom);
        const finishedWithoutLength = previous?.status === 'complete' && previous.state.completion?.reason !== 'length';
        if (message.runId !== target.continueFrom || !previous || active.has(target.continueFrom) || previous.status === 'running' || finishedWithoutLength || previous.request.conversation?.id !== target.id || previous.request.conversation.assistantMessageId !== target.assistantMessageId) return Response.json({ error: 'This response cannot be continued' }, { status: 409 });
        target.initialContent = message.content;
      } else if (message.runId !== null) return Response.json({ error: 'A new assistant message is required' }, { status: 409 });
    }
    if (body.provider !== undefined && !providers.get(body.provider)) return Response.json({ error: 'Unknown provider' }, { status: 400 });
    if (active.size >= 16) return Response.json({ error: 'Too many active runs' }, { status: 429 });
    const connection = providers.get(body.provider ?? '') ?? providers.default();
    let credentialIdentity: string | undefined;
    if (connection.id === managedChatGptProviderId) {
      try { credentialIdentity = (await chatgptSignIn.accounts()).activeAccountId ?? ''; }
      catch { return Response.json({ error: 'The ChatGPT account could not be read.' }, { status: 503 }); }
    }
    const executionIdentity = JSON.stringify([connection.id, credentialIdentity ?? null]);
    if (body.conversation?.continueFrom) {
      const previous = store.get(body.conversation.continueFrom);
      if (!previous || previous.executionIdentity !== executionIdentity || previous.request.model !== body.model) return Response.json({ error: 'Continue this response with the same model and account, or start a new response.' }, { status: 409 });
    }
    if (body.conversation) {
      const target = body.conversation;
      const message = conversations.load(target.id)?.messages.find((item) => item.id === target.assistantMessageId);
      if (!message || message.complete || message.runId !== (target.continueFrom ?? null) || target.continueFrom && active.has(target.continueFrom)) return Response.json({ error: 'This response has already changed. Refresh and try again.' }, { status: 409 });
    }
    if (active.size >= 16) return Response.json({ error: 'Too many active runs' }, { status: 429 });
    let localPowerSignal: AbortSignal | undefined;
    if (body.provider === managedLemonadeProviderId) {
      try { localPowerSignal = localInference.signal(body.model); }
      catch { return Response.json({ error: 'Local AI is off. Turn it on in the sidebar when you need it.', code: 'local-ai-off' }, { status: 409 }); }
    }
    if (!store.create(body, executionIdentity)) return Response.json({ error: 'runId already exists' }, { status: 409 });
    if (body.conversation) {
      const target = body.conversation;
      const previousMessage = target.continueFrom ? conversations.load(target.id)?.messages.find(item => item.id === target.assistantMessageId) : undefined;
      conversations.updateMessage(target.id, target.assistantMessageId, { runId: body.runId, modelId: body.model, ...(previousMessage ? { error: null, statusHistory: [...previousMessage.statusHistory, { at: new Date().toISOString(), label: 'running', state: 'running' as const }] } : {}) });
    }
    const controller = new AbortController();
    if (localPowerSignal) {
      if (localPowerSignal.aborted) controller.abort();
      else localPowerSignal.addEventListener('abort', () => controller.abort(), { once: true, signal: controller.signal });
    }
    active.set(body.runId, controller);
    if (memory.enabled() && localEmbeddingsEnabled()) reasoning.resume();

    void (async () => {
      let executionMode: ChatExecutionMode = 'full';
      try {
        const enabledTools = tools.definitions(true);
        // An omitted selection inherits defaults; an explicit selection can be empty.
        // Unknown ids are dropped against the live catalog — never fail the chat for them.
        const requestedToolIds = body.toolIds ?? (connection.capabilities().tools ? defaultChatToolIds(enabledTools) : []);
        const selectedTools = selectEnabledTools(requestedToolIds, enabledTools);
        if (selectedTools.length && !connection.capabilities().tools) throw new ChatConfigurationError('This model does not support tool use.');
        if (new Set(selectedTools.map((tool) => tool.name)).size !== selectedTools.length) throw new ChatConfigurationError('Selected tools have the same name. Choose one of the conflicting tools.');
        const webSearchTool = enabledTools.find((tool) => tool.id === 'builtin:web-search' && tool.enabled);
        if (connection.capabilities().tools && webSearchTool && selectedTools.length > 0 && !selectedTools.some((tool) => tool.id === webSearchTool.id)) selectedTools.push(webSearchTool);
        const instruction = body.conversation ? folders.chatInstruction(body.conversation.id).trim() : '';
        const savedConnection = modelConnections.list().find((item) => item.id === connection.id);
        const connectionBaseUrl = connection.id === managedLemonadeProviderId && lemonadeDescriptor
          ? new URL('/v1', lemonadeDescriptor.baseOrigin).href
          : savedConnection?.baseUrl;
        executionMode = resolveChatExecutionMode({
          providerId: connection.id,
          baseUrl: connectionBaseUrl,
          fullHarnessEnabled: modelHarness.fullHarnessEnabled(connection.id, body.model)
        });
        // Every run carries the baseline instructions, so a chat with no
        // attached agent still reaches the model as AIR. The folder and the
        // client's own instructions follow, so a specific instruction wins.
        const baseline = baselineSystemPrompt(selectedTools.map((tool) => tool.name), { mode: executionMode });
        const humanMarkInstructions = crafts.humanMarkInstructions();
        const systemTurns: ChatRunRequest['messages'] = [{ role: 'system', content: baseline }, ...(humanMarkInstructions ? [{ role: 'system' as const, content: humanMarkInstructions }] : []), ...(instruction ? [{ role: 'system' as const, content: `Folder instructions:\n${instruction}` }] : [])];
        const graph = body.conversation ? conversations.load(body.conversation.id) : null;
        const path = graph && body.conversation ? messagePath(graph, body.conversation.assistantMessageId) : [];
        let branchIndex = -1;
        if (graph) for (let index = path.length - 1; index >= 0; index--) {
          if (graph.messages.filter((candidate) => candidate.parentId === path[index]!.parentId).length > 1) { branchIndex = index; break; }
        }
        let sessionScope = path.at(-1)?.id;
        for (let index = path.length - 2; index >= Math.max(0, branchIndex); index--) {
          const message = path[index]!;
          if (message.role !== 'assistant') continue;
          const prior = message.runId ? store.get(message.runId) : undefined;
          if (prior) {
            if (prior.executionIdentity !== executionIdentity || prior.request.model !== body.model) break;
          } else if (message.modelId) {
            // After a service restart the run row may be gone while the message still names the model.
            if (message.modelId !== body.model) break;
          } else {
            break;
          }
          sessionScope = message.id;
        }
        const parent = path.at(-1)?.parentId ?? null;
        const memoryScope = body.conversation && parent ? { conversationId: body.conversation.id, leafId: parent } : undefined;
        const messages = humanMarkInstructions ? body.messages.flatMap(message => {
          if (message.role !== 'system') return [message];
          const content = message.content.split(humanMarkInstructions).join('').trim();
          return content ? [{ ...message, content }] : [];
        }) : body.messages;
        const turns: ChatRunRequest['messages'] = await Promise.all([...systemTurns, ...messages].map(async message => {
          if (message.role !== 'user' || !message.attachments?.length) return message;
          return { ...message, attachments: await Promise.all(message.attachments.map(async attachment => {
            const version = documents.versions(attachment.id).at(-1);
            if (!version) throw new ChatAttachmentError(`The attachment ${attachment.label} is unavailable. Attach it again.`);
            const bytes = documents.sourceBytes(version.id);
            if (!bytes) throw new ChatAttachmentError(`The attachment ${attachment.label} is unavailable. Attach it again.`);
            if (attachment.mediaType === 'application/pdf' || attachment.mediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.(pdf|docx)$/i.test(attachment.label)) {
              if (!extractionWorker) throw new ChatAttachmentError(`The document reader is unavailable for ${attachment.label}.`);
              const scratch = mkdtempSync(join(scratchRoot, 'air-chat-attachment-'));
              try {
                const inputPath = join(scratch, /\.pdf$/i.test(attachment.label) || attachment.mediaType === 'application/pdf' ? 'source.pdf' : 'source.docx');
                writeFileSync(inputPath, bytes);
                const artifact = await documents.extract(version.id, inputPath, controller.signal);
                if (!artifact.text || artifact.text.length > MAX_CHAT_TURN_CHARACTERS) throw new ChatAttachmentError(`The extracted text of ${attachment.label} is empty or too large.`);
                return { ...attachment, mediaType: 'text/plain', data: Buffer.from(artifact.text, 'utf8').toString('base64') };
              } catch (error) {
                if (error instanceof ChatAttachmentError || controller.signal.aborted) throw error;
                throw new ChatAttachmentError(`Could not read ${attachment.label}. Check the file and try again.`);
              } finally { rmSync(scratch, { recursive: true, force: true }); }
            }
            if (!attachment.mediaType.startsWith('image/') && !attachment.mediaType.startsWith('text/') && !['application/json', 'application/xml'].includes(attachment.mediaType)) throw new ChatAttachmentError(`The file type of ${attachment.label} is not supported. Use an image, text, PDF, or Word document.`);
            return { ...attachment, data: Buffer.from(bytes).toString('base64') };
          })) };
        }));
        const gatedToolNames = new Set(selectedTools.filter((tool) => tool.effect === 'mutate').map((tool) => tool.name));
        const { workspaceRoots, workingDirectory } = resolveCopilotWorkspaceRoots({
          connectedRoots: filesystem.roots().map((root) => root.path),
          filesRoot,
          preferredWorkspaceRoot: body.preferredWorkspaceRoot,
          fallbackWorkdir: copilotWorkdir
        });
        const { servers: mcpServers, hostedConnectionIds } = executionMode === 'full'
          ? await buildCopilotMcpServers({
            selectedTools,
            connections: tools.connections(),
            localInstallRoot: join(runtimeRoot, 'local-mcp'),
            nodeExecutable: Bun.env.OFFICE_MCP_NODE_EXECUTABLE ?? Bun.which('node'),
            accessToken: async (connectionId) => (await mcpOAuth.accessToken(connectionId)) ?? await toolCredentialResolve(connectionId)
          })
          : { servers: {} as Awaited<ReturnType<typeof buildCopilotMcpServers>>['servers'], hostedConnectionIds: new Set<string>() };
        const mcpConnectionIds = new Set(tools.connections().filter((item) => item.kind === 'mcp').map((item) => item.id));
        const customTools = selectedTools.filter((tool) => {
          if (hostedConnectionIds.has(tool.connectionId)) return false;
          // Lean local cannot host Copilot MCP; keep AIR/OpenAPI tools only.
          if (executionMode === 'lean' && mcpConnectionIds.has(tool.connectionId)) return false;
          return true;
        });
        const methodDefinitions = methods.list();
        const skillNameFor = (id: string, name: string) => {
          const base = (name.trim() || id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
          return base || id.replace(/[^a-z0-9]+/gi, '-').slice(0, 64);
        };
        const skillDefinitions = methodDefinitions.filter((definition): definition is Extract<typeof definition, { kind: 'skill' }> => definition.kind === 'skill');
        // Prefer AI-safety / governance skills in the Copilot skill tool catalog.
        // Other installed skills remain available; ambient VS Code skills stay blocked in the session adapter.
        // Lean injects skill bodies into the system prompt instead of Copilot's skill tool.
        const skills = [...skillDefinitions].sort((left, right) => Number(isAiSafetySkill(right.value)) - Number(isAiSafetySkill(left.value)))
          .map((definition) => ({
            name: skillNameFor(definition.value.id, definition.value.name),
            description: (isAiSafetySkill(definition.value) ? '[AI safety] ' : '') + (definition.value.description.trim() || definition.value.name),
            instructions: definition.value.instructions
          }));
        const skillNameById = new Map(skillDefinitions.map((definition) => [definition.value.id, skillNameFor(definition.value.id, definition.value.name)]));
        const safetySkillNames = skillDefinitions.filter((definition) => isAiSafetySkill(definition.value)).map((definition) => skillNameById.get(definition.value.id)!);
        // The default AIR Office Agent is the chat persona, not a task teammate.
        // Registering it as a custom agent invites small models to open a task form on greetings.
        const customAgents = executionMode === 'full' ? methodDefinitions
          .filter((definition): definition is Extract<typeof definition, { kind: 'preset' }> => definition.kind === 'preset' && definition.value.id !== AIR_OFFICE_AGENT_ID)
          .map((definition) => {
            const named = definition.value.skillIds.map((id) => skillNameById.get(id)).filter((name): name is string => typeof name === 'string');
            // Preload AI-safety skills into every Teams agent so fleet workers keep that standing guidance.
            const agentSkills = [...new Set([...named, ...safetySkillNames])];
            return {
              name: skillNameFor(definition.value.id, definition.value.name),
              displayName: definition.value.name,
              description: definition.value.name,
              prompt: definition.value.instructions,
              // Keep Copilot first-party tools available to sub-agents; AIR toolIds still gate the parent chat selection.
              tools: null,
              ...(definition.value.model ? { model: definition.value.model } : {}),
              ...(agentSkills.length ? { skills: agentSkills } : {})
            };
          }) : [];
        const maxAiCredits = Number(Bun.env.OFFICE_SESSION_MAX_AI_CREDITS);
        const sessionLimits = executionMode === 'full' && Number.isFinite(maxAiCredits) && maxAiCredits > 0 ? { maxAiCredits } : undefined;
        let sawTerminal = false;
        for await (const providerEvent of connection.stream({
          ...body,
          credentialIdentity,
          sessionScope,
          workspaceRoots,
          workingDirectory,
          executionMode,
          ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
          // Lean keeps THM via systemTurns and Gyroscopic via memory tools; avoid dumping every skill body into the local prompt.
          ...(executionMode === 'full' && skills.length ? { skills } : {}),
          ...(customAgents.length ? { customAgents } : {}),
          ...(sessionLimits ? { sessionLimits } : {}),
          messages: turns,
          toolDefinitions: customTools.map(({ id, name, description, inputSchema }) => ({ id, name, description, inputSchema })),
          harness: {
            gatedToolNames,
            requestUserInput: async (input, inputSignal) => {
              const key = `${body.runId}:${input.requestId}`;
              return new Promise((resolve) => {
                const signal = inputSignal ? AbortSignal.any([controller.signal, inputSignal]) : controller.signal;
                const finish = (answer: { answer: string; wasFreeform: boolean } | null) => { userInputRequests.delete(key); signal.removeEventListener('abort', cancel); resolve(answer); };
                const cancel = () => finish(null);
                userInputRequests.set(key, { runId: body.runId, request: input, resolve: finish, choices: input.choices ?? [], allowFreeform: input.allowFreeform });
                signal.addEventListener('abort', cancel, { once: true });
                if (signal.aborted) cancel();
              });
            },
            approveTool: async (approval, permissionSignal) => {
              if (body.commandPermission === 'allow-all') return true;
              const { toolCallId } = approval;
              const key = `${body.runId}:${toolCallId}`;
              return new Promise<boolean>((resolve) => {
                const signal = permissionSignal ? AbortSignal.any([controller.signal, permissionSignal]) : controller.signal;
                const finish = (approved: boolean) => { toolApprovals.delete(key); signal.removeEventListener('abort', cancel); resolve(approved); };
                const cancel = () => finish(false);
                toolApprovals.set(key, { runId: body.runId, request: approval, resolve: finish });
                signal.addEventListener('abort', cancel, { once: true });
                if (signal.aborted) cancel();
              });
            },
            requestMcpAuth: async (request) => {
              const connection = tools.connections().find((item) => {
                if (item.kind !== 'mcp') return false;
                if (mcpServerKey(item.id) === request.serverName) return true;
                return mcpEndpointsMatch(item.endpoint, request.serverUrl);
              });
              if (!connection) return null;
              try {
                return (await mcpOAuth.accessToken(connection.id)) ?? await toolCredentialResolve(connection.id);
              } catch {
                return null;
              }
            },
            invokeTool: async ({ toolId, name, arguments: toolArguments }, signal) => {
              const definition = customTools.find((tool) => tool.id === toolId && tool.name === name);
              if (!definition) return { status: 'error', message: 'The requested tool is not enabled for this conversation.' };
              try {
                await ensureRemoteToolHandler(definition);
                const scopedHandler = definition.id === 'builtin:memory-search'
                  ? async (input: Record<string, unknown>, invokeSignal?: AbortSignal) => {
                    const result = await recallMemory(input, memoryScope, invokeSignal);
                    return {
                      ...result,
                      memories: result.memories.map((fact) => ({ id: fact.id, content: fact.content, path: 'memory/facts.jsonl' })),
                    };
                  }
                  : definition.id === 'builtin:action-run'
                    ? async (input: Record<string, unknown>, invokeSignal?: AbortSignal) => {
                      const relative = String(input.path ?? '');
                      const action = toVaultLabAppDescriptor(readVaultActionByPath(vaultRoot, relative), (filename) => readLabFrameworkText(filename));
                      return executeAction(action.id, String(input.source), typeof input.instructions === 'string' ? input.instructions : '', invokeSignal ?? controller.signal, {
                        connection,
                        model: body.model,
                        definition: { name: action.name, system: action.system, runPrompts: action.runPrompts },
                        ...(credentialIdentity !== undefined ? { credentialIdentity } : {}),
                      });
                    }
                    : definition.id === 'builtin:todo-write'
                      ? async (input: Record<string, unknown>) => {
                        const incoming = Array.isArray(input.todos) ? input.todos as TodoItem[] : [];
                        const next = mergeTodos(runTodoState.get(body.runId) ?? [], incoming);
                        runTodoState.set(body.runId, next);
                        return { todos: next };
                      }
                    : undefined;
                const invocation = await tools.invoke(definition.id, toolArguments, signal ?? controller.signal, scopedHandler);
                return invocation.status === 'succeeded'
                  ? { status: 'ok', result: invocation.result }
                  : { status: 'error', message: invocation.error ?? 'The tool could not complete.' };
              } catch (error) {
                return { status: 'error', message: error instanceof Error ? error.message : 'The tool could not complete.' };
              }
            }
          }
        }, controller.signal)) {
          if (store.get(body.runId)?.status !== 'running') break;
          if (providerEvent.runId !== body.runId) throw new Error('Foreign run event');
          const sequence = (store.get(body.runId)?.state.lastSequence ?? -1) + 1;
          const event = { ...providerEvent, eventId: `${body.runId}:${sequence}`, sequence, correlationId: body.runId };
          appendRunEvent(event);
          if (event.type === 'completion' || event.type === 'failure') sawTerminal = true;
          await Bun.sleep(0);
        }
        if (!sawTerminal && store.get(body.runId)?.status === 'running') failRun(body.runId, 'provider-incomplete', 'The provider ended without a terminal event.');
      } catch (error) {
        if (error instanceof ChatAttachmentError) failRun(body.runId, 'attachment-error', error.message);
        else if (error instanceof ChatConfigurationError) failRun(body.runId, 'configuration-error', error.message);
        else if (controller.signal.aborted) failRun(body.runId, 'provider-error', 'The run was stopped.');
        else {
          const detail = error instanceof Error ? error.message.trim() : '';
          const fallback = executionMode === 'lean' ? 'The local provider run failed.' : 'The chat provider run failed.';
          failRun(body.runId, 'provider-error', detail && detail.length <= 2000 ? detail : fallback);
        }
      } finally { runTodoState.delete(body.runId); active.delete(body.runId); controller.abort(); void reasoning.drain(); }
    })();
    return Response.json({ runId: body.runId, events: `/api/v1/runs/${encodeURIComponent(body.runId)}/events`, cancel: `/api/v1/runs/${encodeURIComponent(body.runId)}` }, { status: 202 });
  }
  if (url.pathname === '/api/v1/files' && request.method === 'GET') {
    try {
      const list = await files.list();
      logOperation('list', 'ok');
      return Response.json({ files: list.map(({ id, name, version }) => ({ id, name, version })) });
    } catch (error) {
      if (error instanceof FileOperationError) { logOperation('list', error.code); return fileRoute(error.code, error.message); }
      logOperation('list', 'unexpected'); return Response.json({ error: { code: 'file-unauthorized', message: 'The file operation failed.' } }, { status: 403 });
    }
  }
  if (url.pathname === '/api/v1/files' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { name?: unknown } | null;
    if (!body || typeof body.name !== 'string' || !body.name || body.name.length > 200) return Response.json({ error: { code: 'file-invalid-name', message: 'Enter a valid file name.' } }, { status: 400 });
    try {
      const file = await files.create(body.name);
      logOperation('create', 'ok');
      return Response.json({ file }, { status: 201 });
    } catch (error) {
      if (error instanceof FileOperationError) { logOperation('create', error.code); return fileRoute(error.code, error.message); }
      logOperation('create', 'unexpected'); return Response.json({ error: { code: 'file-unauthorized', message: 'The file operation failed.' } }, { status: 403 });
    }
  }
  const filePath = url.pathname.match(/^\/api\/v1\/files\/([^/]+)$/);
  if (filePath && (request.method === 'GET' || request.method === 'PUT')) {
    let fileId: string;
    try { fileId = decodeURIComponent(filePath[1]!); } catch { return Response.json({ error: { code: 'file-invalid-name', message: 'Enter a valid file name.' } }, { status: 400 }); }
    if (!fileId || fileId.length > 4000) return Response.json({ error: { code: 'file-invalid-name', message: 'Enter a valid file name.' } }, { status: 400 });
    if (request.method === 'GET') {
      try {
        const file = await files.read(fileId);
        logOperation('read', 'ok');
        return Response.json({ file });
      } catch (error) {
        if (error instanceof FileOperationError) { logOperation('read', error.code); return fileRoute(error.code, error.message); }
        logOperation('read', 'unexpected'); return Response.json({ error: { code: 'file-unauthorized', message: 'The file operation failed.' } }, { status: 403 });
      }
    }
    const body = await request.json().catch(() => null) as { content?: unknown; expectedVersion?: unknown } | null;
    if (!body || typeof body.content !== 'string' || body.content.length > 1_500_000 || typeof body.expectedVersion !== 'string' || !body.expectedVersion || body.expectedVersion.length > 200) return Response.json({ error: { code: 'file-stale-version', message: 'A current file version and text content are required to save.' } }, { status: 400 });
    try {
      const file = await files.save(fileId, body.content, body.expectedVersion);
      logOperation('save', 'ok');
      return Response.json({ file });
    } catch (error) {
      if (error instanceof FileOperationError) { logOperation('save', error.code); return fileRoute(error.code, error.message); }
      logOperation('save', 'unexpected'); return Response.json({ error: { code: 'file-unauthorized', message: 'The file operation failed.' } }, { status: 403 });
    }
  }
  if (url.pathname === '/api/v1/rich-documents/trash' && request.method === 'GET') return Response.json({ documents: richDocuments.trashed() });
  const restoreNotePath = url.pathname.match(/^\/api\/v1\/rich-documents\/([^/]+)\/restore$/);
  if (restoreNotePath && request.method === 'POST') {
    let id: string;
    try { id = decodeURIComponent(restoreNotePath[1]!); } catch { return Response.json({ error: 'Invalid note identifier.' }, { status: 400 }); }
    const document = richDocuments.restore(id);
    return document ? Response.json({ document }) : Response.json({ error: 'This note is not in trash.' }, { status: 404 });
  }
  const noteDriftPath = url.pathname.match(/^\/api\/v1\/rich-documents\/([^/]+)\/drift$/);
  if (noteDriftPath && request.method === 'GET') {
    let id: string;
    try { id = decodeURIComponent(noteDriftPath[1]!); } catch { return Response.json({ error: 'Invalid note identifier.' }, { status: 400 }); }
    if (!richDocuments.get(id)) return Response.json({ error: 'Unknown rich document' }, { status: 404 });
    return Response.json({ drift: richDocuments.drift(id), path: richDocuments.pathOf(id) });
  }
  const applyMarkdownPath = url.pathname.match(/^\/api\/v1\/rich-documents\/([^/]+)\/apply-markdown$/);
  if (applyMarkdownPath && request.method === 'POST') {
    let id: string;
    try { id = decodeURIComponent(applyMarkdownPath[1]!); } catch { return Response.json({ error: 'Invalid note identifier.' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { markdown?: unknown } | null;
    const markdown = body && typeof body.markdown === 'string' ? body.markdown : undefined;
    try {
      const result = richDocuments.applyMarkdown(id, markdown);
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Markdown could not be applied.';
      const status = message.includes('unavailable') ? 404 : 409;
      return Response.json({ error: message }, { status });
    }
  }
  const discardMarkdownPath = url.pathname.match(/^\/api\/v1\/rich-documents\/([^/]+)\/discard-markdown$/);
  if (discardMarkdownPath && request.method === 'POST') {
    let id: string;
    try { id = decodeURIComponent(discardMarkdownPath[1]!); } catch { return Response.json({ error: 'Invalid note identifier.' }, { status: 400 }); }
    try {
      return Response.json({ document: richDocuments.discardMarkdown(id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Markdown could not be discarded.';
      return Response.json({ error: message }, { status: message.includes('unavailable') ? 404 : 409 });
    }
  }
  const richDocumentPath = url.pathname.match(/^\/api\/v1\/rich-documents\/([^/]+)$/);
  if (richDocumentPath && request.method === 'DELETE') {
    let id: string;
    try { id = decodeURIComponent(richDocumentPath[1]!); } catch { return Response.json({ error: 'Invalid note identifier.' }, { status: 400 }); }
    const notePath = richDocuments.pathOf(id);
    if (!richDocuments.trash(id)) return Response.json({ error: 'This note is unavailable.' }, { status: 404 });
    for (const node of workspace.list()) {
      if (node.kind !== 'note') continue;
      if (node.targetId === id || (notePath && node.targetId === notePath)) workspace.remove(node.id, 'keep-chats');
    }
    return Response.json({ trashed: true });
  }
  if (richDocumentPath && request.method === 'GET') {
    let documentId: string;
    try { documentId = decodeURIComponent(richDocumentPath[1]!); } catch { return Response.json({ error: 'Invalid rich document identifier' }, { status: 400 }); }
    const document = richDocuments.get(documentId);
    if (!document) return Response.json({ error: 'Unknown rich document' }, { status: 404 });
    return Response.json({ document });
  }
  if (url.pathname === '/api/v1/rich-documents' && request.method === 'GET') {
    return Response.json({ documents: richDocuments.list() });
  }
  if (url.pathname === '/api/v1/rich-documents' && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null);
    if (!validateRichDocument(body)) return Response.json({ error: 'A valid canonical rich document is required' }, { status: 400 });
    try { return Response.json({ document: richDocuments.save(body) }, { status: 201 }); }
    catch (error) { return Response.json({ error: error instanceof Error && error.message === 'Restore this note before saving it.' ? error.message : 'This note could not be saved. Reopen it before trying again.' }, { status: 409 }); }
  }
  if (url.pathname === '/api/v1/lab/apps' && request.method === 'GET') {
    return Response.json({ apps: availableActions() });
  }
  if (url.pathname === '/api/v1/lab/apps' && request.method === 'POST') {
    try {
      const definition = parseLabAppOverride(await request.json());
      const slug = `custom-${crypto.randomUUID()}`;
      writeCustomVaultAction(vaultRoot, slug, definition);
      return Response.json({ app: availableActions().find((app) => app.id === slug) }, { status: 201 });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The app could not be created.' }, { status: 400 }); }
  }
  const labAppPath = url.pathname.match(/^\/api\/v1\/lab\/apps\/([^/]+)$/);
  if (labAppPath && (request.method === 'PATCH' || request.method === 'DELETE')) {
    let appId: string;
    try { appId = decodeURIComponent(labAppPath[1]!); } catch { return Response.json({ error: 'Invalid app identifier.' }, { status: 400 }); }
    const base = availableActions().find((app) => app.id === appId);
    if (!base) return Response.json({ error: 'Unknown app.' }, { status: 404 });
    if (request.method === 'DELETE') {
      if (!base.custom) return Response.json({ error: 'Bundled Actions cannot be deleted.' }, { status: 400 });
      removeCustomVaultAction(vaultRoot, appId);
      return Response.json({ app: availableActions().find((app) => app.id === appId) ?? null });
    }
    const body: unknown = await request.json().catch(() => null);
    try {
      const override = parseLabAppOverride(body);
      if (!base.custom) return Response.json({ error: 'Fork a bundled Action into actions/ before editing it.' }, { status: 400 });
      writeCustomVaultAction(vaultRoot, appId, override);
      return Response.json({ app: availableActions().find((app) => app.id === appId) });
    } catch (reason) {
      return Response.json({ error: reason instanceof Error ? reason.message : 'This app edit could not be saved.' }, { status: 400 });
    }
  }
  if (url.pathname === '/api/v1/lab/glossary' && request.method === 'GET') {
    return Response.json({ entries: loadLabGlossary() });
  }
  if (url.pathname === '/api/v1/knowledge-feeds' && request.method === 'GET') {
    const installed = new Set(documents.documents(null).map((document) => document.id));
    return Response.json({ feeds: knowledgeFeeds.list(installed) });
  }
  if (url.pathname === '/api/v1/knowledge-feeds' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { url?: unknown } | null;
    if (!body || typeof body.url !== 'string' || !body.url.trim()) return Response.json({ error: 'Enter an HTTPS knowledge feed URL.' }, { status: 400 });
    try {
      const feed = await knowledgeFeeds.addRemote(body.url.trim());
      return Response.json({ feed }, { status: 201 });
    } catch (reason) {
      return Response.json({ error: reason instanceof Error ? reason.message : 'This feed could not be added.' }, { status: 400 });
    }
  }
  const knowledgeFeedPath = url.pathname.match(/^\/api\/v1\/knowledge-feeds\/([^/]+)$/);
  if (knowledgeFeedPath && request.method === 'DELETE') {
    let feedId: string;
    try { feedId = decodeURIComponent(knowledgeFeedPath[1]!); } catch { return Response.json({ error: 'Invalid feed identifier.' }, { status: 400 }); }
    if (!knowledgeFeeds.removeRemote(feedId)) return Response.json({ error: 'Unknown or built-in feed.' }, { status: 404 });
    return new Response(null, { status: 204 });
  }
  const knowledgeFeedRefresh = url.pathname.match(/^\/api\/v1\/knowledge-feeds\/([^/]+)\/refresh$/);
  if (knowledgeFeedRefresh && request.method === 'POST') {
    let feedId: string;
    try { feedId = decodeURIComponent(knowledgeFeedRefresh[1]!); } catch { return Response.json({ error: 'Invalid feed identifier.' }, { status: 400 }); }
    try {
      const installed = new Set(documents.documents(null).map((document) => document.id));
      const feed = await knowledgeFeeds.refresh(feedId);
      feed.entries = knowledgeFeeds.list(installed).find((item) => item.id === feedId)?.entries ?? feed.entries;
      return Response.json({ feed });
    } catch (reason) {
      return Response.json({ error: reason instanceof Error ? reason.message : 'This feed could not be refreshed.' }, { status: 400 });
    }
  }
  const knowledgeFeedInstall = url.pathname.match(/^\/api\/v1\/knowledge-feeds\/([^/]+)\/entries\/([^/]+)\/install$/);
  if (knowledgeFeedInstall && request.method === 'POST') {
    let feedId: string;
    let entryId: string;
    try {
      feedId = decodeURIComponent(knowledgeFeedInstall[1]!);
      entryId = decodeURIComponent(knowledgeFeedInstall[2]!);
    } catch {
      return Response.json({ error: 'Invalid feed or entry identifier.' }, { status: 400 });
    }
    try {
      const result = await knowledgeFeeds.install({ feedId, entryId, knowledge: knowledgeSeedTarget });
      return Response.json(result, { status: result.alreadyInstalled ? 200 : 201 });
    } catch (reason) {
      return Response.json({ error: reason instanceof Error ? reason.message : 'This document could not be installed.' }, { status: 400 });
    }
  }
  if (url.pathname === '/api/v1/methods' && request.method === 'GET') {
    return Response.json({ definitions: methods.list() });
  }
  if (url.pathname === '/api/v1/tools' && request.method === 'GET') {
    const available = tools.definitions(true);
    return Response.json({ connections: tools.connections(), definitions: tools.definitions(), chatAvailableToolIds: available.map((definition) => definition.id), defaultChatToolIds: defaultChatToolIds(available) });
  }
  if (url.pathname === '/api/v1/tools/connections' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.id !== 'string' || !body.id || typeof body.name !== 'string' || !body.name.trim() || (body.kind !== 'openapi' && body.kind !== 'mcp')) return Response.json({ error: 'Enter a connection name and supported transport.' }, { status: 400 });
    if (body.id === LEMONADE_TOOL_CONNECTION_ID || body.id === 'builtin') return Response.json({ error: 'This connection is configured by AIR Office.' }, { status: 409 });
    const connection = { id: body.id, name: body.name.trim(), kind: body.kind, endpoint: body.endpoint, discoveredAt: null, enabled: false, ...(body.local === undefined ? {} : { local: body.local }) };
    if (!validateToolConnection(connection) || (!connection.local && (typeof connection.endpoint !== 'string' || !/^https?:\/\//i.test(connection.endpoint)))) return Response.json({ error: 'Choose a curated local MCP package or a valid HTTP or HTTPS endpoint.' }, { status: 400 });
    try {
      await localTools.stop(connection.id);
      remoteToolRestoration.delete(connection.id);
      tools.saveConnection(connection);
      return Response.json({ connection }, { status: 201 });
    }
    catch { return Response.json({ error: 'The connection could not be saved.' }, { status: 400 }); }
  }
  const toolConnectionPath = url.pathname.match(/^\/api\/v1\/tools\/connections\/([^/]+)$/);
  if (toolConnectionPath && request.method === 'PATCH') {
    let connectionId: string;
    try { connectionId = decodeURIComponent(toolConnectionPath[1]!); } catch { return Response.json({ error: 'Invalid connection identifier.' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
    const connection = tools.connections().find((item) => item.id === connectionId);
    if (!connection || typeof body?.enabled !== 'boolean') return Response.json({ error: 'Choose a saved connection and its enabled state.' }, { status: 400 });
    if (!body.enabled) await localTools.stop(connectionId);
    const updated = { ...connection, enabled: body.enabled };
    remoteToolRestoration.delete(connectionId);
    tools.saveConnection(updated);
    return Response.json({ connection: updated });
  }
  if (toolConnectionPath && request.method === 'DELETE') {
    let connectionId: string;
    try { connectionId = decodeURIComponent(toolConnectionPath[1]!); } catch { return Response.json({ error: 'Invalid connection identifier.' }, { status: 400 }); }
    const connection = tools.connections().find((item) => item.id === connectionId);
    if (!connection) return Response.json({ error: 'Unknown connection.' }, { status: 404 });
    if (connection.kind === 'builtin' || connectionId === LEMONADE_TOOL_CONNECTION_ID) return Response.json({ error: 'This connection is configured by AIR Office.' }, { status: 409 });
    try {
      if (connection.kind === 'mcp' && !connection.local) await mcpOAuth.disconnect(connectionId);
      if (await credentialStore.forget(connectionId) === 'failed') throw new Error('Credential removal failed.');
    } catch { return Response.json({ error: 'The connection credentials could not be removed securely. Try removing the connection again.' }, { status: 502 }); }
    await localTools.stop(connectionId);
    remoteToolRestoration.delete(connectionId);
    tools.removeConnection(connectionId);
    return new Response(null, { status: 204 });
  }
  const toolConnectionCredential = url.pathname.match(/^\/api\/v1\/tools\/connections\/([^/]+)\/credential$/);
  if (toolConnectionCredential && (request.method === 'PUT' || request.method === 'DELETE')) {
    let connectionId: string;
    try { connectionId = decodeURIComponent(toolConnectionCredential[1]!); } catch { return Response.json({ error: 'Invalid connection identifier.' }, { status: 400 }); }
    if (connectionId === LEMONADE_TOOL_CONNECTION_ID) return Response.json({ error: 'Local AI credentials are supplied by the native runtime.' }, { status: 409 });
    if (!tools.connections().some((connection) => connection.id === connectionId)) return Response.json({ error: 'Unknown connection.' }, { status: 404 });
    remoteToolRestoration.delete(connectionId);
    if (tools.connections().find((item) => item.id === connectionId)?.local) await localTools.stop(connectionId);
    if (request.method === 'DELETE') {
      const connection = tools.connections().find((item) => item.id === connectionId);
      if (connection?.kind === 'mcp' && !connection.local) {
        try { await mcpOAuth.disconnect(connectionId); }
        catch { return Response.json({ error: 'The sign-in credentials could not be removed from the system keychain.' }, { status: 502 }); }
      }
      const removal = await credentialStore.forget(connectionId);
      if (removal === 'failed') return Response.json({ error: 'The connection secret could not be removed from the system keychain.' }, { status: 502 });
      return new Response(null, { status: 204 });
    }
    const body = await request.json().catch(() => null) as { secret?: unknown } | null;
    if (typeof body?.secret !== 'string' || body.secret.length < 1 || body.secret.length > 10000) return Response.json({ error: 'Enter a connection secret.' }, { status: 400 });
    try { await credentialStore.store(connectionId, body.secret); return Response.json({ configured: true }); }
    catch { return Response.json({ error: 'The connection secret could not be saved securely.' }, { status: 503 }); }
  }
  const toolDiscoverPath = url.pathname.match(/^\/api\/v1\/tools\/connections\/([^/]+)\/discover$/);
  if (toolDiscoverPath && request.method === 'POST') {
    let connectionId: string;
    try { connectionId = decodeURIComponent(toolDiscoverPath[1]!); } catch { return Response.json({ error: 'Invalid connection identifier.' }, { status: 400 }); }
    const connection = tools.connections().find((item) => item.id === connectionId);
    if (!connection) return Response.json({ error: 'Unknown connection.' }, { status: 404 });
    if (connection.local) return Response.json({ error: 'Use the explicit local MCP start operation to discover its tools.' }, { status: 409 });
    try {
      remoteToolRestoration.delete(connection.id);
      const discovered = constrainLemonadeTools(connection, await remoteTools.discover(connection), localInference);
      const currentConnection = tools.connections().find((item) => item.id === connection.id);
      if (!currentConnection || JSON.stringify(currentConnection) !== JSON.stringify(connection)) return Response.json({ error: 'The tool connection changed during discovery. Try again.' }, { status: 409 });
      const previous = tools.definitions().filter((item) => item.connectionId === connection.id);
      const refreshed = discovered.map((operation) => {
        const existing = previous.find((item) => item.id === operation.definition.id);
        const unchanged = existing && existing.name === operation.definition.name && existing.effect === operation.definition.effect && JSON.stringify(existing.inputSchema) === JSON.stringify(operation.definition.inputSchema);
        return { ...operation, definition: { ...operation.definition, enabled: unchanged ? existing.enabled : false } };
      });
      for (const operation of refreshed) tools.saveDefinition(operation.definition);
      const ids = new Set(refreshed.map(({ definition }) => definition.id));
      for (const removed of previous.filter((item) => !ids.has(item.id))) tools.saveDefinition({ ...removed, enabled: false });
      remoteTools.install(refreshed, (id, handler) => tools.setHandler(id, handler));
      remoteToolRestoration.delete(connection.id);
      remoteToolRestoration.set(connection.id, Promise.resolve(ids));
      const updated = { ...connection, discoveredAt: new Date().toISOString() };
      tools.saveConnection(updated);
      return Response.json({ connection: updated, definitions: refreshed.map(({ definition }) => definition) });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Tools could not be discovered.' }, { status: 502 }); }
  }
  if (url.pathname === '/api/v1/tools/enable' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { id?: unknown; enabled?: unknown } | null;
    if (!body || typeof body.id !== 'string' || typeof body.enabled !== 'boolean') return Response.json({ error: 'Choose a tool and its enabled state.' }, { status: 400 });
    const definition = tools.definitions().find((item) => item.id === body.id);
    if (!definition) return Response.json({ error: 'Unknown tool.' }, { status: 404 });
    try { tools.saveDefinition({ ...definition, enabled: body.enabled }); remoteToolRestoration.delete(definition.connectionId); return Response.json({ definition: { ...definition, enabled: body.enabled } }); }
    catch { return Response.json({ error: 'The tool setting could not be saved.' }, { status: 400 }); }
  }
  if (url.pathname === '/api/v1/tools/invoke' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { id?: unknown; input?: unknown; confirmed?: unknown } | null;
    if (!body || typeof body.id !== 'string' || body.id.length > 300) return Response.json({ error: 'Choose an available tool.' }, { status: 400 });
    const definition = tools.definitions(true).find((item) => item.id === body.id);
    if (!definition) return Response.json({ error: 'This tool is not enabled.' }, { status: 404 });
    if (definition.effect === 'mutate' && body.confirmed !== true) return Response.json({ error: 'This operation needs your confirmation before it can run.' }, { status: 409 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try { await ensureRemoteToolHandler(definition); return Response.json({ invocation: await tools.invoke(definition.id, body.input, AbortSignal.any([controller.signal, request.signal])) }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The connected tool is unavailable.' }, { status: 409 }); }
    finally { clearTimeout(timeout); }
  }
  if (url.pathname === '/api/v1/automations' && request.method === 'GET') return Response.json({ automations: automations.list() });
  if (url.pathname === '/api/v1/automations' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { definition?: unknown; confirmed?: unknown } | null;
    const raw = body?.definition;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Response.json({ error: 'Enter a valid schedule with at least one prompt or tool step.' }, { status: 400 });
    const record = raw as Record<string, unknown>;
    const definition = {
      ...record,
      path: typeof record.path === 'string' && record.path ? record.path : automationRelative(String(record.id ?? '')),
    };
    if (!validateAutomation(definition)) return Response.json({ error: 'Enter a valid schedule with at least one prompt or tool step.' }, { status: 400 });
    try { await refreshModelReferenceRegistry(); validateScheduledDefinition(definition, calendarPathSet(), body?.confirmed === true); }
    catch (reason) { return Response.json({ error: reason instanceof Error ? reason.message : 'Invalid automation.' }, { status: reason instanceof Error && reason.message.startsWith('This schedule may change data') ? 409 : 400 }); }
    try { return Response.json({ automation: automations.save(definition) }, { status: 201 }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The automation could not be saved.' }, { status: 400 }); }
  }
  if (url.pathname === '/api/v1/automations/history' && request.method === 'GET') {
    const byPath = url.searchParams.get('automationPath') ?? undefined;
    const byId = url.searchParams.get('automationId');
    const path = byPath ?? (byId ? automations.get(byId)?.path : undefined);
    return Response.json({ history: automations.history(path) });
  }
  const automationRun = url.pathname.match(/^\/api\/v1\/automations\/([^/]+)\/run$/);
  if (automationRun && request.method === 'POST') {
    const definition = automations.list().find((item) => item.id === decodeURIComponent(automationRun[1]!));
    if (!definition) return Response.json({ error: 'Action not found.' }, { status: 404 });
    const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
    try {
      await refreshModelReferenceRegistry();
      validateScheduledDefinition({ ...definition, enabled: true }, calendarPathSet(), body?.confirmed === true);
      return Response.json({ occurrence: await automations.runNow(definition.path) }, { status: 202 });
    } catch (reason) { return Response.json({ error: reason instanceof Error ? reason.message : 'Action could not run.' }, { status: 400 }); }
  }
  const automationPath = url.pathname.match(/^\/api\/v1\/automations\/([^/]+)$/);
  if (automationPath && request.method === 'DELETE') {
    automations.remove(decodeURIComponent(automationPath[1]!));
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/api/v1/automations/jobs' && request.method === 'GET') return Response.json({ jobs: automations.jobs() });
  const automationCancel = url.pathname.match(/^\/api\/v1\/automations\/jobs\/([^/]+)$/);
  if (automationCancel && request.method === 'DELETE') {
    try { return Response.json({ job: automations.cancel(decodeURIComponent(automationCancel[1]!)) }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The run could not be cancelled.' }, { status: 409 }); }
  }
  if (url.pathname === '/api/v1/calendar/lists' && request.method === 'GET') return Response.json({ lists: calendarStore.lists() });
  if (url.pathname === '/api/v1/calendar/template' && request.method === 'GET') {
    try { return Response.json({ template: calendarJsonTemplate(url.searchParams.get('timezone') ?? undefined) }); }
    catch { return Response.json({ error: 'Use a valid IANA timezone.' }, { status: 400 }); }
  }
  if (url.pathname === '/api/v1/calendar/import' && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('bundle' in body)) return Response.json({ error: 'Provide a calendar JSON bundle.' }, { status: 400 });
    if (JSON.stringify(body.bundle).length > 128000) return Response.json({ error: 'Calendar JSON must be at most 128,000 characters.' }, { status: 400 });
    try {
      await refreshModelReferenceRegistry();
      if ('preview' in body && body.preview === true) {
        const plan = calendarExchange.preview(body.bundle, true);
        const requiresConfirmation = plan.automations.some((item) => item.enabled && item.steps.some((step) => step.kind === 'tool' && tools.definitions().find((tool) => tool.id === step.toolId)?.effect === 'mutate'));
        return Response.json({ preview: plan, requiresConfirmation });
      }
      return Response.json({ imported: calendarExchange.apply(body.bundle, 'confirmed' in body && body.confirmed === true) });
    } catch (reason) { return Response.json({ error: reason instanceof Error ? reason.message : 'Calendar import failed.' }, { status: 400 }); }
  }
  if (url.pathname === '/api/v1/calendar/lists' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { list?: unknown } | null;
    const candidate = body?.list;
    if (!validateCalendarList(candidate)) return Response.json({ error: 'Enter a calendar name and a hex color.' }, { status: 400 });
    return Response.json({ list: calendarStore.saveList(candidate) }, { status: 201 });
  }
  const calendarListPath = url.pathname.match(/^\/api\/v1\/calendar\/lists\/([^/]+)$/);
  if (calendarListPath && request.method === 'DELETE') {
    let listId: string;
    try { listId = decodeURIComponent(calendarListPath[1]!); } catch { return Response.json({ error: 'Invalid calendar identifier.' }, { status: 400 }); }
    if (!calendarStore.lists().some((item) => item.id === listId)) return Response.json({ error: 'Unknown calendar.' }, { status: 404 });
    calendarStore.deleteList(listId);
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/api/v1/calendar/events' && request.method === 'GET') {
    const calendarId = url.searchParams.get('calendarId') ?? undefined;
    return Response.json({ events: calendarStore.events(calendarId) });
  }
  if (url.pathname === '/api/v1/calendar/events' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { event?: unknown } | null;
    const candidate = body?.event;
    if (!validateCalendarEvent(candidate)) return Response.json({ error: 'Enter a title and a valid date for the event.' }, { status: 400 });
    return Response.json({ event: calendarStore.saveEvent(candidate) }, { status: 201 });
  }
  const calendarEventPath = url.pathname.match(/^\/api\/v1\/calendar\/events\/([^/]+)$/);
  if (calendarEventPath && request.method === 'DELETE') {
    let eventId: string;
    try { eventId = decodeURIComponent(calendarEventPath[1]!); } catch { return Response.json({ error: 'Invalid event identifier.' }, { status: 400 }); }
    if (!calendarStore.events().some((item) => item.id === eventId)) return Response.json({ error: 'Unknown event.' }, { status: 404 });
    calendarStore.deleteEvent(eventId);
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/api/v1/methods' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!validateDefinition(body)) return Response.json({ error: 'A valid agent, prompt, or skill definition is required' }, { status: 400 });
    try {
      if (body.kind === 'preset' && body.value.modelReference) {
        const resolution = resolveModelReference(body.value.modelReference, await refreshModelReferenceRegistry());
        if (resolution.state !== 'available') return Response.json({ error: resolution.message, code: resolution.state }, { status: 409 });
      }
      return Response.json({ definition: methods.save(body) }, { status: 201 });
    } catch {
      return Response.json({ error: 'The definition could not be saved. Its identity must retain the same definition kind.' }, { status: 409 });
    }
  }
  if (url.pathname === '/api/v1/methods/import' && request.method === 'POST') {
    const raw = await request.json().catch(() => null);
    if (!validateMethodsBundle(raw)) return Response.json({ error: 'The methods bundle does not match the supported format and version.' }, { status: 400 });
    let result: ReturnType<typeof methods.importBundle>;
    try { result = methods.importBundle(raw); }
    catch { return Response.json({ error: 'The bundle could not be imported. No definitions were changed.' }, { status: 400 }); }
    return Response.json({ format: raw.format, version: raw.version, imported: result.imported.length, conflicts: result.conflicts, definitions: result.imported }, { status: 201 });
  }
  if (url.pathname === '/api/v1/methods/export' && request.method === 'GET') {
    return Response.json({ bundle: methods.exportBundle() });
  }
  const methodHistory = url.pathname.match(/^\/api\/v1\/methods\/([^/]+)\/history$/);
  if (methodHistory && request.method === 'GET') {
    let definitionId: string;
    try { definitionId = decodeURIComponent(methodHistory[1]!); } catch { return Response.json({ error: 'Invalid method identifier' }, { status: 400 }); }
    return Response.json({ history: methods.history(definitionId) });
  }
  const methodRestore = url.pathname.match(/^\/api\/v1\/methods\/([^/]+)$/);
  if (methodRestore && (request.method === 'GET' || request.method === 'PATCH')) {
    let definitionId: string;
    try { definitionId = decodeURIComponent(methodRestore[1]!); } catch { return Response.json({ error: 'Invalid method identifier' }, { status: 400 }); }
    if (request.method === 'GET') {
      const definition = methods.get(definitionId);
      if (!definition) return Response.json({ error: 'Unknown method definition' }, { status: 404 });
      return Response.json({ definition });
    }
    const body = await request.json().catch(() => null) as { versionId?: unknown } | null;
    if (!body || typeof body.versionId !== 'string' || !body.versionId || body.versionId.length > 200) return Response.json({ error: 'A version identifier is required to restore' }, { status: 400 });
    const restored = methods.restore(body.versionId, definitionId);
    if (!restored) return Response.json({ error: 'Unknown method version' }, { status: 404 });
    return Response.json({ definition: restored });
  }
  if (url.pathname === '/api/v1/collections' && request.method === 'GET') {
    return Response.json({ collections: knowledge.collections().filter(collection => collection.id !== REASONING_COLLECTION_ID) });
  }
  if (url.pathname === '/api/v1/web-sources/save' && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('conversationId' in body) || typeof body.conversationId !== 'string' || !('messageId' in body) || typeof body.messageId !== 'string' || !('collectionId' in body) || typeof body.collectionId !== 'string' || !('urls' in body) || !Array.isArray(body.urls) || !body.urls.length || body.urls.length > 10 || !body.urls.every((item): item is string => typeof item === 'string')) return Response.json({ error: 'Choose up to ten sources and a Knowledge collection.' }, { status: 400 });
    const collectionId = body.collectionId;
    if (!knowledge.collections().some((collection) => collection.id === collectionId)) return Response.json({ error: 'This Knowledge collection is no longer available.' }, { status: 404 });
    const message = conversations.load(body.conversationId)?.messages.find((entry) => entry.id === body.messageId && entry.role === 'assistant');
    if (!message) return Response.json({ error: 'The source message is no longer available.' }, { status: 404 });
    const pages = fetchedWebPages(message.output);
    const urls = [...new Set(body.urls)];
    if (urls.some((address) => !pages.some((page) => page.url === address))) return Response.json({ error: 'Only pages opened in this reply can be saved. Search snippets are not sources.' }, { status: 400 });
    const prefix = 'prefix' in body && typeof body.prefix === 'string' ? body.prefix.slice(0, 40) : '';
    const existing = new Set(documents.documents(collectionId).map((document) => document.id));
    const saved: string[] = [];
    const skipped: string[] = [];
    for (const page of pages.filter((page) => urls.includes(page.url))) {
      const canonical = new URL(page.url); canonical.hash = '';
      const documentId = `web-${createHash('sha256').update(`${collectionId}\n${canonical.href}`).digest('hex')}`;
      if (existing.has(documentId)) { skipped.push(page.url); continue; }
      const content = `Source: ${page.url}\nOpened: ${page.fetchedAt}\n${page.truncated ? 'Note: the captured page was truncated.\n' : ''}\n${page.content}`;
      const result = documents.ingest({ documentId, name: `${prefix}${page.title}.md`.slice(0, 200), collectionId, bytes: new TextEncoder().encode(content) });
      autoIndexVersion({ collectionId, versionId: result.version.id, content });
      existing.add(documentId);
      saved.push(page.url);
    }
    return Response.json({ saved, skipped });
  }
  if (url.pathname === '/api/v1/collections' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; description?: unknown } | null;
    if (!body || typeof body.id !== 'string' || !body.id || body.id.length > 200 || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) return Response.json({ error: 'A collection identifier and name are required' }, { status: 400 });
    if (body.description !== undefined && body.description !== null && (typeof body.description !== 'string' || body.description.length > 2_000)) return Response.json({ error: 'A collection description must be a short text' }, { status: 400 });
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    return Response.json({ collection: knowledge.createCollection(body.id, body.name.trim(), description) }, { status: 201 });
  }
  const collectionPath = url.pathname.match(/^\/api\/v1\/collections\/([^/]+)$/);
  if (collectionPath) {
    let collectionId: string;
    try { collectionId = decodeURIComponent(collectionPath[1]!); } catch { return Response.json({ error: 'Invalid collection identifier.' }, { status: 400 }); }
    if (collectionId === REASONING_COLLECTION_ID) return Response.json({ error: 'Manage these memories in Reasoning.' }, { status: 403 });
    if (request.method === 'GET') {
      const collection = knowledge.collections().find((entry) => entry.id === collectionId);
      if (!collection) return Response.json({ error: 'Unknown collection.' }, { status: 404 });
      return Response.json({ collection, documents: documents.documents(collectionId) });
    }
    if (request.method === 'PATCH' || request.method === 'PUT') {
      const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown } | null;
      if (!body) return Response.json({ error: 'A collection name and description are required' }, { status: 400 });
      const existing = knowledge.collections().find((entry) => entry.id === collectionId);
      if (!existing) return Response.json({ error: 'Unknown collection.' }, { status: 404 });
      const name = body.name === undefined ? existing.name : body.name;
      const description = body.description === undefined ? (existing.description ?? '') : body.description;
      if (typeof name !== 'string' || !name.trim() || name.length > 200) return Response.json({ error: 'A collection name is required' }, { status: 400 });
      if (typeof description !== 'string' || description.length > 2_000) return Response.json({ error: 'A collection description must be a short text' }, { status: 400 });
      return Response.json({ collection: knowledge.updateCollection(collectionId, name.trim(), description.trim()) });
    }
    if (request.method === 'DELETE') {
      const existing = knowledge.collections().find((entry) => entry.id === collectionId);
      if (!existing) return Response.json({ error: 'Unknown collection.' }, { status: 404 });
      // The documents of a collection are removed with it, and their indexed
      // sources go first so no chunk survives without its collection.
      for (const document of documents.documents(collectionId)) {
        for (const version of documents.versions(document.id)) knowledge.removeSource(version.id);
        documents.deleteDocument(document.id);
      }
      knowledge.deleteCollection(collectionId);
      return Response.json({ deleted: true });
    }
  }
  if (url.pathname === '/api/v1/chat/attachments' && request.method === 'POST') {
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > 11 * 1024 * 1024) return Response.json({ error: 'Attachment is too large.' }, { status: 413 });
    const form = await request.formData().catch(() => null);
    const id = form?.get('id');
    const file = form?.get('file');
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !(file instanceof File) || !file.name || file.name.length > 200 || file.size === 0 || file.size > 10 * 1024 * 1024) return Response.json({ error: 'Invalid attachment.' }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = documents.versions(id);
    if (existing.length && existing.every(version => version.contentHash !== createHash('sha256').update(bytes).digest('hex'))) return Response.json({ error: 'Attachment identity already exists.' }, { status: 409 });
    const result = documents.ingest({ documentId: id, name: file.name, collectionId: null, bytes });
    documents.retainSourceBytes(result.version.id, bytes);
    return Response.json({ id, versionId: result.version.id }, { status: 201 });
  }
  if (url.pathname === '/api/v1/documents' && request.method === 'GET') {
    const collectionId = url.searchParams.get('collectionId');
    return Response.json({ documents: documents.documents(collectionId) });
  }
  if (url.pathname === '/api/v1/documents' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { documentId?: unknown; name?: unknown; collectionId?: unknown; content?: unknown } | null;
    if (!body || typeof body.documentId !== 'string' || !body.documentId || body.documentId.length > 200 || typeof body.name !== 'string' || !body.name || body.name.length > 200 || typeof body.content !== 'string' || body.content.length > 1_500_000 || (body.collectionId !== null && body.collectionId !== undefined && (typeof body.collectionId !== 'string' || body.collectionId.length > 200))) return Response.json({ error: 'A document identifier, name and text content are required' }, { status: 400 });
    const bytes = new TextEncoder().encode(body.content);
    const result = documents.ingest({ documentId: body.documentId, name: body.name, collectionId: (body.collectionId as string | null | undefined) ?? null, bytes });
    documents.retainSourceBytes(result.version.id, bytes);
    // A document that entered a collection is indexed without being asked
    // for. The text the caller submitted is the source's own text, so it is
    // indexed directly. The stored artifact is left alone, because an
    // artifact is what the extraction step produces.
    const collectionId = (body.collectionId as string | null | undefined) ?? null;
    if (collectionId) autoIndexVersion({ collectionId, versionId: result.version.id, content: body.content });
    return Response.json({ document: result.document, version: result.version, created: result.created }, { status: result.created ? 201 : 200 });
  }
  const documentPath = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)$/);
  if (documentPath && request.method === 'DELETE') {
    let documentId: string;
    try { documentId = decodeURIComponent(documentPath[1]!); } catch { return Response.json({ error: 'Invalid document identifier.' }, { status: 400 }); }
    if (!documents.documents(null).some((entry) => entry.id === documentId)) return Response.json({ error: 'Unknown document.' }, { status: 404 });
    for (const version of documents.versions(documentId)) knowledge.removeSource(version.id);
    documents.deleteDocument(documentId);
    return Response.json({ deleted: true });
  }
  const documentVersions = url.pathname.match(/^\/api\/v1\/documents\/([^/]+)\/versions$/);
  if (documentVersions && request.method === 'GET') {
    let documentId: string;
    try { documentId = decodeURIComponent(documentVersions[1]!); } catch { return Response.json({ error: 'Invalid document identifier' }, { status: 400 }); }
    return Response.json({ versions: documents.versions(documentId) });
  }
  const versionLookup = url.pathname.match(/^\/api\/v1\/versions\/([^/]+)$/);
  if (versionLookup && request.method === 'GET') {
    let versionId: string;
    try { versionId = decodeURIComponent(versionLookup[1]!); } catch { return Response.json({ error: 'Invalid version identifier' }, { status: 400 }); }
    const version = documents.version(versionId);
    if (!version) return Response.json({ error: 'Unknown source version' }, { status: 404 });
    return Response.json({ version });
  }
  const versionSource = url.pathname.match(/^\/api\/v1\/versions\/([^/]+)\/source$/);
  if (versionSource && request.method === 'GET') {
    let versionId: string;
    try { versionId = decodeURIComponent(versionSource[1]!); } catch { return Response.json({ error: 'Invalid source identifier.' }, { status: 400 }); }
    const version = documents.version(versionId);
    const source = version && documents.documents(null).find((document) => document.id === version.documentId);
    const bytes = version && documents.sourceBytes(version.id);
    if (!source || !bytes) return Response.json({ error: 'The source is unavailable.' }, { status: 404 });
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
  }
  const versionArtifact = url.pathname.match(/^\/api\/v1\/versions\/([^/]+)\/artifact$/);
  if (versionArtifact && request.method === 'GET') {
    let versionId: string;
    try { versionId = decodeURIComponent(versionArtifact[1]!); } catch { return Response.json({ error: 'Invalid version identifier' }, { status: 400 }); }
    const artifact = documents.artifact(versionId);
    if (!artifact) return Response.json({ error: 'No extraction artifact for this version' }, { status: 404 });
    return Response.json({ artifact });
  }
  const versionExtract = url.pathname.match(/^\/api\/v1\/versions\/([^/]+)\/extract$/);
  if (versionExtract && request.method === 'POST') {
    if (!extractionWorker) return Response.json({ error: 'The document extraction worker is not available on this host.' }, { status: 503 });
    let versionId: string;
    try { versionId = decodeURIComponent(versionExtract[1]!); } catch { return Response.json({ error: 'Invalid version identifier' }, { status: 400 }); }
    const body = await request.json().catch(() => null) as { content?: unknown } | null;
    if (!body || typeof body.content !== 'string' || body.content.length > 1_500_000) return Response.json({ error: 'The source text content is required to extract.' }, { status: 400 });
    const scratch = mkdtempSync(join(scratchRoot, 'air-extract-'));
    try {
      const inputPath = join(scratch, 'source.txt');
      writeFileSync(inputPath, body.content, 'utf8');
      const artifact = await documents.extract(versionId, inputPath);
      return Response.json({ artifact });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Extraction failed.' }, { status: 500 });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  if (url.pathname === '/api/v1/portable/vault' && request.method === 'GET') {
    try {
      const { exportVaultZip } = await import('@office/vault/portable');
      const bytes = await exportVaultZip(vaultRoot);
      return new Response(bytes, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="air-office-vault.zip"',
        },
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Vault export failed.' }, { status: 500 });
    }
  }
  if (url.pathname === '/api/v1/portable/vault' && request.method === 'POST') {
    try {
      const { importVaultZip } = await import('@office/vault/portable');
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0) return Response.json({ error: 'A vault zip is required.' }, { status: 400 });
      if (bytes.byteLength > MAX_BUNDLE_BYTES) return Response.json({ error: 'This vault archive is too large.' }, { status: 413 });
      const destination = join(scratchRoot, `vault-import-${crypto.randomUUID()}`);
      mkdirSync(destination, { recursive: true });
      await importVaultZip(bytes, destination);
      return Response.json({ accepted: true, previewRoot: destination, note: 'Archive extracted to a preview folder. Replace AIR_VAULT_ROOT with this tree after review, or copy into the active vault offline.' });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Vault import failed.' }, { status: 400 });
    }
  }
  if (url.pathname === '/api/v1/export' && request.method === 'GET') {
    const bundle = await buildWorkspaceBundle({
      listConversations: async () => {
        const all: { id: string; createdAt: string }[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = conversations.summaries(500, offset);
          all.push(...page.map((summary) => ({ id: summary.id, createdAt: summary.updatedAt })));
          if (page.length < 500) return all;
        }
      },
      readConversation: async (id) => {
        const graph = conversations.load(id);
        if (!graph) throw new Error(`Unknown conversation ${id}.`);
        return JSON.stringify({ ...graph.conversation, messages: graph.messages });
      },
      listCollections: async () => knowledge.collections().filter(collection => collection.id !== REASONING_COLLECTION_ID),
      listDocuments: async () => documents.documents(null).map((document) => ({
        id: document.id,
        name: document.name,
        kind: document.kind,
        collectionId: document.collectionId,
        createdAt: document.createdAt,
        versions: documents.versions(document.id).map((version) => ({ id: version.id, contentHash: version.contentHash, byteSize: version.byteSize, observedAt: version.observedAt }))
      })),
      artifact: (_documentId, versionId) => documents.artifact(versionId),
      sourceBytes: (_documentId, versionId) => documents.sourceBytes(versionId),
      listWorkspaceNodes: async () => {
        const nodes = workspace.list();
        return {
          nodes: nodes.filter((node) => node.kind !== 'mount').map((node) => ({ id: node.id, kind: node.kind, parentId: node.parentId, name: node.name, instruction: node.instruction, ...(node.kind === 'note' ? { targetId: node.targetId } : {}) })),
          disconnectedFolders: nodes.filter((node) => node.kind === 'mount').length
        };
      },
      listAutomations: async () => {
        const schedules = automations.list();
        const portable = schedules.map(portableAutomation).filter((item): item is AutomationDefinition => item !== null);
        return { schedules: portable, omittedSchedules: schedules.length - portable.length };
      },
      listRichDocuments: async () => Promise.all(richDocuments.list().map(async (record) => {
        const note = await ensureNativeRichDocument(record);
        if (!note) throw new Error('A note could not be converted for export.');
        return {
          format: note.format,
          id: note.id,
          ...(note.path ? { path: note.path } : {}),
          title: note.title,
          updatedAt: note.updatedAt,
          body: note.body,
          attachments: note.attachments.map(({ id, name, mediaType, size, dataUrl }) => ({ id, name, mediaType, size, dataUrl })),
        };
      })),
      listMethods: async () => methods.list().map((definition) => {
        if (definition.kind === 'prompt') { const value = definition.value; return { kind: definition.kind, value: { id: value.id, name: value.name, instructions: value.instructions, variables: value.variables, updatedAt: value.updatedAt } }; }
        if (definition.kind === 'skill') { const value = definition.value; return { kind: definition.kind, value: { id: value.id, name: value.name, description: value.description, instructions: value.instructions, updatedAt: value.updatedAt } }; }
        const value = definition.value;
        return { kind: definition.kind, value: { id: value.id, name: value.name, model: value.model, ...(value.provider ? { provider: value.provider } : {}), ...(value.modelReference ? { modelReference: { providerId: value.modelReference.providerId, modelId: value.modelReference.modelId, role: value.modelReference.role } } : {}), instructions: value.instructions, settings: { ...value.settings }, knowledgeCollectionIds: value.knowledgeCollectionIds, skillIds: value.skillIds, toolIds: value.toolIds, updatedAt: value.updatedAt } };
      })
    });
    const serialized = JSON.stringify(bundle);
    if (new TextEncoder().encode(serialized).byteLength > MAX_BUNDLE_BYTES) return Response.json({ error: 'This workspace is too large for a single export.' }, { status: 413 });
    return new Response(serialized, { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/api/v1/import' && request.method === 'POST') {
    const length = Number(request.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BUNDLE_BYTES) return Response.json({ accepted: false, rejections: [{ code: 'oversized', message: `Bundle exceeds ${MAX_BUNDLE_BYTES} bytes` }], restored: { conversations: 0, collections: 0, documents: 0, versions: 0 } }, { status: 413 });
    const raw = await request.text();
    const { report, bundle } = await validateBundle(raw);
    if (!bundle) return Response.json(report, { status: report.rejections[0]?.code === 'oversized' ? 413 : 400 });
    const notes = bundle.payload.richDocuments;
    const importedMethods = { format: 'air-office.methods', version: 1, definitions: bundle.payload.methods };
    const importedNodes = parsePortableWorkspaceNodes(bundle.payload.workspaceNodes);
    const importedSchedules = bundle.payload.automations;
    if (!notes.every(validateRichDocument) || new Set(notes.map((note) => note.id)).size !== notes.length || !validateMethodsBundle(importedMethods) || !importedNodes || !importedSchedules.every(validateAutomation) || new Set(importedSchedules.map((item) => item.id)).size !== importedSchedules.length || importedSchedules.some((item) => !portableAutomation(item))) {
      return Response.json({ ...report, accepted: false, rejections: [{ code: 'corrupt', message: 'Portable workspace data is invalid.' }] }, { status: 400 });
    }
    const missingSources: string[] = [];
    for (const document of bundle.payload.documents) for (const version of document.versions) {
      const encoded = version.sourceBase64;
      if (encoded === null) { missingSources.push(`${document.id}:${version.contentHash.slice(0, 16)}`); continue; }
      if (typeof encoded !== 'string' || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return Response.json({ ...report, accepted: false, rejections: [{ code: 'corrupt', message: 'Portable source bytes are invalid.' }] }, { status: 400 });
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded || bytes.byteLength !== version.byteSize || createHash('sha256').update(bytes).digest('hex') !== version.contentHash) return Response.json({ ...report, accepted: false, rejections: [{ code: 'corrupt', message: 'Portable source bytes do not match their version.' }] }, { status: 400 });
    }
    const conflicts: { kind: 'rich-document' | 'method' | 'workspace' | 'conversation' | 'collection' | 'document' | 'schedule'; id: string }[] = [];
    const trashed = trashedNoteIds();
    const trashedOriginalPaths = new Set(
      richDocuments.trashed().map((item) => {
        if (!item.path?.startsWith(`${VAULT_PATHS.trash}/`)) return null;
        return item.path.slice(`${VAULT_PATHS.trash}/`.length);
      }).filter((path): path is string => Boolean(path)),
    );
    const newNotes = notes.filter((note) => {
      if (trashed.has(note.id) || richDocuments.get(note.id)) { conflicts.push({ kind: 'rich-document', id: note.id }); return false; }
      const path = typeof note.path === 'string' && note.path ? note.path : null;
      if (path) {
        const atPath = richDocuments.get(path);
        if (atPath && atPath.id !== note.id || trashedOriginalPaths.has(path)) {
          conflicts.push({ kind: 'rich-document', id: note.id });
          return false;
        }
      }
      return true;
    });
    for (const note of newNotes) richDocuments.save(note);
    const blockedNodes = new Set<string>();
    let importedNodeCount = 0;
    for (const node of importedNodes) {
      // Notes restored by path already create program/project directories, so the
      // catalog may already list those ids. Reuse them and apply portable labels
      // instead of treating the match as a conflict that would also clear chat folderId.
      const existing = workspace.get(node.id);
      if (existing) {
        const sameNote = node.kind === 'note' && existing.kind === 'note' && existing.targetId === node.targetId;
        const sameContainer = node.kind !== 'note' && existing.kind === node.kind;
        if (!sameNote && !sameContainer) {
          blockedNodes.add(node.id); conflicts.push({ kind: 'workspace', id: node.id }); continue;
        }
        try {
          workspace.update(node.id, { name: node.name, instruction: node.instruction });
          importedNodeCount += 1;
        } catch (error) {
          if (!(error instanceof WorkspaceError)) throw error;
          blockedNodes.add(node.id); conflicts.push({ kind: 'workspace', id: node.id });
        }
        continue;
      }
      if (node.parentId && blockedNodes.has(node.parentId) || node.kind === 'note' && !richDocuments.get(node.targetId)) {
        blockedNodes.add(node.id); conflicts.push({ kind: 'workspace', id: node.id }); continue;
      }
      try { workspace.create(node); importedNodeCount += 1; }
      catch (error) {
        if (!(error instanceof WorkspaceError)) throw error;
        blockedNodes.add(node.id); conflicts.push({ kind: 'workspace', id: node.id });
      }
    }
    const restored = restoreRows(bundle);
    const existingCollections = new Set(knowledge.collections().map((collection) => collection.id));
    let importedCollections = 0;
    for (const collection of restored.collections) {
      if (existingCollections.has(collection.id)) { conflicts.push({ kind: 'collection', id: collection.id }); continue; }
      knowledge.restoreCollection({ id: collection.id, name: collection.name, ...(collection.description ? { description: collection.description } : {}), createdAt: collection.createdAt });
      existingCollections.add(collection.id); importedCollections += 1;
    }
    const existingDocuments = new Set(documents.documents(null).map((document) => document.id));
    let importedDocuments = 0;
    let importedVersions = 0;
    for (const document of restored.documents) {
      if (existingDocuments.has(document.id)) { conflicts.push({ kind: 'document', id: document.id }); continue; }
      for (const version of document.versions) {
        const restoredVersion = documents.restore({
          document: { id: document.id, collectionId: document.collectionId, name: document.name, kind: document.kind, createdAt: document.createdAt },
          version: { contentHash: version.contentHash, byteSize: version.byteSize, observedAt: version.observedAt },
          artifact: version.artifact
        });
        if (typeof version.sourceBase64 === 'string') documents.retainSourceBytes(restoredVersion.id, Buffer.from(version.sourceBase64, 'base64'));
        importedVersions += 1;
      }
      existingDocuments.add(document.id); importedDocuments += 1;
    }
    let importedConversations = 0;
    for (const conversation of restored.conversations) {
      if (conversations.load(conversation.id)) { conflicts.push({ kind: 'conversation', id: conversation.id }); continue; }
      conversations.restore({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        pinned: conversation.pinned === true,
        archivedAt: conversation.archivedAt ?? null,
        tags: toStringList(conversation.tags, 25),
        folderId: conversation.folderId && !blockedNodes.has(conversation.folderId) && workspace.get(conversation.folderId) ? conversation.folderId : null,
        unreadAt: conversation.unreadAt ?? null
      });
      for (const message of conversation.messages) {
        conversations.appendMessage({
          conversationId: conversation.id,
          id: message.id,
          parentId: message.parentId,
          role: message.role,
          content: message.content,
          complete: message.complete,
          runId: message.runId ?? null,
          createdAt: message.createdAt,
          modelId: typeof message.modelId === 'string' ? message.modelId : null,
          modelIndex: typeof message.modelIndex === 'number' && Number.isSafeInteger(message.modelIndex) ? message.modelIndex : 0,
          output: toOutputBlocks(message.output),
          statusHistory: toStatusHistory(message.statusHistory),
          usage: message.usage ?? null,
          error: message.error ?? null,
          files: toStringList(message.files, 200),
          attachments: toAttachments(message.attachments)
        });
      }
      importedConversations += 1;
    }
    const methodImport = methods.importBundle(importedMethods);
    for (const conflict of methodImport.conflicts) conflicts.push({ kind: 'method', id: conflict.id });
    const existingSchedules = new Set(automations.list().map((item) => item.id));
    let scheduleCount = 0;
    let pausedSchedules = 0;
    for (const schedule of importedSchedules) {
      if (existingSchedules.has(schedule.id)) { conflicts.push({ kind: 'schedule', id: schedule.id }); continue; }
      const portable = portableAutomation(schedule);
      if (!portable) continue;
      const schedulePath = portable.path || automationRelative(portable.id);
      const pathOwner = automations.getByPath(schedulePath);
      if (pathOwner && pathOwner.id !== portable.id) { conflicts.push({ kind: 'schedule', id: schedule.id }); continue; }
      automations.save({ ...portable, enabled: false });
      if (portable.enabled) pausedSchedules += 1;
      existingSchedules.add(schedule.id); scheduleCount += 1;
    }
    return Response.json({
      ...report,
      portableWork: { richDocuments: newNotes.length, methods: methodImport.imported.length, workspaceNodes: importedNodeCount, schedules: scheduleCount, pausedSchedules, omittedSchedules: bundle.payload.omittedSchedules, conflicts, missingSources, disconnectedFolders: bundle.payload.disconnectedFolders },
      restored: {
        conversations: importedConversations,
        collections: importedCollections,
        documents: importedDocuments,
        versions: importedVersions
      }
    });
  }
  if (url.pathname === '/api/v1/knowledge/index-status' && request.method === 'GET') {
    const collectionId = url.searchParams.get('collectionId');
    if (!collectionId) return Response.json({ error: 'A collection identifier is required.' }, { status: 400 });
    return Response.json(knowledge.indexStatus(collectionId));
  }
  if (url.pathname === '/api/v1/knowledge/rebuild' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { collectionId?: unknown } | null;
    if (!body || typeof body.collectionId !== 'string' || !knowledge.collections().some((collection) => collection.id === body.collectionId)) return Response.json({ error: 'Unknown collection.' }, { status: 404 });
    // A version without a stored extraction artifact has no text to index.
    // Rebuilding around it would commit an index that claims to cover the
    // collection while holding none of it, so the rebuild is refused with the
    // number of documents that still need extraction.
    const collectionDocuments = documents.documents(body.collectionId);
    const versions = collectionDocuments.flatMap((document) => documents.versions(document.id));
    const sources = versions.flatMap((version) => { const artifact = documents.artifact(version.id); return artifact ? [{ sourceVersionId: version.id, artifact }] : []; });
    const missingExtraction = versions.length - sources.length;
    if (collectionDocuments.length > 0 && sources.length === 0) return Response.json({ error: 'None of the collection documents has extracted text yet. Import the documents again so their text is extracted before indexing.', documentsWithoutText: collectionDocuments.length }, { status: 409 });
    const snapshot = embeddingSelection.snapshot();
    const started = jobs.start('rebuild-collection', `rebuild:${body.collectionId}:${crypto.randomUUID()}`);
    const cancelled = new Set<string>(); indexCancellations.set(started.job.id, cancelled); activeIndexing.add(started.job.id);
    void jobs.run(started.job.id, async (report) => {
      await snapshot.knowledge.rebuildCollection({ collectionId: body.collectionId as string, sources, report, isCancelled: () => cancelled.has(started.job.id) });
      if (missingExtraction > 0) report(1, `done (${missingExtraction} version${missingExtraction === 1 ? '' : 's'} skipped, no extracted text)`);
    }).catch(() => undefined).finally(() => { activeIndexing.delete(started.job.id); indexCancellations.delete(started.job.id); });
    return Response.json({ job: started.job }, { status: 202 });
  }
  if (url.pathname === '/api/v1/knowledge/embedding-probe' && request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('model' in body) || typeof body.model !== 'string') return Response.json({ error: 'Choose a local embedding model.' }, { status: 400 });
    const model = body.model;
    const registry = await refreshModelReferenceRegistry();
    if (!lemonadeDescriptor || !registry.some((entry) => entry.providerId === managedLemonadeProviderId && entry.modelId === model && entry.roles.includes('embedding'))) return Response.json({ error: 'Choose an installed local embedding model.' }, { status: 409 });
    try {
      const result = await new LemonadeModalityAdapter(lemonadeDescriptor).embeddings({ model, input: ['Embedding dimension check.'] }, { signal: request.signal });
      const vector = result.data[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.length > 65536 || vector.some((value) => !Number.isFinite(value))) throw new Error('invalid-vector');
      return Response.json({ model, dimensions: vector.length }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return Response.json({ error: 'Dimensions could not be checked. Check the selected model or enter its documented dimensions.' }, { status: 502 }); }
  }
  if (url.pathname === '/api/v1/knowledge/embedding-model' && request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    try {
      const registry = await refreshModelReferenceRegistry();
      const embedding = registry.find((entry) => entry.providerId === managedLemonadeProviderId && entry.modelId === body?.model);
      if (!embedding?.roles.includes('embedding')) throw new Error('Choose an installed local embedding model. External embedding providers are not supported by this index adapter.');
      if (body?.rerankModel && !registry.some((entry) => entry.providerId === managedLemonadeProviderId && entry.modelId === body.rerankModel && entry.roles.includes('rerank'))) throw new Error('Choose an installed local reranking model.');
      knowledge = embeddingSelection.select({ ...body, mode: 'runtime' }).knowledge;
      // The collections that were indexed with another model, or that were
      // never indexed because no model was selected, are indexed now. The
      // documents are there for that reason, and the user does not have to
      // ask for it a second time.
      autoIndexPendingCollections();
      return Response.json({ ...embeddingSelection.selection(), rebuildRequired: knowledge.collections().some((collection) => knowledge.indexStatus(collection.id).rebuildRequired) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Embedding selection could not be saved.' }, { status: 400 });
    }
  }
  if (url.pathname === '/api/v1/index' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { collectionId?: unknown; versionId?: unknown; content?: unknown } | null;
    if (!body || typeof body.collectionId !== 'string' || !body.collectionId || body.collectionId.length > 200 || typeof body.versionId !== 'string' || !body.versionId || body.versionId.length > 300 || typeof body.content !== 'string' || body.content.length > 1_500_000) return Response.json({ error: 'A collection identifier, source version and text are required to index.' }, { status: 400 });
    if (!knowledge.collections().some((collection) => collection.id === body.collectionId)) return Response.json({ error: 'Unknown collection' }, { status: 404 });
    const snapshot = embeddingSelection.snapshot();
    const started = jobs.start('index-source', `index:${body.collectionId}:${body.versionId}:${JSON.stringify(snapshot.identity)}`);
    if (activeIndexing.has(started.job.id)) return Response.json({ error: 'This source is already being indexed.' }, { status: 409 });
    activeIndexing.add(started.job.id);
    const cancelled = new Set<string>();
    indexCancellations.set(started.job.id, cancelled);
    void (async () => {
      const scratch = mkdtempSync(join(scratchRoot, 'air-index-'));
      try {
        await jobs.run(started.job.id, async (report) => {
          report(0.05, 'extract');
          const inputPath = join(scratch, 'source.txt');
          writeFileSync(inputPath, body.content as string, 'utf8');
          // When the source version is known to the documents module and a worker
          // is present, the real extractor runs. Otherwise the caller-supplied
          // text is used directly, so indexing a transient source still works.
          const knownVersion = documents.version(body.versionId as string) !== null;
          const artifact = extractionWorker && knownVersion ? await documents.extract(body.versionId as string, inputPath) : { extractor: 'inline', extractorVersion: '1', extractionVersion: 'anchor-v1', text: body.content as string, pageCount: null, warnings: [], contentHash: '', createdAt: new Date().toISOString() };
          report(0.2, 'chunk');
          await snapshot.knowledge.indexSourceVersion({ collectionId: body.collectionId as string, sourceVersionId: body.versionId as string, artifact, isCancelled: () => cancelled.has(started.job.id), report: (progress, checkpoint) => report(0.2 + progress * 0.8, checkpoint) });
        });
      } catch (error) {
        const current = jobs.get(started.job.id);
        if (current && !['succeeded', 'failed', 'cancelled'].includes(current.state)) jobs.transition(started.job.id, cancelled.has(started.job.id) ? 'cancelled' : 'failed', error instanceof Error ? error.message : 'Indexing failed.');
      } finally { activeIndexing.delete(started.job.id); indexCancellations.delete(started.job.id); rmSync(scratch, { recursive: true, force: true }); }
    })();
    return Response.json({ job: started.job }, { status: 202 });
  }
  const indexCancel = url.pathname.match(/^\/api\/v1\/index\/([^/]+)$/);
  if (indexCancel && request.method === 'DELETE') {
    let jobId: string;
    try { jobId = decodeURIComponent(indexCancel[1]!); } catch { return Response.json({ error: 'Invalid job identifier' }, { status: 400 }); }
    indexCancellations.get(jobId)?.add(jobId);
    const current = jobs.get(jobId);
    if (current && !['succeeded', 'failed', 'cancelled'].includes(current.state) && !activeIndexing.has(jobId)) jobs.transition(jobId, 'cancelled', 'Cancelled by the operator.');
    return new Response(null, { status: 204 });
  }
  if (url.pathname === '/api/v1/vector/probe' && request.method === 'GET') {
    return Response.json({ vector: probeSqliteVec(sqliteVecPath) });
  }
  if (url.pathname === '/api/v1/search' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { collectionIds?: unknown; query?: unknown; limit?: unknown; mode?: unknown; documentIds?: unknown; wholeCollectionIds?: unknown } | null;
    const validIds = Array.isArray(body?.collectionIds) && body.collectionIds.length > 0 && body.collectionIds.every((id) => typeof id === 'string' && id.length <= 200);
    const documentIds = body?.documentIds === undefined ? [] : body.documentIds;
    const validDocuments = Array.isArray(documentIds) && documentIds.length <= 50 && documentIds.every((id) => typeof id === 'string' && id.length <= 200);
    const wholeCollectionIds = body?.wholeCollectionIds === undefined ? [] : body.wholeCollectionIds;
    const validWholeCollections = Array.isArray(wholeCollectionIds) && wholeCollectionIds.length <= 50 && wholeCollectionIds.every((id) => typeof id === 'string' && Array.isArray(body?.collectionIds) && body.collectionIds.includes(id));
    if (!body || !validIds || !validDocuments || !validWholeCollections || typeof body.query !== 'string' || !body.query.trim() || body.query.length > 1000 || (body.limit !== undefined && (!Number.isSafeInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 50)) || (body.mode !== undefined && !['full-text', 'vector', 'hybrid'].includes(String(body.mode)))) return Response.json({ error: 'A collection set and query are required' }, { status: 400 });
    // Access policy: a collection that does not exist is not readable, so a
    // revoked or unknown collection cannot surface cached results.
    const known = new Set(knowledge.collections().map((collection) => collection.id));
    const policy = { canRead: (collectionId: string) => collectionId !== REASONING_COLLECTION_ID && known.has(collectionId) };
    // An explicit document selection must never broaden to the whole collection.
    const namedDocuments = documentIds as string[];
    const wholeCollections = wholeCollectionIds as string[];
    const selectedDocuments = new Set([...namedDocuments, ...wholeCollections.flatMap((id) => documents.documents(id).map((document) => document.id))]);
    const sourceVersionIds = [...selectedDocuments].flatMap((documentId) => documents.versions(documentId).map((version) => version.id));
    if (namedDocuments.length && !sourceVersionIds.length) return Response.json({ results: [] });
    const mode = (body.mode as 'full-text' | 'vector' | 'hybrid' | undefined) ?? 'full-text';
    const embeddingSnapshot = embeddingSelection.snapshot();
    const embedding = mode === 'full-text' ? undefined : (await embeddingSnapshot.provider.embed([body.query]))[0];
    const results = await embeddingSnapshot.knowledge.retrieve({ collectionIds: body.collectionIds as string[], query: { mode, text: body.query, embedding, index: embeddingSnapshot.identity, limit: (body.limit as number | undefined) ?? 10, ...(sourceVersionIds.length ? { sourceVersionIds } : {}) }, policy });
    // A citation is verified only when its anchor resolves against the stored
    // extraction artifact; everything else stays honestly unresolved.
    let orderedResults = results;
    const rerankModel = embeddingSelection.selection()?.rerankModel;
    if (rerankModel && results.length) {
      if (!lemonadeDescriptor) return Response.json({ error: 'The selected reranker is unavailable. Disable reranking or repair Local AI.' }, { status: 503 });
      try { const ranked = await new LemonadeModalityAdapter(lemonadeDescriptor).rerank({ model: rerankModel, query: body.query, documents: results.map((result) => result.text) }, { signal: request.signal }); orderedResults = applyReranking(results, ranked.results); }
      catch { return Response.json({ error: 'Reranking failed. Disable reranking in Knowledge settings or retry.' }, { status: 502 }); }
    }
    const resolvedResults = orderedResults.map((result) => {
      const artifact = documents.artifact(result.sourceVersionId);
      if (!artifact) return result;
      return { ...result, resolved: resolveAnchor(result.anchor, artifact).resolved };
    });
    embeddingSnapshot.provider.assertCurrent?.();
    return Response.json({ results: resolvedResults });
  }
  if (url.pathname === '/api/v1/jobs' && request.method === 'GET') {
    const states = url.searchParams.get('states')?.split(',').filter(Boolean) as import('@office/contracts/job').JobState[] | undefined;
    return Response.json({ jobs: jobs.list(states && states.length ? states : undefined) });
  }
  const jobPath = url.pathname.match(/^\/api\/v1\/jobs\/([^/]+)$/);
  if (jobPath && request.method === 'GET') {
    let jobId: string;
    try { jobId = decodeURIComponent(jobPath[1]!); } catch { return Response.json({ error: 'Invalid job identifier' }, { status: 400 }); }
    const job = jobs.get(jobId);
    if (!job) return Response.json({ error: 'Unknown job' }, { status: 404 });
    return Response.json({ job });
  }
  if (url.pathname === '/api/v1/reasoning/dataset' && request.method === 'GET') {
    const conversationId = url.searchParams.get('conversationId');
    const graph = conversationId ? conversations.load(conversationId) : null;
    const leafId = url.searchParams.get('leafId') ?? (graph ? activeLeaf(graph) : null);
    if (conversationId && (!graph || !leafId || !graph.messages.some(message => message.id === leafId))) return Response.json({ error: 'Unknown conversation branch.' }, { status: 404 });
    const rows = reasoning.datasetRows(conversationId && leafId ? { conversationId, leafId } : undefined);
    return new Response(exportConversationDatasetStream(rows), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': 'attachment; filename="air-office-exchanges.jsonl"', 'cache-control': 'no-store' } });
  }
  if (url.pathname === '/api/v1/reasoning' && ['GET', 'POST', 'DELETE'].includes(request.method)) {
    const conversationId = url.searchParams.get('conversationId') ?? undefined;
    const graph = conversationId ? conversations.load(conversationId) : null;
    if (conversationId && !graph) return Response.json({ error: 'Unknown conversation.' }, { status: 404 });
    const leaf = url.searchParams.get('leafId') ?? (graph ? activeLeaf(graph) : null);
    if (leaf && (!graph || !graph.messages.some(message => message.id === leaf))) return Response.json({ error: 'Unknown conversation branch.' }, { status: 400 });
    const scope = conversationId && leaf ? { conversationId, leafId: leaf } : undefined;
    if (request.method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0); const limit = Number(url.searchParams.get('limit') ?? 25);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return Response.json({ error: 'Choose a valid memory page.' }, { status: 400 });
      const page = conversationId && !leaf ? { records: [], total: 0 } : reasoning.listViews(scope, offset, limit);
      return Response.json({ enabled: memory.enabled(), embedding: embeddingSelection.selection(), ...page });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('recordId' in body) || typeof body.recordId !== 'string' || conversationId && !leaf || !reasoning.hasRecord(body.recordId, scope)) return Response.json({ error: 'Choose a saved memory.' }, { status: 400 });
    const changed = request.method === 'DELETE' ? reasoning.forget(conversationId, body.recordId) : reasoning.retry(conversationId, body.recordId);
    return changed ? Response.json({ updated: true }) : Response.json({ error: 'This memory cannot be retried.' }, { status: 409 });
  }
  if (url.pathname === '/api/v1/memories' && request.method === 'GET') {
    const query = url.searchParams.get('q');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (query !== null && query.length > 400) return Response.json({ error: 'The memory query is too long.' }, { status: 400 });
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return Response.json({ error: 'Invalid memory limit.' }, { status: 400 });
    return Response.json({ enabled: memory.enabled(), memories: memory.memories(query ?? undefined, limit) });
  }
  if (url.pathname === '/api/v1/memories' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { content?: unknown; conversationId?: unknown } | null;
    if (!body || !validateMemoryContent(body.content) || (body.conversationId !== undefined && body.conversationId !== null && (typeof body.conversationId !== 'string' || !body.conversationId || body.conversationId.length > 200))) return Response.json({ error: 'A memory between 1 and 2000 characters is required.' }, { status: 400 });
    try {
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null;
      return Response.json({ memory: memory.remember({ content: body.content as string, conversationId }) }, { status: 201 });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The memory could not be stored.' }, { status: 409 }); }
  }
  if (url.pathname === '/api/v1/memories' && request.method === 'DELETE') {
    const body = await request.json().catch(() => null) as { confirmed?: unknown } | null;
    if (body?.confirmed !== true) return Response.json({ error: 'Confirm clearing every stored memory.' }, { status: 409 });
    const cleared = memory.clear();
    reasoning.clear();
    return Response.json({ cleared });
  }
  const memoryPath = url.pathname.match(/^\/api\/v1\/memories\/([^/]+)$/);
  if (memoryPath && (request.method === 'PATCH' || request.method === 'DELETE')) {
    let memoryId: string;
    try { memoryId = decodeURIComponent(memoryPath[1]!); } catch { return Response.json({ error: 'Invalid memory identifier.' }, { status: 400 }); }
    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => null) as { content?: unknown } | null;
      if (!body || !validateMemoryContent(body.content)) return Response.json({ error: 'A memory between 1 and 2000 characters is required.' }, { status: 400 });
      const updated = memory.update(memoryId, body.content);
      return updated ? Response.json({ memory: updated }) : Response.json({ error: 'Unknown memory.' }, { status: 404 });
    }
    return memory.forget(memoryId) ? new Response(null, { status: 204 }) : Response.json({ error: 'Unknown memory.' }, { status: 404 });
  }
  if (url.pathname === '/api/v1/memory' && request.method === 'GET') return Response.json({ enabled: memory.enabled() });
  if (url.pathname === '/api/v1/memory' && request.method === 'PUT') {
    const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') return Response.json({ error: 'Choose the memory setting.' }, { status: 400 });
    memory.setEnabled(body.enabled);
    if (body.enabled && localEmbeddingsEnabled()) reasoning.resume(); else reasoning.interrupt();
    return Response.json({ enabled: memory.enabled() });
  }
  if (url.pathname === '/api/v1/images' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { prompt?: unknown; provider?: unknown; model?: unknown; size?: unknown } | null;
    if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2000
      || (body.provider !== undefined && (typeof body.provider !== 'string' || !body.provider || body.provider.length > 100))
      || (body.model !== undefined && (typeof body.model !== 'string' || !body.model || body.model.length > 200))
      || (body.size !== undefined && (typeof body.size !== 'string' || !body.size || body.size.length > 40))) return Response.json({ error: 'A prompt and optional provider are required.' }, { status: 400 });
    if (typeof body.provider === 'string' && !providers.get(body.provider)) return Response.json({ error: 'Unknown provider.' }, { status: 404 });
    try {
      const result = await providers.generateImage({
        prompt: body.prompt.trim(),
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
        ...(typeof body.size === 'string' ? { size: body.size } : {})
      }, typeof body.provider === 'string' ? body.provider : undefined);
      return Response.json(result);
    } catch (error) {
      if (error instanceof ImageGenerationError) return Response.json({ error: error.message }, { status: error.code === 'unknown-provider' ? 404 : error.code === 'unsupported' ? 400 : 502 });
      return Response.json({ error: error instanceof Error ? error.message : 'Image generation failed.' }, { status: 502 });
    }
  }
  if (url.pathname === '/api/v1/capabilities' && request.method === 'GET') {
    const webSearch = webSearchSettings.state();
    return Response.json({
      webSearch,
      codeInterpreter: { languages: ['javascript'] },
      memory: { enabled: memory.enabled() },
      providers: providers.status().map(({ id, capabilities }) => ({ id, imageGeneration: capabilities.imageGeneration }))
    });
  }
  if (url.pathname === '/api/v1/workspace-defaults' && request.method === 'GET') {
    // The workspace default is read by the shell, so a chat that starts
    // without an explicit model uses the model the workspace is set up for.
    return Response.json({ defaults: workspaceDefaults.read() });
  }
  if (url.pathname === '/api/v1/model-harness' && request.method === 'GET') {
    return Response.json({ models: modelHarness.list() });
  }
  if (url.pathname === '/api/v1/model-harness' && request.method === 'PUT') {
    const body = await request.json().catch(() => null) as { providerId?: unknown; modelId?: unknown; fullHarness?: unknown } | null;
    if (!body || typeof body.providerId !== 'string' || !body.providerId.trim() || typeof body.modelId !== 'string' || !body.modelId.trim() || typeof body.fullHarness !== 'boolean') {
      return Response.json({ error: 'Provide providerId, modelId, and fullHarness.' }, { status: 400 });
    }
    try {
      const preference = modelHarness.setFullHarness(body.providerId, body.modelId, body.fullHarness);
      return Response.json({ preference });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'The harness preference could not be saved.' }, { status: 400 });
    }
  }
  if (url.pathname === '/api/v1/quick-start' && request.method === 'GET') {
    // Finish setup proposes local managed models only. Cloud connection
    // catalogs are not "installed" starters; they belong on the Cloud AI route.
    const registry = await refreshModelReferenceRegistry();
    const installed = registry.filter((entry) => entry.providerId === managedLemonadeProviderId);
    const proposal = proposeWorkspaceDefaults({ registry: installed, current: workspaceDefaults.read() });
    const embedding = embeddingSelection.selection();
    // A stored default is only "in use" while the model is actually
    // installed; a deleted model leaves the pointer stale and the surface
    // must say so rather than claim it is working.
    const chatInstalled = Boolean(proposal.current.chatProvider && proposal.current.chatModel
      && installed.some((entry) => entry.providerId === proposal.current.chatProvider && entry.modelId === proposal.current.chatModel && entry.roles.includes('chat')));
    const embeddingInstalled = Boolean(embedding && installed.some((entry) => entry.providerId === managedLemonadeProviderId && entry.modelId === embedding.model && entry.roles.includes('embedding')));
    return Response.json({
      current: {
        chatProvider: chatInstalled ? proposal.current.chatProvider : null,
        chatModel: chatInstalled ? proposal.current.chatModel : null,
        embeddingModel: embeddingInstalled ? embedding!.model : null,
        embeddingRevision: embeddingInstalled ? embedding!.revision : null,
        embeddingDimensions: embeddingInstalled ? embedding!.dimensions : null
      },
      proposal: {
        chat: proposal.chat,
        embedding: proposal.embedding ? { ...proposal.embedding, revision: proposal.embedding.modelId, dimensions: await probeEmbeddingDimensions(proposal.embedding.modelId) } : null
      },
      models: installed.map((entry) => ({ providerId: entry.providerId, modelId: entry.modelId, roles: entry.roles }))
    });
  }
  if (url.pathname === '/api/v1/quick-start' && request.method === 'PUT') {
    const body = await request.json().catch(() => null) as { chatProvider?: unknown; chatModel?: unknown; embeddingModel?: unknown; embeddingRevision?: unknown; embeddingDimensions?: unknown } | null;
    if (!body) return Response.json({ error: 'A model selection is required.' }, { status: 400 });
    const registry = (await refreshModelReferenceRegistry()).filter((entry) => entry.providerId !== 'local-replay');
    const chatProvider = typeof body.chatProvider === 'string' ? body.chatProvider : null;
    const chatModel = typeof body.chatModel === 'string' ? body.chatModel : null;
    if (chatProvider || chatModel) {
      if (!chatProvider || !chatModel) return Response.json({ error: 'Choose an installed chat model.' }, { status: 400 });
      if (!registry.some((entry) => entry.providerId === chatProvider && entry.modelId === chatModel && entry.roles.includes('chat'))) return Response.json({ error: 'Choose an installed chat model.' }, { status: 400 });
    }
    const embeddingModel = typeof body.embeddingModel === 'string' ? body.embeddingModel : null;
    if (embeddingModel && !registry.some((entry) => entry.providerId === managedLemonadeProviderId && entry.modelId === embeddingModel && entry.roles.includes('embedding'))) return Response.json({ error: 'Choose an installed embedding model.' }, { status: 400 });
    // The revision of a locally installed model is the model identity the
    // runtime registered it under, so the model name is the revision unless
    // the caller states a different one.
    const embeddingRevision = typeof body.embeddingRevision === 'string' && body.embeddingRevision.trim() ? body.embeddingRevision.trim() : embeddingModel;
    const embeddingDimensions = typeof body.embeddingDimensions === 'number' && Number.isSafeInteger(body.embeddingDimensions) && body.embeddingDimensions > 0 ? body.embeddingDimensions : embeddingModel ? await probeEmbeddingDimensions(embeddingModel) : null;
    if (embeddingModel && (!embeddingRevision || !embeddingDimensions)) return Response.json({ error: 'The embedding model did not report its vector dimensions. Check the model or enter its documented dimensions.' }, { status: 409 });
    // The embedding selection is applied to the live index, so a vector search
    // works right after the default is set.
    if (embeddingModel && embeddingRevision && embeddingDimensions) {
      try {
        knowledge = embeddingSelection.select({ model: embeddingModel, revision: embeddingRevision, dimensions: embeddingDimensions, mode: 'runtime' }).knowledge;
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'The embedding model could not be selected.' }, { status: 400 });
      }
    }
    const saved = applyWorkspaceDefaults(workspaceDefaults, {
      chat: chatProvider && chatModel ? { providerId: chatProvider, modelId: chatModel, roles: ['chat'], reason: 'only-chat-model' } : null,
      embedding: embeddingModel ? { providerId: managedLemonadeProviderId, modelId: embeddingModel, roles: ['embedding'], reason: 'only-embedding-model' } : null,
      embeddingRevision,
      embeddingDimensions
    });
    // The documents that were waiting for an embedding model are indexed now
    // that one is selected. A document in a collection is there to be found.
    if (embeddingModel) autoIndexPendingCollections();
    return Response.json({ defaults: saved });
  }
  return new Response('Not found', { status: 404 });
}
console.info(`AIR Office ${demoMode ? 'demo ' : ''}service ready at 127.0.0.1:${server.port}`);
// The index jobs are reported through the job service, so the seed waits for
// the service to be ready before it indexes the documents it installed.
serviceReady();
// demo.entry / supervisor own the showcase seed when OFFICE_DEMO_EXTERNAL_SEED=1.
// Desktop Demo still relies on this in-process seed. Never run both at once — they
// interleave conversation deletes/recreates and can leave only the lab General program.
if (demoMode && Bun.env.OFFICE_DEMO_EXTERNAL_SEED !== '1') {
  void (async () => {
    try {
      const { seedDemoContent } = await import('../../../tools/demo-content.adapter');
      const origin = lemonadeDescriptor?.baseOrigin ?? `http://127.0.0.1:${server.port}`;
      const call = async <T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> => {
        const response = await route(new Request(`http://127.0.0.1${path}`, {
          method,
          headers: { authorization: `Bearer ${bootstrapToken}`, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }));
        if (!response.ok) throw new Error(`Demo showcase seed failed: ${path} (${response.status})`);
        if (response.status === 204) return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      };
      const templates = [['Ollama', 'ollama'], ['LM Studio', 'openai-compatible'], ['llama.cpp', 'openai-compatible'], ['OpenAI', 'openai-compatible'], ['OpenAI Responses', 'openai-responses'], ['Anthropic', 'anthropic'], ['Gemini', 'gemini'], ['Azure OpenAI', 'azure-openai'], ['OpenRouter', 'openai-compatible'], ['Hugging Face', 'openai-compatible'], ['Custom endpoint', 'openai-compatible']] as const;
      for (const [name, kind] of templates) {
        const id = `demo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        await call('/api/v1/model-connections', { connection: { id, name: `${name} · Demo`, kind, baseUrl: `${origin}/v1`, models: ['Demo-Chat'], imageModels: [], ...(kind === 'azure-openai' ? { deployment: 'Demo-Chat', apiVersion: '2024-10-21' } : {}) } }, 'PUT');
      }
      for (const kind of ['mcp', 'openapi'] as const) {
        const id = `demo-${kind}`;
        await call('/api/v1/tools/connections', { id, name: `${kind === 'mcp' ? 'MCP' : 'OpenAPI'} · Demo`, kind, endpoint: `${origin}/${kind === 'mcp' ? 'mcp' : 'openapi.json'}` });
        const result = await call<{ definitions: { id: string }[] }>(`/api/v1/tools/connections/${id}/discover`, {});
        await call(`/api/v1/tools/connections/${id}`, { enabled: true }, 'PATCH');
        for (const definition of result.definitions) await call('/api/v1/tools/enable', { id: definition.id, enabled: true });
      }
      await seedDemoContent(call);
    } catch (reason) {
      console.warn(JSON.stringify({ component: 'demo', operation: 'seed', error: reason instanceof Error ? reason.message : 'Showcase content could not be prepared.' }));
    }
  })();
}
const shutdown = async () => {
  clearInterval(reasoningTimer);
  reasoning.interrupt();
  realtimeRelay.dispose();
  clearInterval(automationTimer);
  stopDevWorkbench();
  server.stop(true);
  await localTools.close();
  toolStore.close();
  lemonadeActivityJournal.close();
  store.close();
  try { await stopSharedCopilotClient(); } catch { /* CLI already stopped */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
