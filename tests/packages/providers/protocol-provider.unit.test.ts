import { expect, test } from 'bun:test';
import { AnthropicConnection, AzureOpenAiConnection, ChatGptSignInConnection, GeminiConnection, OpenAiCompatibleConnection, OpenAiResponsesConnection } from '../../../packages/providers/src/copilot-provider.adapter';
import { COPILOT_PROVIDER_INCOMPATIBILITIES, geminiOpenAiCompatibleBase, mapAirProviderToCopilotByok } from '../../../packages/providers/src/copilot-provider.policy';
import { liveSessionKey } from '../../../packages/providers/src/copilot-session.adapter';

const request = { runId: 'run-protocol', model: 'test-model', messages: [{ role: 'user' as const, content: 'Hello' }] };

const protocolCases = [
  ['anthropic', () => new AnthropicConnection({ id: 'anthropic', baseUrl: 'https://api.anthropic.test/v1' }), 'anthropic'],
  ['gemini', () => new GeminiConnection({ id: 'gemini', baseUrl: 'https://generativelanguage.test/v1beta' }), 'gemini'],
  ['responses', () => new OpenAiResponsesConnection({ id: 'responses', baseUrl: 'https://api.openai.test/v1' }), 'openai-responses'],
  ['azure', () => new AzureOpenAiConnection({ id: 'azure', baseUrl: 'https://resource.openai.azure.test', deployment: 'chat-deployment', apiVersion: '2025-04-01-preview' }), 'azure-openai'],
  ['chatgpt', () => new ChatGptSignInConnection({ id: 'chatgpt-signin', baseUrl: 'https://api.openai.com/v1' }), 'openai-responses']
] as const;

for (const [name, make, protocol] of protocolCases) {
  test(`${name} connection selects its native protocol`, () => {
    expect(make().capabilities().protocol).toBe(protocol);
  });
}

test('per-model capability descriptors default to unknown and preserve explicit operator facts', () => {
  const connection = new AnthropicConnection({
    id: 'anthropic', baseUrl: 'https://api.anthropic.test', models: ['claude-manual', 'claude-set'],
    modelCapabilities: { 'claude-set': { tools: 'supported', vision: 'unsupported', contextWindow: 200000 } }
  });
  expect(connection.modelDescriptor('claude-manual')).toEqual({ model: 'claude-manual', tools: 'unknown', vision: 'unknown', streaming: 'unknown', reasoning: 'unknown', structuredOutput: 'unknown', contextWindow: null, source: 'unknown' });
  expect(connection.modelDescriptor('claude-set')).toMatchObject({ tools: 'supported', vision: 'unsupported', contextWindow: 200000, source: 'operator' });
});

