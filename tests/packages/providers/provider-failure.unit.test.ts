import { expect, test } from 'bun:test';
import { classifyProviderFailure, providerRequiresCredential } from '../../../packages/providers/src/provider-failure.adapter';

test('local runtime context exhaustion is reported as a context limit', () => {
  expect(classifyProviderFailure(new Error('request (15153 tokens) exceeds the available context size (4096 tokens), try increasing it'), true)).toMatchObject({
    code: 'context-limit',
    retryable: false,
  });
});

test('Copilot CLI OpenRouter HTTP 401 maps to an AIR auth failure, not env-var jargon', () => {
  const failure = classifyProviderFailure(new Error(
    'Authentication failed with provider at https://openrouter.ai/api/v1 (HTTP 401).\n  Check your COPILOT_PROVIDER_API_KEY, COPILOT_PROVIDER_API_KEY_COMMAND, or COPILOT_PROVIDER_BEARER_TOKEN.'
  ), true);
  expect(failure).toMatchObject({
    code: 'auth',
    status: 401,
    retryable: false,
    message: 'The provider rejected the credentials or account access. Check the connection settings.'
  });
  expect(failure.message).not.toContain('COPILOT_PROVIDER');
});

test('remote hosted endpoints require a credential; loopback and Ollama do not', () => {
  expect(providerRequiresCredential('openai-compatible', 'https://openrouter.ai/api/v1')).toBe(true);
  expect(providerRequiresCredential('openai-compatible', 'http://127.0.0.1:4318/v1')).toBe(false);
  expect(providerRequiresCredential('ollama', 'https://remote.example')).toBe(false);
});

test('Local AI power messages stay clear instead of a generic network failure', () => {
  expect(classifyProviderFailure(new Error('Local AI is off. Turn it on in the sidebar when you need it.'), true)).toMatchObject({
    code: 'cancelled',
    retryable: false,
    message: 'Local AI is off. Turn it on in the sidebar when you need it.',
  });
  expect(classifyProviderFailure(new Error('Local AI was turned off.'), true)).toMatchObject({
    code: 'cancelled',
    message: 'Local AI was turned off.',
  });
});

test('bare 400 Bad Request and ChatGPT plan capability codes map to protocol failures', () => {
  expect(classifyProviderFailure(new Error('400 Bad Request'), true)).toMatchObject({
    code: 'protocol',
    status: 400,
    retryable: false,
  });
  expect(classifyProviderFailure(new Error('subscription_sharing_unsupported_capability'), true)).toMatchObject({
    code: 'protocol',
    message: 'ChatGPT plan usage rejected part of this request. Try a plain chat turn, or switch to an API-key connection for full tools.',
  });
});
