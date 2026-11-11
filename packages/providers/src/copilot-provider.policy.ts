import type { ProviderConfig } from '@github/copilot-sdk';
import type { ProviderProtocol } from './providers.domain.public';
import { isLoopbackProvider } from './providers.domain.public';

/**
 * Historical named gaps from the first Copilot cutover. Gemini now maps through
 * Google's OpenAI-compatible endpoint; ChatGPT plan usage maps through Responses
 * BYOK with a refreshed bearer token. Kept empty so older evidence references
 * stay import-stable.
 */
export const COPILOT_PROVIDER_INCOMPATIBILITIES = [] as const;

export type CopilotMappedProtocol = ProviderProtocol | 'chatgpt-signin';

export interface CopilotByokMappingInput {
  protocol: CopilotMappedProtocol;
  baseUrl: string;
  apiKey?: string | null;
  /** When true, the credential is applied as Authorization Bearer (ChatGPT plan tokens). */
  bearer?: boolean;
  deployment?: string;
  apiVersion?: string;
  headers?: Record<string, string>;
  model: string;
  maxOutputTokens?: number;
}

export type CopilotByokMapping =
  | { ok: true; provider: ProviderConfig; model: string }
  | { ok: false; kind: string; reason: string };

/**
 * Rewrites a Gemini Generative Language base URL onto Google's OpenAI-compatible
 * mount so Copilot BYOK (type openai) can reach the same key and models.
 */
export function geminiOpenAiCompatibleBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (/\/openai$/i.test(trimmed)) return trimmed;
  if (/\/v1beta$/i.test(trimmed)) return `${trimmed}/openai`;
  try {
    const url = new URL(trimmed);
    if (/generativelanguage\.googleapis\.com$/i.test(url.hostname) && url.pathname === '/') {
      return `${url.origin}/v1beta/openai`;
    }
  } catch {
    /* fall through */
  }
  return `${trimmed}/openai`;
}

function withOpenAiCompatibleBase(baseUrl: string, protocol: CopilotMappedProtocol): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (protocol === 'gemini') return geminiOpenAiCompatibleBase(trimmed);
  if (protocol === 'ollama' && !/\/v1$/i.test(trimmed)) return `${trimmed}/v1`;
  return trimmed;
}

/** Loopback BYOK (managed Lemonade / local OpenAI-compatible) must reach 127.0.0.1 through the Copilot sandbox. */
export function providerBaseUrlAllowsLocalNetwork(baseUrl: string | undefined): boolean {
  return isLoopbackProvider(baseUrl);
}

/**
 * Copilot tool-search defers MCP/custom schemas behind `tool_search_tool` and injects
 * deferred-tool reminders. That path needs models that understand tool search; small
 * local BYOK models echo the reminder instead of answering. Loopback stays preloaded.
 * ChatGPT plan usage rejects Responses `tool_search`, so that path stays preloaded too.
 */
export function copilotToolSearchConfig(localRuntime: boolean, options?: { chatgptPlanUsage?: boolean }): { enabled: boolean; deferThreshold?: number } {
  if (localRuntime || options?.chatgptPlanUsage) return { enabled: false };
  return { enabled: true, deferThreshold: 30 };
}

/**
 * Sandbox network policy for Copilot first-party web tools and BYOK.
 * Outbound stays on. Local/loopback stays off for cloud BYOK except on Windows,
 * where the sandbox proxy only reaches the host together with allowLocalNetwork.
 */
export function copilotSandboxNetworkPolicy(input: {
  baseUrl?: string;
  platform?: NodeJS.Platform;
}): { allowOutbound: true; allowLocalNetwork: boolean } {
  const platform = input.platform ?? process.platform;
  return {
    allowOutbound: true,
    allowLocalNetwork: providerBaseUrlAllowsLocalNetwork(input.baseUrl) || platform === 'win32'
  };
}

/**
 * Maps an AIR provider connection into Copilot SDK BYOK configuration.
 * Cloud API keys, Lemonade/local OpenAI-compatible endpoints, Gemini via its
 * OpenAI-compatible mount, and ChatGPT plan OAuth bearer tokens share this path.
 */
export function mapAirProviderToCopilotByok(input: CopilotByokMappingInput): CopilotByokMapping {
  const baseUrl = withOpenAiCompatibleBase(input.baseUrl, input.protocol);
  const secret = input.apiKey?.trim() ? input.apiKey : undefined;
  const headers = input.headers && Object.keys(input.headers).length ? input.headers : undefined;
  const auth = input.bearer
    ? (secret ? { bearerToken: secret } : {})
    : (secret ? { apiKey: secret } : {});
  const shared = {
    baseUrl,
    ...auth,
    ...(headers ? { headers } : {}),
    modelId: input.model,
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {})
  };
  if (input.protocol === 'chatgpt-signin' || input.protocol === 'openai-responses') {
    return { ok: true, model: input.model, provider: { type: 'openai', wireApi: 'responses', transport: 'http', ...shared } };
  }
  if (input.protocol === 'anthropic') {
    return { ok: true, model: input.model, provider: { type: 'anthropic', ...shared } };
  }
  if (input.protocol === 'azure-openai') {
    return {
      ok: true,
      model: input.model,
      provider: {
        type: 'azure',
        ...shared,
        ...(input.deployment ? { wireModel: input.deployment } : {}),
        ...(input.apiVersion ? { azure: { apiVersion: input.apiVersion } } : {})
      }
    };
  }
  if (input.protocol === 'gemini') {
    return { ok: true, model: input.model, provider: { type: 'openai', wireApi: 'completions', ...shared } };
  }
  if (input.protocol === 'ollama') {
    return { ok: true, model: input.model, provider: { type: 'openai', wireApi: 'completions', modelProvider: 'ollama', ...shared } };
  }
  return { ok: true, model: input.model, provider: { type: 'openai', wireApi: 'completions', ...shared } };
}
