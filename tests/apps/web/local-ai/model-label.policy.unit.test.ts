import { expect, test } from 'bun:test';
import { chatModelChoices, composerMissingModelLabel, composerModelTriggerLabel, connectionIcon, modelIdFromKey, modelRoleIcon } from '../../../../apps/web/src/models/local-ai/model-label.policy';

test('a local model is called by its own name', () => {
  const choices = chatModelChoices([{ id: 'managed-local', name: 'Local', models: ['Bonsai-1.7B-gguf'] }], false);
  expect(choices.map((choice) => choice.label)).toEqual(['Bonsai-1.7B-gguf']);
  expect(choices[0]?.value).toBe('managed-local:Bonsai-1.7B-gguf');
});

test('composer trigger never shows a managed-local key while the catalog loads', () => {
  expect(modelIdFromKey('managed-local:Bonsai-1.7B-gguf')).toBe('Bonsai-1.7B-gguf');
  expect(composerModelTriggerLabel('managed-local:Bonsai-1.7B-gguf')).toBe('Bonsai-1.7B-gguf');
  expect(composerModelTriggerLabel('managed-local:Very-Long-Local-Model-Name-gguf')).toBe('Very-Long-Local-…');
  expect(composerModelTriggerLabel('chatgpt-signin:gpt-5.4', 'ChatGPT · gpt-5.4')).toBe('ChatGPT · gpt-5.4');
  expect(composerModelTriggerLabel('openai:gpt-4o', 'OpenAI Platform · gpt-4o-mini-preview')).toBe('OpenAI');
  expect(composerModelTriggerLabel('')).toBe('Choose a model');
  expect(composerModelTriggerLabel('unassigned')).toBe('No model');
  expect(composerModelTriggerLabel('lab:unassigned')).toBe('No model');
  expect(composerMissingModelLabel('lab:unassigned')).toBe('No model');
  expect(composerMissingModelLabel('openai:missing-model')).toBe('Unavailable');
});

test('a hosted model carries the name of its service', () => {
  const choices = chatModelChoices([{ id: 'openai', name: 'OpenAI', models: ['gpt-4o'] }], false);
  expect(choices[0]?.label).toBe('OpenAI · gpt-4o');
});

test('the demo model is offered in demo mode only', () => {
  const providers = [{ id: 'local-replay', models: ['replay'] }];
  expect(chatModelChoices(providers, false)).toEqual([]);
  expect(chatModelChoices(providers, true).map((choice) => choice.label)).toEqual(['Demo model']);
});

test('a model that cannot chat is not offered for chat', () => {
  const choices = chatModelChoices([{ id: 'managed-local', models: ['image-model'], modelFacts: [{ modelId: 'image-model', roles: ['image'] }] }], false);
  expect(choices).toEqual([]);
});

test('each kind of model has its own icon', () => {
  expect(modelRoleIcon(['image'])).not.toBe(modelRoleIcon(['chat']));
  expect(modelRoleIcon(['stt'])).not.toBe(modelRoleIcon(['tts']));
  expect(connectionIcon('managed-local')).not.toBe(connectionIcon('openai'));
});
