import type { ProviderCredentials } from './provider-credentials.port';

/**
 * Hosted credential source. The service reads provider secrets from explicit
 * environment variables such as OFFICE_PROVIDER_OPENAI_TOKEN. Resolution is
 * lazy and the returned value is never logged, echoed in an error, or included
 * in a status payload; only presence is ever reported.
 */
export function createEnvironmentCredentials(env: Record<string, string | undefined> = process.env): ProviderCredentials {
  return {
    resolve: async (providerId: string) => {
      const key = `OFFICE_PROVIDER_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
      return env[key] ?? null;
    }
  };
}

/** Reports whether a credential is configured without exposing its value, for a settings surface. */
export function hasConfiguredCredential(env: Record<string, string | undefined>, providerId: string): boolean {
  const key = `OFFICE_PROVIDER_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
  return typeof env[key] === 'string' && env[key]!.length > 0;
}
