import { afterEach, beforeEach, expect, test } from 'bun:test';
import '../../support/editor-dom.adapter';

import type { IEditor } from '@lobehub/editor';
import type { RichDocument } from '../../../packages/editor/src/rich-document.domain.public';
import type { LobeDocumentEditorControls } from '../../../packages/editor/src/rich-document-editor.component';

/**
 * react and react-dom load dynamically, after the adapter registers the
 * document. react-dom snapshots canUseDOM at module scope, and a document that
 * does not exist yet flips it to false, which silently disables text-input
 * onChange: React then falls back to its legacy keyup polyfill and every
 * native input event dispatched in a test is dropped.
 */
const { act, createElement, createRef } = await import('react');
const { createRoot } = await import('react-dom/client');
const { INSERT_FILE_COMMAND, INSERT_MATH_COMMAND } = await import('@lobehub/editor');
const { createRichDocument, isNativeBody, markdownToNativeBody, nativeBodyToMarkdown } = await import('../../../packages/editor/src/rich-document.domain.public');
const { applyProposalToEditor, createDocumentAIProposal } = await import('../../../packages/editor/src/document-ai-proposal.domain.public');
const { LobeDocumentEditor } = await import('../../../packages/editor/src/rich-document-editor.component');

const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
beforeEach(() => Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true }));
afterEach(() => {
  if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

function noteWith(markdown: string, id: string, title = 'Note'): RichDocument {
  return { ...createRichDocument(title, id), body: markdownToNativeBody(markdown) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** The editor is portaled to document.body, so the query spans the whole document. */
function editable(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[contenteditable="true"]');
}

function editorText(): string | null {
  return editable()?.textContent ?? null;
}

/** Select an exact substring in the editable surface and notify Lexical. */
function selectWithin(root: HTMLElement, phrase: string) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current && !current.textContent?.includes(phrase)) current = walker.nextNode();
  if (!current) throw new Error(`No text node contains "${phrase}".`);
  const start = current.textContent!.indexOf(phrase);
  const range = root.ownerDocument.createRange();
  range.setStart(current, start);
  range.setEnd(current, start + phrase.length);
  const selection = root.ownerDocument.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  // happy-dom does not dispatch selectionchange itself; Lexical listens for it.
  root.ownerDocument.dispatchEvent(new Event('selectionchange'));
}

async function mountEditor(note: RichDocument) {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError(error) { errors.push(error); } });

  try {
    act(() => {
      root.render(createElement(LobeDocumentEditor, { document: note, onChange() {} }));
    });
    await act(settle);
    return { errors, hasEditor: editable() !== null, text: editorText() };
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

test('the Lobe editor mounts its content for a populated note', async () => {
  expect(await mountEditor(noteWith('Saved note', 'note-1', 'Saved note'))).toEqual({ errors: [], hasEditor: true, text: 'Saved note' });
});

test('the Lobe editor mounts an empty editable note', async () => {
  expect(await mountEditor(createRichDocument('Empty note', 'note-empty'))).toEqual({ errors: [], hasEditor: true, text: '' });
});

test('file upload returns a portable URL to the public Lobe insertion command', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const url = 'data:text/plain;base64,aGVsbG8=';
  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: createRichDocument('Uploads', 'upload-test'), editorRef,
      onAttach: async (file) => ({ id: 'attachment', name: file.name, mediaType: file.type, size: file.size, dataUrl: url })
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Editor did not initialize.');
    await act(async () => { editor.focus(); await settle(); });
    await act(async () => {
      editor.dispatchCommand(INSERT_FILE_COMMAND, { file: new File(['hello'], 'hello.txt', { type: 'text/plain' }) });
      await settle();
    });
    const markdown: unknown = editor.getDocument('markdown');
    expect(typeof markdown).toBe('string');
    expect(markdown).toContain(`[hello.txt](${url})`);
  } finally { act(() => root.unmount()); host.remove(); }
});

