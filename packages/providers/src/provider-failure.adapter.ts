import type { ProviderFailure } from '@office/contracts/chat';

/**
 * Maps a thrown provider or Copilot SDK error into a stable chat failure.
 * Parses HTTP status from several message shapes, including the Copilot CLI
 * form "Authentication failed with provider at … (HTTP 401)".
 */
export function classifyProviderFailure(error: unknown, transportAttempted?: boolean, transportStatus?: number): ProviderFailure {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
  const status = typeof record.status === 'number' ? record.status : typeof record.statusCode === 'number' ? record.statusCode : transportStatus;
  const message = error instanceof Error ? error.message : 'The provider request failed.';
  const errorText = typeof nested.message === 'string' ? nested.message : message;
  const normalized = `${errorText} ${message}`.toLowerCase();
  const statusFromMessage = /(?:status|code)[^0-9]{0,8}(\d{3})/.exec(message)?.[1]
    ?? /\(HTTP\s+(\d{3})\)/i.exec(message)?.[1]
    ?? /\bHTTP\s+(\d{3})\b/i.exec(message)?.[1]
    ?? /^(\d{3})\s+Bad Request\b/i.exec(message)?.[1];
  const statusFromBody = /"status"\s*:\s*(\d{3})/.exec(message)?.[1];
  const resolvedStatus = status ?? (statusFromMessage ? Number(statusFromMessage) : statusFromBody ? Number(statusFromBody) : Number(/status:\s*(\d{3})/i.exec(message)?.[1] ?? 0) || undefined);
  const sessionLoss = /session (is )?disconnected|closed or replaced|replaced while waiting|no session host/i.test(message);
  const chatgptUnsupported = /subscription_sharing_unsupported_capability/i.test(normalized);
  const chatgptUsageLimit = /subscription_sharing_usage_limit_exceeded/i.test(normalized);
  const chatgptIneligible = /subscription_sharing_user_not_eligible/i.test(normalized);
  const code: ProviderFailure['code'] = resolvedStatus === 401 || resolvedStatus === 403 || chatgptIneligible || /authentication failed|copilot_provider_(api_key|bearer_token)/i.test(normalized) ? 'auth'
    : resolvedStatus === 429 || chatgptUsageLimit ? 'rate-limit'
      : resolvedStatus === 402 ? 'quota'
        : /certificate|tls|ssl/.test(normalized) ? 'tls'
          : /context length|token limit|maximum context|exceeds the available context size/.test(normalized) ? 'context-limit'
            : /out of memory|capacity|resource exhausted/.test(normalized) ? 'capacity'
              : /timeout|timed out/.test(normalized) ? 'timeout'
                : sessionLoss || /fetch failed|network|socket|econn/.test(normalized) ? 'network'
                  : resolvedStatus !== undefined && resolvedStatus >= 500 ? 'network'
                    : resolvedStatus !== undefined || chatgptUnsupported ? 'protocol' : 'unknown';
  const messages: Record<ProviderFailure['code'], string> = {
    auth: chatgptIneligible
      ? 'ChatGPT plan usage is unavailable for this account. Choose another model or connection.'
      : 'The provider rejected the credentials or account access. Check the connection settings.',
    quota: 'The provider reported an account or quota limit.',
    'rate-limit': chatgptUsageLimit
      ? 'This ChatGPT plan reached its usage limit. Check ChatGPT settings → Usage, then retry later.'
      : 'The provider rate limit was reached. Retry later.',
    tls: 'The provider certificate could not be verified.',
    network: 'The provider could not complete the request. Check its availability and retry.',
    timeout: 'The provider request timed out.',
    'context-limit': 'This request exceeds the model context limit. Reduce the conversation or output limit.',
    capacity: 'The provider has insufficient capacity for this request.',
    protocol: chatgptUnsupported
      ? 'ChatGPT plan usage rejected part of this request. Try a plain chat turn, or switch to an API-key connection for full tools.'
      : 'The provider returned an unsupported or rejected response.',
    cancelled: 'The provider request was cancelled.',
    unknown: 'The provider request failed.'
  };
  if (/local ai is off|local ai was turned off|local ai is unavailable/i.test(message)) {
    return { code: 'cancelled', message: /local ai was turned off/i.test(message) ? 'Local AI was turned off.' : 'Local AI is off. Turn it on in the sidebar when you need it.', retryable: false };
  }
  if (code === 'unknown' && /saved credential could not be read/i.test(message)) {
    return { code: 'auth', message: 'AIR Office could not read the saved credential from the system keychain.', retryable: false };
  }
  if (code === 'unknown' && transportAttempted === false) {
    return { code: 'protocol', message: 'AIR Office could not prepare the provider request.', retryable: false };
  }
  return { code, message: messages[code], retryable: code === 'rate-limit' || code === 'network' || code === 'timeout' || code === 'capacity', ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}) };
}

/** Remote hosted endpoints need a saved key; loopback and Ollama do not. */
export function providerRequiresCredential(protocol: string, baseUrl: string): boolean {
  if (protocol === 'ollama') return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return false;
  } catch {
    return true;
  }
  return true;
}
