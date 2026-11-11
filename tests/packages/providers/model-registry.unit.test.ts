import { expect, test } from 'bun:test';
import { modelRegistryFromConnections, parseModelReference, resolveModelReference } from '../../../packages/providers/src/model-registry.policy';

test('discovered models resolve through the same registry as manual IDs without duplicates', () => {
  const discovered = modelRegistryFromConnections([{ id: 'provider', models: ['manual', 'shared'], observedModels: ['live', 'shared'] }]);
  expect(discovered.map((entry) => entry.modelId)).toEqual(['live', 'shared', 'manual']);
  expect(resolveModelReference({ providerId: 'provider', modelId: 'live', role: 'chat' }, discovered).state).toBe('available');
});

test('speech capability does not grant both transcription and synthesis without explicit support', () => {
  const entries = modelRegistryFromConnections([{ id: 'provider', models: ['legacy', 'voice'], modelCapabilities: { legacy: { speech: 'supported' }, voice: { tts: 'supported' } } as never }]);
  expect(entries[0]?.roles).not.toContain('stt'); expect(entries[0]?.roles).not.toContain('tts');
  expect(entries[1]?.roles).toContain('tts'); expect(entries[1]?.roles).not.toContain('stt');
});

const registry = modelRegistryFromConnections([{
  id: 'local-ollama', models: ['qwen-chat', 'vector-embed'], modelCapabilities: {
    'qwen-chat': { tools: 'supported', vision: 'unsupported' } as never,
    'vector-embed': { embedding: 'supported' } as never
  } as never
}]);

test('shared registry assigns ordinary chat and only explicitly advertised specialist roles', () => {
  expect(resolveModelReference({ providerId: 'local-ollama', modelId: 'qwen-chat', role: 'chat' }, registry).state).toBe('available');
  expect(resolveModelReference({ providerId: 'local-ollama', modelId: 'qwen-chat', role: 'vision' }, registry).state).toBe('unsupported');
  expect(resolveModelReference({ providerId: 'local-ollama', modelId: 'vector-embed', role: 'embedding' }, registry).state).toBe('available');
  expect(resolveModelReference({ providerId: 'gone', modelId: 'old', role: 'chat' }, registry).state).toBe('missing');
});

test('model references validate stable provider, model, and role identities', () => {
  expect(parseModelReference({ providerId: 'local-ollama', modelId: 'qwen-chat', role: 'chat' })).toEqual({ providerId: 'local-ollama', modelId: 'qwen-chat', role: 'chat' });
  expect(() => parseModelReference({ providerId: 'Bad Provider', modelId: 'x', role: 'chat' })).toThrow();
  expect(() => parseModelReference({ providerId: 'provider', modelId: '', role: 'chat' })).toThrow();
});


test('managed roles use runtime labels and preserve exact colon and slash model identities', async () => {
  const { modelRegistryFromManagedModels } = await import('../../../packages/providers/src/model-registry.policy');
  const registry = modelRegistryFromManagedModels({ data: [{ id: 'org/chat:Q4', labels: ['chat', 'vision'] }, { id: 'org/embed:v2', labels: ['embeddings'] }, { id: 'org/rank:v1', labels: ['reranking'] }, { id: 'unknown', labels: [] }] });
  expect(resolveModelReference({ providerId: 'managed-local', modelId: 'org/chat:Q4', role: 'chat' }, registry).state).toBe('available');
  expect(resolveModelReference({ providerId: 'managed-local', modelId: 'org/embed:v2', role: 'chat' }, registry).state).toBe('unsupported');
  expect(resolveModelReference({ providerId: 'managed-local', modelId: 'org/embed:v2', role: 'embedding' }, registry).state).toBe('available');
  expect(registry.find((model) => model.modelId === 'unknown')?.capabilities.vision).toBe('unknown');
});
