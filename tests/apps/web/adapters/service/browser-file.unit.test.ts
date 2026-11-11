import { afterEach, expect, test } from 'bun:test';
import { BrowserFileAdapter } from '../../../../../apps/web/src/adapters/service/browser-file.adapter';
import '../../../../support/web-dom.adapter';


const originals = ['localStorage', 'window', 'navigator', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
afterEach(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
function setup(userAgent = 'Mozilla/5.0 Chrome/148.0.0.0') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent, storage: { persist: async () => true } } });
  return store;
}
function directory(name: string, content: () => Promise<string>) {
  const handle = { kind: 'file', getFile: async () => ({ text: content }) };
  return { name, requestPermission: async () => 'granted', entries: async function* () { yield ['same.md', handle]; }, getFileHandle: async () => handle };
}
test('reauthorizing same-named files changes identity without deleting old drafts', async () => {
  const store = setup();
  let selected = directory('First', async () => 'first');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: async () => selected } });
  const adapter = new BrowserFileAdapter();
  await adapter.authorize();
  const first = (await adapter.list())[0]!;
  store.set(`air-office:draft:${first.id}`, 'recoverable');
  selected = directory('Second', async () => 'second');
  await adapter.authorize();
  const second = (await adapter.list())[0]!;
  expect(second.id).not.toBe(first.id);
  expect(store.get(`air-office:draft:${first.id}`)).toBe('recoverable');
  await expect(adapter.read(first.id)).rejects.toThrow('outside the authorized workspace');
});
test('pending old-scope read cannot overwrite newly authorized records', async () => {
  setup();
  let resolveRead: (value: string) => void = () => {};
  let pending = false;
  let selected = directory('First', () => pending ? new Promise<string>((resolve) => { resolveRead = resolve; }) : Promise.resolve('first'));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { showDirectoryPicker: async () => selected } });
  const adapter = new BrowserFileAdapter();
  await adapter.authorize();
  const first = (await adapter.list())[0]!;
  pending = true;
  const read = adapter.read(first.id);
  await Promise.resolve(); await Promise.resolve();
  selected = directory('Second', async () => 'second');
  await adapter.authorize();
  resolveRead('stale');
  await expect(read).rejects.toThrow('File access changed');
  expect((await adapter.list())[0]!.content).toBe('second');
});
test('Electron skips the live directory API and uses a folder file picker', async () => {
  const store = setup('Mozilla/5.0 Cursor/3.20.21 Chrome/148.0.7778.280 Electron/42.10.0');
  let usedDirectoryPicker = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      showDirectoryPicker: async () => {
        usedDirectoryPicker = true;
        throw new Error('should not run');
      },
    },
  });
  const file = {
    name: 'notes.md',
    webkitRelativePath: 'DemoFolder/notes.md',
    text: async () => 'cached',
  } as File & { webkitRelativePath: string };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        const listeners = new Map<string, EventListener>();
        return {
          type: '',
          multiple: false,
          accept: '',
          files: { length: 1, 0: file, [Symbol.iterator]: function* () { yield file; } },
          setAttribute() {},
          addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
          removeEventListener(type: string) { listeners.delete(type); },
          click() { listeners.get('change')?.(new Event('change')); },
        };
      },
    },
  });
  const adapter = new BrowserFileAdapter();
  await adapter.authorize();
  expect(usedDirectoryPicker).toBe(false);
  expect(store.get('air-office:authorized-root')).toBe('DemoFolder (browser copy)');
  expect((await adapter.list())[0]!.content).toBe('cached');
});
test('cached folder imports preserve relative paths for duplicate basenames', async () => {
  setup('Mozilla/5.0 Cursor/3.20.21 Chrome/148.0.7778.280 Electron/42.10.0');
  const files = [
    { name: 'readme.md', webkitRelativePath: 'DemoFolder/a/readme.md', text: async () => 'a' },
    { name: 'readme.md', webkitRelativePath: 'DemoFolder/b/readme.md', text: async () => 'b' },
  ];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => {
      const listeners = new Map<string, EventListener>();
      const list = files.slice();
      return {
        type: '', multiple: false, accept: '',
        files: Object.assign(list, { length: list.length, [Symbol.iterator]: function* () { for (let i = 0; i < list.length; i++) yield list[i]; } }),
        setAttribute() {},
        addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
        removeEventListener(type: string) { listeners.delete(type); },
        click() { listeners.get('change')?.(new Event('change')); },
      };
    } },
  });
  const adapter = new BrowserFileAdapter();
  await adapter.authorize();
  const listed = await adapter.list();
  expect(listed.map(({ id, name }) => ({ id: id.slice(id.indexOf(':') + 1), name }))).toEqual([
    { id: 'a/readme.md', name: 'a/readme.md' },
    { id: 'b/readme.md', name: 'b/readme.md' },
  ]);
});
test('live directory abort becomes a clear cancellation message', async () => {
  setup();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      showDirectoryPicker: async () => {
        const error = new Error("Failed to execute 'showDirectoryPicker' on 'Window': The user aborted a request.");
        error.name = 'AbortError';
        throw error;
      },
    },
  });
  await expect(new BrowserFileAdapter().authorize()).rejects.toThrow('Folder authorization was cancelled.');
});
