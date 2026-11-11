import '../../support/editor-dom.adapter';
import { expect, test } from 'bun:test';
import { undo, redo } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createSourceEditor } from '../../../packages/editor/src/source-editor.adapter';
import { SourceEditor } from '../../../packages/editor/src/source-editor.component';

test('real CodeMirror editing preserves history through controlled echoes and maps external refresh', () => {
  const host = document.createElement('div'); document.body.append(host);
  const changes: string[] = []; const selections: string[] = [];
  const editor = createSourceEditor(host, { name: 'note.ts', content: 'const value = 1;', theme: 'light', onChange: (value) => changes.push(value), onSelectionChange: (value) => selections.push(value) });
  try {
    editor.view.dispatch({ changes: { from: 14, to: 15, insert: '2' } });
    expect(changes).toEqual(['const value = 2;']);
    editor.setContent('const value = 2;');
    expect(undo(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('const value = 1;');
    expect(redo(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe('const value = 2;');
    const count = changes.length;
    editor.setContent('// external\nconst value = 2;');
    expect(changes.length).toBe(count);
    editor.view.dispatch({ selection: { anchor: 18, head: 23 } });
    expect(selections.at(-1)).toBe('value');
    expect(syntaxTree(editor.view.state).topNode.name).toBe('Script');
    expect(host.querySelector('.cm-lineNumbers')).not.toBeNull();
  } finally { editor.destroy(); host.remove(); }
});

test('standard save and search shortcuts work and readonly disables editing and save', () => {
  const host = document.createElement('div'); document.body.append(host);
  let saves = 0;
  const editor = createSourceEditor(host, { name: 'data.json', content: '{"a":1}', theme: 'dark', onChange() {}, onSave() { saves++; } });
  try {
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(saves).toBe(1);
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(host.querySelector('.cm-search')).not.toBeNull();
    editor.configure({ name: 'data.json', readOnly: true, theme: 'light' });
    expect(editor.view.state.readOnly).toBe(true);
    expect(editor.view.contentDOM.getAttribute('contenteditable')).toBe('false');
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(saves).toBe(1);
    expect(syntaxTree(editor.view.state).topNode.name).toBe('JsonText');
  } finally { editor.destroy(); host.remove(); }
});

test('CRLF text edits retain Windows line endings and external multi-line updates use document positions', () => {
  const host = document.createElement('div'); document.body.append(host);
  const changes: string[] = [];
  const editor = createSourceEditor(host, { name: 'readme.txt', content: 'one\r\ntwo\r\n', theme: 'light', onChange: (value) => changes.push(value) });
  try {
    editor.view.dispatch({ changes: { from: 4, to: 7, insert: 'three' } });
    expect(changes).toEqual(['one\r\nthree\r\n']);
    editor.setContent('one\r\nexternal\r\nadded\r\n');
    expect(editor.view.state.sliceDoc()).toBe('one\r\nexternal\r\nadded\r\n');
    expect(editor.view.state.doc.lines).toBe(4);
    expect(changes).toEqual(['one\r\nthree\r\n']);
  } finally { editor.destroy(); host.remove(); }
});

test('React controlled updates keep the same editor and switching files creates a fresh document', () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const changes: string[] = [];
  const render = (fileId: string, content: string) => flushSync(() => root.render(createElement(SourceEditor, { fileId, name: `${fileId}.ts`, content, theme: 'light', onChange: (value: string) => changes.push(value) })));
  const currentView = () => {
    const content = host.querySelector('.cm-content');
    if (!(content instanceof HTMLElement)) throw new Error('Editor did not mount.');
    const view = EditorView.findFromDOM(content);
    if (!view) throw new Error('Editor view unavailable.');
    return view;
  };
  try {
    render('first', 'let count = 1;');
    const first = currentView();
    first.dispatch({ changes: { from: 12, to: 13, insert: '2' } });
    expect(changes).toEqual(['let count = 2;']);
    render('first', 'let count = 2;');
    expect(currentView()).toBe(first);
    expect(undo(first)).toBe(true);
    expect(first.state.doc.toString()).toBe('let count = 1;');
    render('second', 'const next = true;');
    expect(currentView()).not.toBe(first);
    expect(currentView().state.doc.toString()).toBe('const next = true;');
    expect(undo(currentView())).toBe(false);
  } finally { flushSync(() => root.unmount()); host.remove(); }
});
