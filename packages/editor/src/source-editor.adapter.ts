import { basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorState, Prec, Text, Transaction, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { markdown } from '@codemirror/lang-markdown';

export interface SourceEditorOptions {
  name: string;
  content: string;
  readOnly?: boolean;
  theme: 'light' | 'dark';
  onChange(content: string): void;
  onSelectionChange?(selectedText: string): void;
  onSave?(): void | Promise<void>;
}

export interface SourceEditorController {
  view: EditorView;
  configure(options: Pick<SourceEditorOptions, 'name' | 'readOnly' | 'theme'>): void;
  setContent(content: string): void;
  destroy(): void;
}

function language(name: string): Extension {
  const extension = name.split('.').at(-1)?.toLowerCase();
  switch (extension) {
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'js': case 'mjs': case 'cjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'json': return json();
    case 'html': case 'htm': case 'svg': return html();
    case 'css': return css();
    case 'py': case 'pyw': return python();
    case 'rs': return rust();
    case 'md': case 'markdown': case 'mdown': return markdown();
    default: return [];
  }
}

function appearance(theme: SourceEditorOptions['theme']): Extension {
  return [
    syntaxHighlighting(theme === 'dark' ? oneDarkHighlightStyle : defaultHighlightStyle),
    EditorView.theme({
      '&': { height: '100%', minHeight: '180px', color: 'var(--text-body, #24262b)', backgroundColor: 'transparent', fontSize: '13px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)', lineHeight: '1.65' },
      '.cm-content': { padding: '16px 0', caretColor: 'var(--text-strong, #24262b)' },
      '.cm-line': { padding: '0 16px 0 8px' },
      '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-muted, #70747c)', border: 'none', paddingRight: '8px' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--surface-hover, #f0f1f3)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft, #d8e7ff)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-strong, #24262b)' },
      '.cm-panels': { backgroundColor: 'var(--surface-raised, #f4f5f7)', color: 'var(--text-body, #24262b)', borderColor: 'var(--line-soft, #ddd)' },
      '.cm-search': { padding: '8px 12px' },
      '.cm-textfield': { backgroundColor: 'var(--surface-inset, #fff)', color: 'var(--text-body, #24262b)', border: '1px solid var(--line-soft, #ddd)', borderRadius: '6px' },
      '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--surface-hover, #eceef1)', color: 'var(--text-body, #24262b)', border: '1px solid var(--line-soft, #ddd)', borderRadius: '6px' },
      '.cm-tooltip': { backgroundColor: 'var(--surface-raised, #f4f5f7)', color: 'var(--text-body, #24262b)', border: '1px solid var(--line-soft, #ddd)', borderRadius: '6px' },
      '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft, #d8e7ff)', color: 'var(--text-strong, #24262b)' },
      '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-hover, #eceef1)', border: 'none', color: 'var(--text-muted, #70747c)' }
    }, { dark: theme === 'dark' })
  ];
}

const externalContent = Annotation.define<boolean>();

export function createSourceEditor(parent: HTMLElement, options: SourceEditorOptions): SourceEditorController {
  const configuration = new Compartment();
  const lineEndings = new Compartment();
  const configure = (value: Pick<SourceEditorOptions, 'name' | 'readOnly' | 'theme'>): Extension => [
    language(value.name), appearance(value.theme),
    EditorState.readOnly.of(value.readOnly ?? false),
    EditorView.editable.of(!value.readOnly),
    EditorView.contentAttributes.of({ 'aria-label': `${value.name} source editor`, 'aria-readonly': String(value.readOnly ?? false) })
  ];
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: options.content, extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { if (!view.state.readOnly) void options.onSave?.(); return true; } }])),
      configuration.of(configure(options)),
      lineEndings.of(EditorState.lineSeparator.of(options.content.includes('\r\n') ? '\r\n' : '\n')),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalContent))) options.onChange(update.state.sliceDoc());
        if (update.selectionSet || update.docChanged) {
          const selected = update.state.selection.ranges.filter((range) => !range.empty).map((range) => update.state.sliceDoc(range.from, range.to)).join('\n');
          options.onSelectionChange?.(selected);
        }
      })
    ] })
  });
  return {
    view,
    configure: (value) => view.dispatch({ effects: configuration.reconfigure(configure(value)) }),
    setContent: (content) => {
      const before = view.state.doc.toString();
      const normalized = content.replaceAll('\r\n', '\n');
      const separator = content.includes('\r\n') ? '\r\n' : '\n';
      if (view.state.facet(EditorState.lineSeparator) !== separator) view.dispatch({ effects: lineEndings.reconfigure(EditorState.lineSeparator.of(separator)) });
      if (before === normalized) return;
      let from = 0;
      while (from < before.length && from < normalized.length && before[from] === normalized[from]) from++;
      let oldTo = before.length; let newTo = normalized.length;
      while (oldTo > from && newTo > from && before[oldTo - 1] === normalized[newTo - 1]) { oldTo--; newTo--; }
      /* Keep the user's selection across an external rewrite so a late file load
         or parent echo does not clear a highlight a few seconds after open. */
      const selection = view.state.selection;
      view.dispatch({
        changes: { from, to: oldTo, insert: Text.of(normalized.slice(from, newTo).split('\n')) },
        selection,
        annotations: [externalContent.of(true), Transaction.addToHistory.of(false)],
      });
    },
    destroy: () => view.destroy()
  };
}
