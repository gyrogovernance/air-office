import { expect, test } from 'bun:test';
import { mediaModelName, mediaModelsForKind, modelSupportsKind, type MediaModel } from '../../../../apps/web/src/models/local-ai/media-capability.policy';

const model = (id: string, recipe: string, labels: string[]): MediaModel => ({ id, name: id, recipe, labels });

test('only a model the runtime labels for images is offered for image work', () => {
  const models = [model('chat-model', 'llamacpp', ['chat']), model('image-model', 'sd-cpp', ['image'])];
  expect(modelSupportsKind(models[1]!, 'image')).toBe(true);
  expect(modelSupportsKind(models[0]!, 'image')).toBe(false);
  expect(mediaModelsForKind(models, 'image').map((item) => item.id)).toEqual(['image-model']);
});

test('a model that only makes sound is not offered for image work', () => {
  const models = [model('chat-model', 'llamacpp', ['chat']), model('music', 'acestep', ['audio-generation'])];
  expect(mediaModelsForKind(models, 'image').map((item) => item.id)).toEqual([]);
});

test('an imported model is named by the family it belongs to', () => {
  expect(mediaModelName('imported-qwen-image-2_1-UC-Q4_K_M-d09b40dfbc')).toBe('qwen-image-2_1-UC-Q4_K_M');
  expect(mediaModelName('Bonsai-1.7B-gguf')).toBe('Bonsai-1.7B-gguf');
});
