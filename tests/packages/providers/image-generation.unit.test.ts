import { expect, test } from 'bun:test';
import { ImageGenerationError, LocalReplayConnection, OpenAiCompatibleConnection, createProvidersService } from '../../../packages/providers/src/providers.service.public';
import { renderPromptImage, requestOpenAiImages } from '../../../packages/providers/src/image-generation.adapter';

test('local replay advertises image generation and returns real image data for the prompt', async () => {
  const connection = new LocalReplayConnection();
  expect(connection.capabilities().imageGeneration).toBe(true);
  const images = await connection.generateImage!({ prompt: 'a calm harbor at dawn' });
  expect(images).toHaveLength(1);
  expect(images[0]!.mimeType).toBe('image/svg+xml');
  const svg = decodeURIComponent(images[0]!.data!.slice(images[0]!.data!.indexOf(',') + 1));
  expect(svg).toContain('a calm harbor at dawn');
  expect(svg.startsWith('<svg')).toBe(true);
});

test('an openai-compatible connection advertises image generation only when image models are configured', async () => {
  const plain = new OpenAiCompatibleConnection({ id: 'openai', baseUrl: 'http://provider.test/v1', models: ['gpt-test'] });
  expect(plain.capabilities().imageGeneration).toBe(false);
  await expect(plain.generateImage!({ prompt: 'x' })).rejects.toThrow('does not support image generation');

  const images = new OpenAiCompatibleConnection({
    id: 'openai',
    baseUrl: 'http://provider.test/v1',
    imageModels: ['dall-e-3'],
    credentials: { resolve: async () => 'secret-token' },
    fetchImpl: async (input, init) => {
      expect(String(input)).toBe('http://provider.test/v1/images/generations');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token');
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'a lighthouse in fog', n: 1, model: 'dall-e-3' });
      return new Response(JSON.stringify({ data: [{ url: 'https://img.test/one.png' }] }), { status: 200 });
    }
  });
  expect(images.capabilities().imageGeneration).toBe(true);
  expect(await images.generateImage({ prompt: 'a lighthouse in fog' })).toEqual([{ url: 'https://img.test/one.png' }]);
});

test('the image engine normalizes URL, base64, and failure payloads', async () => {
  const engine = (payload: unknown, status = 200) => requestOpenAiImages({ baseUrl: 'http://engine.test/', fetchImpl: async () => new Response(JSON.stringify(payload), { status }) }, { prompt: 'p' });
  expect(await engine({ data: [{ b64_json: 'QUJD' }] })).toEqual([{ data: 'data:image/png;base64,QUJD', mimeType: 'image/png' }]);
  expect(await engine({ data: [{ b64: 'data:image/webp;base64,QUJD' }] })).toEqual([{ data: 'data:image/webp;base64,QUJD' }]);
  await expect(engine({ data: [] })).rejects.toThrow('returned no image');
  await expect(engine({ nope: true }, 500)).rejects.toThrow('HTTP 500');
  expect(renderPromptImage('').data?.startsWith('data:image/svg+xml')).toBe(true);
});

test('the providers service resolves an image engine, prefers a configured provider, and reports capability flags', async () => {
  const service = createProvidersService([
    new LocalReplayConnection(),
    new OpenAiCompatibleConnection({ id: 'openai', baseUrl: 'http://provider.test/v1', imageModels: ['dall-e-3'], fetchImpl: async () => new Response(JSON.stringify({ data: [{ url: 'https://img.test/one.png' }] }), { status: 200 }) })
  ]);
  expect(service.status().find((item) => item.id === 'local-replay')?.capabilities).toEqual({ streaming: true, tools: true, images: false, imageGeneration: true });
  expect(service.status().find((item) => item.id === 'openai')?.capabilities.imageGeneration).toBe(true);

  const resolved = await service.generateImage({ prompt: 'a lighthouse' });
  expect(resolved.provider).toBe('openai');
  expect(resolved.images).toEqual([{ url: 'https://img.test/one.png' }]);

  const explicit = await service.generateImage({ prompt: 'a lighthouse' }, 'local-replay');
  expect(explicit.provider).toBe('local-replay');
  expect(explicit.images[0]?.mimeType).toBe('image/svg+xml');

  const unknown = await service.generateImage({ prompt: 'x' }, 'missing').catch((error: unknown) => error);
  expect(unknown).toBeInstanceOf(ImageGenerationError);
  expect((unknown as ImageGenerationError).code).toBe('unknown-provider');

  const offline = createProvidersService([new LocalReplayConnection({ capabilities: { imageGeneration: false } })]);
  const unsupported = await offline.generateImage({ prompt: 'x' }).catch((error: unknown) => error);
  expect((unsupported as ImageGenerationError).code).toBe('unsupported');
  expect((unsupported as ImageGenerationError).message).toContain('No configured provider supports image generation.');
});
