import { GlobalRegistrator } from '@happy-dom/global-registrator';

/**
 * A document for the editor tests.
 *
 * Happy-dom replaces the whole global object, including `fetch` and
 * `Response`. A test in the same process that later reads a streamed body
 * would then see happy-dom's implementation instead of the native one, so
 * the network globals are captured first and put back afterwards. Only the
 * document stays.
 */
const native = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  FormData: globalThis.FormData,
  Blob: globalThis.Blob,
  File: globalThis.File,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  ReadableStream: globalThis.ReadableStream,
  WritableStream: globalThis.WritableStream,
  TransformStream: globalThis.TransformStream,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  crypto: globalThis.crypto,
  performance: globalThis.performance,
  structuredClone: globalThis.structuredClone,
};

GlobalRegistrator.register({ url: 'http://localhost/' });
for (const [name, value] of Object.entries(native)) {
  if (value) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
