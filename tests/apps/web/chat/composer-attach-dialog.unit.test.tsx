import { expect, test } from 'bun:test';
import '../../../support/web-dom.adapter';

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ComposerAttachDialog } = await import('../../../../apps/web/src/chat/composer-attach-dialog.component');
const { EMPTY_CONTEXT_SELECTION, attachContext } = await import('../../../../apps/web/src/chat/composer-context.policy');
import type { KnowledgeWorkspaceState } from '../../../../apps/web/src/knowledge/knowledge-workspace.hook';

const knowledge = {
  collections: [{ id: 'col-1', name: 'Field notes', createdAt: '' }],
  documents: [{ id: 'doc-1', collectionId: 'col-1', name: 'Notes.md', kind: 'markdown', createdAt: '' }],
  versions: [], artifact: null, results: [], jobs: [], embeddingModel: '',
  setEmbeddingModel: async () => {}, rebuildCollection: async () => {}, indexStatus: async () => ({ current: null, configured: { model: '', dimensions: 0, metric: 'cosine', chunkerVersion: 'char-window-v1' }, rebuildRequired: false }), indexStatuses: {}, status: '', error: '',
  ingest: async () => {}, createCollection: async () => {}, updateCollection: async () => {}, deleteCollection: async () => {}, selectDocument: async () => {}, openCitation: async () => {},
  inspectExtraction: async () => {}, indexVersion: async () => {}, cancelJob: async () => {}, search: async () => {}, refresh: async () => {}
} as unknown as KnowledgeWorkspaceState;

function waitFor(predicate: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - started > 5000) { reject(new Error(`timed out waiting for ${label}`)); return; }
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('the attach dialog opens as a dialog and offers files and knowledge', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let uploadRequested = false;
  try {
    await act(async () => {
      root.render(<ComposerAttachDialog
        knowledge={knowledge}
        selection={EMPTY_CONTEXT_SELECTION}
        onChange={() => {}}
        onUploadFiles={() => { uploadRequested = true; }}
        onClose={() => {}}/>);
    });
    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"]') !== null, 'the attach dialog'); });

    const dialog = document.querySelector<HTMLDialogElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('button')?.textContent).toContain('Upload files');
    expect(dialog.querySelector('[aria-label="Attach knowledge"]')).toBeNull();

    const knowledgeButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Attach knowledge'));
    expect(knowledgeButton).toBeDefined();
    await act(async () => { knowledgeButton!.click(); });

    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"] input[aria-label="Search knowledge"]') !== null, 'the knowledge picker'); });
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Field notes');
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test('choosing a collection in the picker reports the attached selection', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changes: string[] = [];
  try {
    await act(async () => {
      root.render(<ComposerAttachDialog
        knowledge={knowledge}
        selection={EMPTY_CONTEXT_SELECTION}
        onChange={(selection) => { changes.push(selection.collections.map((entry) => entry.id).join(',')); }}
        onUploadFiles={() => {}}
        onClose={() => {}}/>);
    });
    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"]') !== null, 'the attach dialog'); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.includes('Attach knowledge'))!.click();
    });
    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"] input[aria-label="Search knowledge"]') !== null, 'the knowledge picker'); });

    const collection = document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Attach Field notes"]')!;
    await act(async () => { collection.click(); });
    expect(changes).toEqual(['col-1']);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});

test('the picker keeps an already attached collection out of a second chip', async () => {
  const attached = attachContext(EMPTY_CONTEXT_SELECTION, { kind: 'collection', id: 'col-1', name: 'Field notes' });
  expect(attached.collections).toHaveLength(1);
  expect(attachContext(attached, { kind: 'collection', id: 'col-1', name: 'Field notes' })).toBe(attached);
});

/**
 * The picker used to carry a "Show documents" control under every
 * collection, which repeated a control that says nothing about the item
 * next to it. The documents are revealed by the row itself instead.
 */
test('the documents of a collection are revealed by the row, not by a repeated control', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<ComposerAttachDialog
        knowledge={knowledge}
        selection={EMPTY_CONTEXT_SELECTION}
        onChange={() => {}}
        onUploadFiles={() => {}}
        onClose={() => {}}/>);
    });
    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"]') !== null, 'the attach dialog'); });
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.includes('Attach knowledge'))!.click();
    });
    await act(async () => { await waitFor(() => document.querySelector('[role="dialog"] input[aria-label="Search knowledge"]') !== null, 'the knowledge picker'); });

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).not.toContain('Show documents');
    expect(dialog.textContent).not.toContain('Hide documents');
    // The document is not offered until the row is expanded.
    expect(dialog.querySelector('button[aria-label="Attach Notes.md"]')).toBeNull();

    const disclosure = dialog.querySelector<HTMLButtonElement>('button[aria-label="Expand the documents in Field notes"]')!;
    expect(disclosure).toBeDefined();
    await act(async () => { disclosure.click(); });

    expect(dialog.querySelector('button[aria-label="Attach Notes.md"]')).not.toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
});
