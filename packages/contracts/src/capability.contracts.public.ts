/**
 * Capability ports for features the chat surface and settings drive through
 * tools: web research, image generation, and memory. Each port is pluggable, so
 * the composition wires a concrete engine and callers depend only on this shape.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  searchedAt: string;
  results: WebSearchResult[];
}

export interface WebSearchProvider {
  readonly id: string;
  search(query: string, options?: { limit?: number; category?: 'news' }, signal?: AbortSignal): Promise<WebSearchResponse>;
}

/** A page the assistant actually opened, distinct from a search-result snippet. */
export interface FetchedWebPage {
  kind: 'web-page';
  url: string;
  title: string;
  content: string;
  fetchedAt: string;
  truncated: boolean;
  /** Lead images the page advertises (og:image and the first content photo), absolute http(s) URLs. */
  images?: string[];
}

/**
 * How the workspace talks to its search service. The address is the endpoint
 * of the search service; the loader controls describe how a request to it
 * behaves. They are shown so the user can see what a search actually does.
 */
export interface WebSearchSettingsState {
  /** Whether a search provider is selected for this workspace. */
  configured: boolean;
  /** Whether search is switched on for this workspace. */
  enabled: boolean;
  provider: string | null;
  endpoint: string | null;
  /** Whether the built-in engine, which needs no key and no service of its own, is in use. */
  builtIn: boolean;
  /** Whether the last check reached the engine. Null when no check has run yet. */
  reachable: boolean | null;
  /** Why the last check ended the way it did. */
  reason: 'ok' | 'disabled' | 'unreachable' | 'unreadable' | null;
  /** What the last check found, in words the user can act on. */
  detail: string | null;
  /** Milliseconds before a search request is abandoned. */
  timeoutMs?: number;
  /** Whether TLS certificates are verified. Off only for a self-signed local service. */
  verifySsl?: boolean;
  /** How many requests may run at once. One keeps a local service responsive. */
  maxConcurrentRequests?: number;
  /** Whether the search service's own web loader is bypassed for results it cannot fetch. */
  bypassWebLoader?: boolean;
  /** Whether proxy environment variables are honoured when reaching the service. */
  trustProxyEnvironment?: boolean;
  /** Search region for the built-in engine (e.g. 'wt-wt' worldwide, 'uk-en' United Kingdom). */
  region?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  size?: string;
}

export interface GeneratedImage {
  /** Direct link when the engine returns an image URL. */
  url?: string;
  /** Data URL when the engine returns image bytes instead of a link. */
  data?: string;
  mimeType?: string;
}

export interface ImageGenerationResult {
  provider: string;
  images: GeneratedImage[];
}