test('BYOK mapping covers cloud and local OpenAI-compatible endpoints on the same Copilot path', () => {
  expect(mapAirProviderToCopilotByok({ protocol: 'openai-compatible', baseUrl: 'https://api.openai.test/v1', apiKey: 'key', model: 'gpt-test' })).toEqual({
    ok: true,
    model: 'gpt-test',
    provider: { type: 'openai', wireApi: 'completions', baseUrl: 'https://api.openai.test/v1', apiKey: 'key', modelId: 'gpt-test' }
  });
  expect(mapAirProviderToCopilotByok({ protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'llama' })).toMatchObject({
    ok: true,
    model: 'llama',
    provider: { type: 'openai', wireApi: 'completions', modelProvider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'llama' }
  });
  expect(mapAirProviderToCopilotByok({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.test', apiKey: 'key', model: 'claude' })).toMatchObject({
    ok: true,
    provider: { type: 'anthropic', baseUrl: 'https://api.anthropic.test', apiKey: 'key' }
  });
  expect(mapAirProviderToCopilotByok({ protocol: 'openai-responses', baseUrl: 'https://api.openai.test/v1', apiKey: 'key', model: 'gpt' })).toMatchObject({
    ok: true,
    provider: { type: 'openai', wireApi: 'responses', transport: 'http' }
  });
  expect(mapAirProviderToCopilotByok({ protocol: 'azure-openai', baseUrl: 'https://resource.openai.azure.test', apiKey: 'key', model: 'chat', deployment: 'chat-deployment', apiVersion: '2025-04-01-preview' })).toMatchObject({
    ok: true,
    provider: { type: 'azure', wireModel: 'chat-deployment', azure: { apiVersion: '2025-04-01-preview' } }
  });
});

test('Gemini maps onto Google OpenAI-compatible BYOK rather than a named gap', () => {
  expect(COPILOT_PROVIDER_INCOMPATIBILITIES).toEqual([]);
  expect(geminiOpenAiCompatibleBase('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  expect(mapAirProviderToCopilotByok({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'key', model: 'gemini-2.0-flash' })).toEqual({
    ok: true,
    model: 'gemini-2.0-flash',
    provider: {
      type: 'openai',
      wireApi: 'completions',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'key',
      modelId: 'gemini-2.0-flash'
    }
  });
});

test('ChatGPT plan usage maps to Responses BYOK with a bearer credential', () => {
  expect(mapAirProviderToCopilotByok({
    protocol: 'chatgpt-signin',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'oauth-access-token',
    bearer: true,
    model: 'gpt-5'
  })).toEqual({
    ok: true,
    model: 'gpt-5',
    provider: {
      type: 'openai',
      wireApi: 'responses',
      transport: 'http',
      baseUrl: 'https://api.openai.com/v1',
      bearerToken: 'oauth-access-token',
      modelId: 'gpt-5'
    }
  });
});

test('live session keys separate conversation, connection and model so local and cloud never share a handle', () => {
  const conversation = 'chat-1';
  const local = liveSessionKey(conversation, 'managed-local', 'Llama-3', 'run-a');
  const cloud = liveSessionKey(conversation, 'openai', 'gpt-4o', 'run-b');
  const otherModel = liveSessionKey(conversation, 'managed-local', 'Qwen', 'run-c');
  expect(local).not.toBe(cloud);
  expect(local).not.toBe(otherModel);
  expect(liveSessionKey(undefined, 'openai', 'gpt-4o', 'run-only')).not.toBe(liveSessionKey(undefined, 'openai', 'gpt-4o', 'other-run'));
});

test('a live Copilot connection without harness home fails closed with a protocol error', async () => {
  const connection = new OpenAiCompatibleConnection({
    id: 'local-test',
    baseUrl: 'http://provider.test/v1',
    credentials: { resolve: async () => 'test-key' }
  });
  const events = [];
  for await (const event of connection.stream({ ...request, executionMode: 'full' })) events.push(event);
  expect(events[0]).toMatchObject({ type: 'failure', payload: { code: 'protocol', message: 'The Copilot harness home directory is not configured.' } });
});

test('local lean mode does not require the Copilot harness home', async () => {
  const connection = new OpenAiCompatibleConnection({
    id: 'managed-local',
    baseUrl: 'http://127.0.0.1:8000/v1',
    fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
  });
  const events = [];
  for await (const event of connection.stream({ ...request, executionMode: 'lean' })) events.push(event);
  expect(events.some((event) => event.type === 'text-delta')).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: 'completion', payload: { reason: 'stop' } });
});

test('a remote OpenRouter-style connection without a saved key fails before a Copilot session starts', async () => {
  const connection = new OpenAiCompatibleConnection({
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    harnessHome: 'F:/tmp/copilot-home',
    credentials: { resolve: async () => null }
  });
  const events = [];
  for await (const event of connection.stream(request)) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'failure',
    payload: { code: 'auth', message: 'Add an API key for this connection in Connections, then try again.', retryable: false }
  });
});

test('ChatGPT without a signed-in account fails closed before a Copilot session starts', async () => {
  const connection = new ChatGptSignInConnection({
    id: 'chatgpt-signin',
    baseUrl: 'https://api.openai.com/v1',
    harnessHome: 'F:/tmp/copilot-home',
    credentials: { resolve: async () => null }
  });
  const events = [];
  for await (const event of connection.stream(request)) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: 'failure',
    payload: { code: 'auth', message: 'Sign in with ChatGPT in Cloud AI settings, then try again.', retryable: false }
  });
});
