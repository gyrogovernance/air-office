/**
 * Credential boundary for provider connections. The renderer never receives a
 * stored provider secret; only the service composition resolves a credential and
 * hands it to a provider adapter for the duration of a run. Values are read from
 * an external secret store (the operating system keychain on desktop) or, when
 * the operator explicitly configures one, a process environment variable.
 */
export interface ProviderCredentials {
  /** Returns the bearer token for a provider, or null when the provider is unauthenticated (for example a local Ollama endpoint). */
  resolve(providerId: string): Promise<string | null>;
}

/**
 * Write side of the credential boundary for a settings surface. The store
 * reports presence, stores, and removes provider secrets in the system keychain;
 * it never returns a stored value to any caller.
 */
export interface CredentialStore {
  configured(providerId: string): Promise<boolean>;
  store(providerId: string, secret: string): Promise<void>;
  forget(providerId: string): Promise<'removed' | 'absent' | 'failed'>;
  forgetAll(): Promise<{ removed: number; failed: string[] }>;
}
