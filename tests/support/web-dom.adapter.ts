import { GlobalRegistrator } from '@happy-dom/global-registrator';

/**
 * The document the web tests render into.
 *
 * Happy-dom replaces the whole global object, including `fetch` and
 * `Response`. A test that later reads a streamed body, or that starts a
 * server, would then meet happy-dom's implementation instead of the native
 * one. The network globals are captured before the registration and put back
 * after it, so only the document changes.
 *
 * Every web test file imports this adapter instead of registering the DOM
 * itself. Registering per file meant each file tore the DOM down again in
 * its `afterAll`, so a file that ran later met a document without a body.
 *
 * `Blob`, `File` and `FormData` stay happy-dom's own, because the document
 * objects it creates accept only its own files and forms.
 */
const native = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
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

GlobalRegistrator.register({ url: 'http://127.0.0.1:5173/' });
for (const [name, value] of Object.entries(native)) {
  if (value) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

/**
 * Happy-dom cannot load a remote iframe page, so a component that renders one
 * makes it log a "Failed to load iframe page" notice. That notice is the
 * environment, not the product, and it drowns the real test output. It is
 * filtered here rather than in a test, because the environment is shaped once
 * for the whole suite.
 */
const consoleError = globalThis.console.error.bind(globalThis.console);
globalThis.console.error = (...args: unknown[]) => {
  const first = args[0];
  const message = first instanceof Error ? first.message : typeof first === 'string' ? first : '';
  if (message.startsWith('Failed to load iframe page')) return;
  consoleError(...args);
};

