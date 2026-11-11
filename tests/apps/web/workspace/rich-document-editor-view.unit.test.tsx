import { afterEach, expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { GlassScene } = await import('@glass-sdk/liquid-glass');
const { RichDocumentEditorView } = await import('../../../../apps/web/src/workspace/rich-document-editor-view.component');
const { createRichDocument, markdownToNativeBody } = await import('@office/editor/rich-document-domain');

const NOTE_ID = 'restore-note';
/** The draft the user is editing in the source pane right now. */
const DRAFT = '# scratch\n\nThe draft being replaced.';
/** The stored backup that will be restored over the draft. */
const BACKUP = '# Note\n\nThe backed-up source.';
/** The markdown of the stored document itself. */
const CANONICAL = '# Note\n\nThe stored document.';
const sourceKey = `air-office:draft:${NOTE_ID}:source`;
const backupPrefix = `air-office:draft:${NOTE_ID}:source-backup:`;
const originalBackupKey = `${backupPrefix}1761000000000-0000-4000-8000-000000000000`;

function backupKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(backupPrefix)) keys.push(key);
  }
  return keys;
}

afterEach(() => { localStorage.clear(); });

test('restoring a source backup keeps the draft it replaced as a new backup', async () => {
  localStorage.setItem(sourceKey, DRAFT);
  localStorage.setItem(originalBackupKey, BACKUP);
  const note = { ...createRichDocument('Note', NOTE_ID), body: markdownToNativeBody(CANONICAL) };
  const host = globalThis.document.createElement('div');
  globalThis.document.body.append(host);
  const root = createRoot(host, { onUncaughtError: (error) => { throw error; }, onCaughtError: (error) => { throw error; } });

  try {
    await act(async () => {
      root.render(<StrictMode>
        <RichDocumentEditorView
          document={note}
          onChange={() => {}}
          onAttach={async () => undefined}
          onExport={() => {}}
          onSourceMode={() => {}}
          sourceMode
          onSourceChange={() => {}}
        />
      </StrictMode>);
    });

    const pane = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]');
    if (!pane()) throw new Error('Source pane missing.');
    expect(pane()?.value).toBe(DRAFT);

    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Restore latest backup'));
    if (!restore) throw new Error('Restore action missing.');
    await act(async () => {
      restore.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
      restore.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      restore.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
      restore.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      restore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The restored backup becomes the protected source draft.
    expect(pane()?.value).toBe(BACKUP);
    expect(localStorage.getItem(sourceKey)).toBe(BACKUP);

    // The draft it replaced is never lost: exactly one new backup carries it.
    const keys = backupKeys();
    expect(keys.length).toBe(2);
    const stashed = keys.filter((key) => key !== originalBackupKey);
    expect(stashed.length).toBe(1);
    expect(localStorage.getItem(stashed[0]!)).toBe(DRAFT);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test('a failed source draft write keeps the recovery warning visible', async () => {
  localStorage.setItem(sourceKey, DRAFT);
  localStorage.setItem(originalBackupKey, BACKUP);
  const note = { ...createRichDocument('Note', NOTE_ID), body: markdownToNativeBody(CANONICAL) };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const originalStorage = localStorage;
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return originalStorage.length; },
    key: (index: number) => originalStorage.key(index),
    getItem: (key: string) => originalStorage.getItem(key),
    setItem: (key: string, value: string) => { if (key === sourceKey) throw new Error('storage full'); originalStorage.setItem(key, value); }
  } });
  try {
    await act(async () => root.render(<RichDocumentEditorView document={note} onChange={() => {}} onAttach={async () => undefined} onExport={() => {}} onSourceMode={() => {}} sourceMode onSourceChange={() => {}} />));
    const restore = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Restore latest backup'));
    if (!restore) throw new Error('Restore action missing.');
    await act(async () => { restore.click(); });
    expect(host.textContent).toContain('The source draft could not be protected');
    expect(host.textContent).not.toContain('Backup restored into the source draft');
    expect(localStorage.getItem(sourceKey)).toBe(DRAFT);
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    await act(async () => root.unmount());
    host.remove();
  }
});

test('the document toolbar does not add a separate Ask AI action', async () => {
  const dock = globalThis.document.createElement('div');
  dock.className = 'document-top-dock';
  globalThis.document.body.append(dock);
  const note = { ...createRichDocument('Prompt note', 'prompt-note'), body: markdownToNativeBody('# Note\n\nSelectable text.') };
  const host = globalThis.document.createElement('div');
  globalThis.document.body.append(host);
  const root = createRoot(host, { onUncaughtError: (error) => { throw error; }, onCaughtError: (error) => { throw error; } });

  try {
    await act(async () => {
      root.render(<StrictMode>
        <GlassScene>
          <RichDocumentEditorView
            document={note}
            onChange={() => {}}
            onAttach={async () => undefined}
            onExport={() => {}}
            onSourceMode={() => {}}
            sourceMode={false}
            onSourceChange={() => {}}
          />
        </GlassScene>
      </StrictMode>);
    });
    // The toolbar docks after the editor mounts.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });

    expect(dock.querySelector('button[aria-label="Ask AI"]')).toBeNull();
    expect(host.querySelector('textarea[aria-label="Ask AI prompt"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    dock.remove();
  }
});