test('deleting the last text reports the empty native body to the document draft', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const changes: unknown[] = [];

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: noteWith('Saved note', 'note-delete-all', 'Saved note'),
      editorRef,
      onChange(body) { changes.push(body); }
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');
    await act(async () => {
      editor.setDocument('text', 'Changed note');
      await settle();
    });
    expect(nativeBodyToMarkdown(changes.at(-1))).toContain('Changed note');
    await act(async () => {
      editor.cleanDocument();
      await settle();
    });
    const markdownSource: unknown = editor.getDocument('markdown');
    expect(markdownSource).toBe('');
    // The emptied document is still a valid native body — the only valid empty.
    const last = changes.at(-1);
    expect(isNativeBody(last)).toBe(true);
    expect(nativeBodyToMarkdown(last).trim()).toBe('');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('switching notes re-seeds the editor before the next edit', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const changes: unknown[] = [];
  const first = noteWith('First note', 'note-first', 'First');
  const second = noteWith('Second note', 'note-second', 'Second');

  try {
    const render = (note: RichDocument) => root.render(createElement(LobeDocumentEditor, {
      document: note, editorRef, onChange(body) { changes.push(body); }
    }));
    act(() => render(first));
    await act(settle);
    act(() => render(second));
    await act(settle);
    expect(editorText()).toContain('Second note');
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');
    await act(async () => {
      editor.setDocument('text', 'Edited second note');
      await settle();
    });
    const last = nativeBodyToMarkdown(changes.at(-1));
    expect(last).toContain('Edited second note');
    expect(last).not.toContain('First note');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('selection changes reach onSelectionChange with the selected text', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const selected: string[] = [];

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: noteWith('Select this text', 'note-selection', 'Selection'),
      editorRef,
      onSelectionChange(text) { selected.push(text); }
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');

    const select = (phrase: string) => act(async () => {
      const surface = editable();
      if (!surface) throw new Error('Editable surface missing.');
      selectWithin(surface, phrase);
      await settle();
    });

    await select('Select');
    expect(selected.at(-1)).toBe('Select');
    await select('this');
    expect(selected.at(-1)).toBe('this');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('selection review shows the change in document context and cancel preserves the editor', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const note = noteWith('Keep before\n\nReplace this\n\nKeep after', 'note-inline-review');
  const proposal = createDocumentAIProposal({ document: note, scope: 'selection', beforeText: 'Replace this', afterText: 'Updated selection', proposedMarkdown: 'Updated selection' });
  let cancelled = false;
  const render = (active: typeof proposal | null) => root.render(createElement(LobeDocumentEditor, {
    document: note, activeProposal: active, onAcceptProposal() {}, onRejectProposal() {}, onCancelProposal() { cancelled = true; }, onChange() {}
  }));
  try {
    await act(async () => { render(null); await settle(); });
    await act(async () => { render(proposal); await settle(); });
    const review = host.querySelector('[aria-label="Document change review"]');
    expect(review?.textContent?.match(/Keep before/g)).toHaveLength(1);
    expect(review?.textContent?.match(/Keep after/g)).toHaveLength(1);
    expect(review?.textContent).toContain('Replace this');
    expect(review?.textContent).toContain('Updated selection');
    const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Cancel');
    await act(async () => { cancel?.click(); render(null); await settle(); });
    expect(cancelled).toBe(true);
    expect(editorText()).toContain('Replace this');
    expect(editorText()).not.toContain('Updated selection');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('applying a proposal loads the reviewed markdown whole, keeping unrelated paragraphs', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const changes: unknown[] = [];
  const note = noteWith('Keep before\n\nReplace this\n\nKeep after', 'note-proposal', 'Proposal');

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: note, editorRef, onChange(body) { changes.push(body); }
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');
    const proposal = createDocumentAIProposal({
      document: note, scope: 'selection',
      beforeText: 'Replace this',
      afterText: 'Updated selection',
      proposedMarkdown: 'Updated selection'
    });
    await act(async () => {
      applyProposalToEditor(editor, proposal);
      await settle();
    });
    const applied = nativeBodyToMarkdown(changes.at(-1));
    expect(applied).toContain('Keep before');
    expect(applied).toContain('Updated selection');
    expect(applied).toContain('Keep after');
    expect(applied).not.toContain('Replace this');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('accepting a proposal leaves the applied change undoable on the open surface', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const changes: unknown[] = [];
  const toolbar: { current: LobeDocumentEditorControls | null } = { current: null };
  const note = noteWith('Keep before\n\nReplace this\n\nKeep after', 'note-undo', 'Proposal');

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: note,
      editorRef,
      renderToolbar(state) { toolbar.current = state; return null; },
      onChange(body) { changes.push(body); }
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');
    const proposal = createDocumentAIProposal({
      document: note, scope: 'selection',
      beforeText: 'Replace this',
      afterText: 'Updated selection',
      proposedMarkdown: 'Updated selection'
    });
    await act(async () => {
      applyProposalToEditor(editor, proposal);
      await settle();
    });
    expect(nativeBodyToMarkdown(changes.at(-1))).toContain('Updated selection');
    const applied = toolbar.current;
    expect(applied?.canUndo).toBe(true);
    await act(async () => {
      applied?.undo();
      await settle();
    });
    const restored = nativeBodyToMarkdown(changes.at(-1));
    expect(restored).toContain('Replace this');
    expect(restored).not.toContain('Updated selection');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('the document editor does not render a separate AI prompt bar', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: noteWith('Rewrite this sentence', 'note-prompt', 'Prompt'),
      onChange() {}
    })));
    await act(settle);
    expect(document.querySelector('[data-testid="prompt-bar"]')).toBeNull();
    expect(document.querySelector('textarea[aria-label="Ask AI prompt"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test('stored math survives hydration and the equation command adds inline math', async () => {
  const host = globalThis.document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editorRef = createRef<IEditor>();
  const changes: unknown[] = [];

  try {
    act(() => root.render(createElement(LobeDocumentEditor, {
      document: noteWith('Before $a+b$ after', 'note-math', 'Math'),
      editorRef,
      onChange(body) { changes.push(body); }
    })));
    await act(settle);
    const editor = editorRef.current;
    if (!editor) throw new Error('Lobe editor did not initialize.');

    // Hydration must not drop the stored math node from the live document.
    const hydrated: unknown = editor.getDocument('markdown');
    expect(String(hydrated)).toContain('$a+b$');

    // The mounted math plugin is active: the insert command adds real math.
    await act(async () => { editor.focus(); await settle(); });
    await act(async () => {
      editor.dispatchCommand(INSERT_MATH_COMMAND, { code: 'c+d' });
      await settle();
    });
    const after: unknown = editor.getDocument('markdown');
    expect(String(after)).toContain('$c+d$');

    // The stored body keeps math through the native-body Markdown bridge.
    const emitted = nativeBodyToMarkdown(changes.at(-1));
    expect(emitted).toContain('$a+b$');
    expect(emitted).toContain('$c+d$');
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
