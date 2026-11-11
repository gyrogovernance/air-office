import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactBlockPlugin,
  ReactCodePlugin,
  ReactCodeblockPlugin,
  ReactFilePlugin,
  ReactHRPlugin,
  ReactImagePlugin,
  ReactLiteXmlPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
  INSERT_HEADING_COMMAND,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_HORIZONTAL_RULE_COMMAND,
  INSERT_MATH_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_QUOTE_COMMAND,
  INSERT_TABLE_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  type IEditor
} from '@lobehub/editor';
import { Editor, useEditor, useEditorState, type EditorState } from '@lobehub/editor/react';
import { $createParagraphNode, $getSelection, type SerializedEditorState } from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
/* Desktop CSP blocks Lobe ThemeProvider's CDN KaTeX CSS; ship it with the bundle. */
import 'katex/dist/katex.min.css';
import { documentMarkdown, emptyNativeBody, isNativeBody, nativeBodyContentKey, sanitizeNativeBodyMath, type RichDocument, type RichDocumentAttachment } from './rich-document.domain.public';
import type { DocumentAIProposal } from './document-ai-proposal.domain.public';
import { DocumentAIProposalView } from './document-ai-proposal-view.component';

export type LobeDocumentEditorControls = EditorState & {
  paragraph: () => void;
  heading: (tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => void;
  table: () => void;
  divider: () => void;
};

export type LobeDocumentEditorProps = {
  document: RichDocument;
  /**
   * When set, Lobe hydrates with `type="markdown"` (its supported file exchange
   * path) instead of a pre-converted JSON body. Vault notes omit this and keep
   * the native JSON lifecycle.
   */
  seedMarkdown?: string;
  readOnly?: boolean;
  theme?: 'light' | 'dark';
  /** Native body, plus markdown when the editor was seeded from markdown. */
  onChange?: (body: unknown, markdown?: string) => void;
  onAttach?: (file: File) => Promise<RichDocumentAttachment | undefined>;
  onSelectionChange?: (selectedText: string) => void;
  editorRef?: React.MutableRefObject<IEditor | null>;
  activeProposal?: DocumentAIProposal | null;
  isProposalStale?: boolean;
  onAcceptProposal?: () => void;
  onRejectProposal?: () => void;
  onCancelProposal?: () => void;
  renderToolbar?: (controls: LobeDocumentEditorControls) => ReactNode;
};

/**
 * Change-detection key for a native body. Lobe re-allocates node ids every time a
 * body is loaded into an editor, so ids are opaque and never part of a comparison:
 * two bodies with identical structure are the same content.
 */
export function LobeDocumentEditor({
  document,
  seedMarkdown,
  readOnly = false,
  theme = 'light',
  onChange,
  onAttach,
  onSelectionChange,
  editorRef,
  activeProposal,
  isProposalStale = false,
  onAcceptProposal,
  onRejectProposal,
  onCancelProposal,
  renderToolbar
}: LobeDocumentEditorProps) {
  const editor = useEditor();
  const [editorMount, setEditorMount] = useState<HTMLDivElement | null>(null);
  const editorState = useEditorState(editor);
  const controls: LobeDocumentEditorControls = {
    ...editorState,
    paragraph: () => editor.getLexicalEditor()?.update(() => $setBlocksType($getSelection(), $createParagraphNode)),
    heading: (tag) => { editor.dispatchCommand(INSERT_HEADING_COMMAND, { tag }); },
    table: () => { editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '3' }); },
    divider: () => { editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined); }
  };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const currentSelectionRef = useRef('');
  const markdownSeed = seedMarkdown !== undefined;
  const seedMarkdownRef = useRef(seedMarkdown);
  seedMarkdownRef.current = seedMarkdown;

  const rawSeedBody = useMemo(() => sanitizeNativeBodyMath(isNativeBody(document.body) ? document.body : emptyNativeBody()), [document.body]);
  /* Keep a stable object for identical content so Lobe's `content` prop and
     setDocument do not see a new body on every parent buffer write (that resets
     the cursor and clears selections a few seconds after open). */
  const jsonSeedKey = nativeBodyContentKey(rawSeedBody);
  const seedKey = markdownSeed ? `md:${seedMarkdown}` : jsonSeedKey;
  const seedBodyRef = useRef(rawSeedBody);
  const seedKeyRef = useRef(seedKey);
  if (!markdownSeed && seedKeyRef.current !== seedKey) {
    seedBodyRef.current = rawSeedBody;
  }
  if (seedKeyRef.current !== seedKey) seedKeyRef.current = seedKey;
  const seedBody = seedBodyRef.current;
  const seedContent = markdownSeed ? seedMarkdown : seedBody;
  const seedType = markdownSeed ? 'markdown' : 'json';
  const reviewing = !!(activeProposal && onAcceptProposal && onRejectProposal && onCancelProposal);
  const isEmptyDocument = useMemo(() => {
    if (markdownSeed) return seedMarkdown.trim() === '';
    try { return documentMarkdown(document).trim() === ''; } catch { return false; }
  }, [document, markdownSeed, seedMarkdown]);
  const lastEmittedKeyRef = useRef(seedKey);
  const currentDocumentIdRef = useRef(document.id);

  // The editor instance can survive a note switch. Reset adapter-local baselines
  // synchronously so its first edit cannot inherit another note's source or ids.
  if (currentDocumentIdRef.current !== document.id) {
    currentDocumentIdRef.current = document.id;
    lastEmittedKeyRef.current = seedKey;
    currentSelectionRef.current = '';
  }

  // Lobe hydrates the `content` prop only on first mount, so an already-mounted
  // editor must be re-seeded whenever the stored body changes underneath it — a
  // note switch or a source-mode apply, but never the echo of its own edit (that
  // would reset the cursor and undo stack on every keystroke).
  const lastSeededKeyRef = useRef<string>(seedKey);
  const seededDocumentIdRef = useRef<string>(document.id);
  useEffect(() => {
    const sameDocument = seededDocumentIdRef.current === document.id;
    if (sameDocument && seedKey === lastSeededKeyRef.current) return;
    lastSeededKeyRef.current = seedKey;
    if (sameDocument && seedKey === lastEmittedKeyRef.current) return;
    seededDocumentIdRef.current = document.id;
    try { editor.setDocument(seedType, seedContent); } catch { /* The mount hydration still applies. */ }
  }, [document.id, seedKey, seedContent, seedType, editor]);

  const emitSelection = (text: string) => {
    if (text === currentSelectionRef.current) return;
    currentSelectionRef.current = text;
    onSelectionChangeRef.current?.(text);
  };

  // DOM selectionchange covers environments where Lexical has not yet mirrored
  // the native range into getSelectionDocument.
  useEffect(() => {
    if (!onSelectionChange) return;
    const doc = editorMount?.ownerDocument ?? (typeof globalThis.document !== 'undefined' ? globalThis.document : null);
    if (!doc || typeof doc.addEventListener !== 'function') return;
    const onDomSelection = () => {
      const domSel = doc.getSelection?.() ?? null;
      if (!domSel || domSel.isCollapsed) {
        const anchor = domSel?.anchorNode;
        /* Ignore collapses outside the note (chat refresh, toolbar clicks). Those
           fired selectionchange and cleared the reported selection every few seconds. */
        if (anchor && editorMount?.contains(anchor)) emitSelection('');
        return;
      }
      const anchor = domSel.anchorNode;
      if (!anchor || typeof (anchor as Node).nodeType !== 'number') return;
      const editableRoot = (anchor as Node).parentElement?.closest?.('[contenteditable="true"]');
      if (!editableRoot) return;
      if (editorMount && !editorMount.contains(editableRoot)) return;
      emitSelection(domSel.toString());
    };
    doc.addEventListener('selectionchange', onDomSelection);
    return () => doc.removeEventListener('selectionchange', onDomSelection);
  }, [editorMount, onSelectionChange]);

  const emitDocument = (instance: IEditor) => {
    try {
      const raw: unknown = (instance as unknown as { getDocument(type: string): unknown }).getDocument('json');
      const body = sanitizeNativeBodyMath(raw);
      if (!isNativeBody(body)) return;
      if (seedMarkdownRef.current !== undefined) {
        const markdown = (instance as unknown as { getDocument(type: string): unknown }).getDocument('markdown');
        if (typeof markdown !== 'string') return;
        const key = `md:${markdown}`;
        if (key === lastEmittedKeyRef.current) return;
        lastEmittedKeyRef.current = key;
        onChangeRef.current?.(body, markdown);
        return;
      }
      const key = nativeBodyContentKey(body);
      if (key === lastEmittedKeyRef.current) return;
      lastEmittedKeyRef.current = key;
      onChangeRef.current?.(body);
    } catch {
      // Export failure should not crash the editor; the next change retries.
    }
  };

  // Expose the Lobe instance; capture the first hydrate so markdown files get a
  // native body for proposals without a separate headless convert on open.
  const handleInit = (instance: IEditor) => {
    if (editorRef) editorRef.current = instance;
    emitDocument(instance);
  };

  // Lobe's onChange fires for selection too. Content belongs on onTextChange.
  const handleSelectionChange = (instance: IEditor) => {
    try {
      const sel = instance.getSelection();
      if (sel) {
        const selDoc = instance.getSelectionDocument('markdown');
        const text = typeof selDoc === 'string' ? selDoc.replace(/\n+$/, '') : '';
        if (text) {
          emitSelection(text);
          return;
        }
      }
      const domDocument = globalThis.document;
      const domSel = domDocument?.getSelection?.() ?? null;
      if (domSel && !domSel.isCollapsed) emitSelection(domSel.toString());
      else emitSelection('');
    } catch {
      // Selection extraction is best-effort.
    }
  };

  /* Stable identities so Lobe's debounced listeners are not rebuilt every render. */
  const emitDocumentRef = useRef(emitDocument);
  emitDocumentRef.current = emitDocument;
  const handleSelectionChangeRef = useRef(handleSelectionChange);
  handleSelectionChangeRef.current = handleSelectionChange;
  const onTextChangeStable = useCallback((instance: IEditor) => emitDocumentRef.current(instance), []);
  const onChangeStable = useCallback((instance: IEditor) => handleSelectionChangeRef.current(instance), []);

  const slashItems = useMemo(() => [
    { key: 'h1', label: 'Heading 1', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h1' }) },
    { key: 'h2', label: 'Heading 2', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h2' }) },
    { key: 'h3', label: 'Heading 3', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h3' }) },
    { key: 'h4', label: 'Heading 4', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h4' }) },
    { key: 'h5', label: 'Heading 5', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h5' }) },
    { key: 'h6', label: 'Heading 6', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HEADING_COMMAND, { tag: 'h6' }) },
    { key: 'bullet-list', label: 'Bullet list', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined) },
    { key: 'numbered-list', label: 'Numbered list', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined) },
    { key: 'check-list', label: 'Checklist', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined) },
    { key: 'code-block', label: 'Code block', onSelect: editorState.codeblock },
    { key: 'quote', label: 'Quote', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_QUOTE_COMMAND, undefined) },
    { key: 'equation', label: 'Equation', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_MATH_COMMAND, { code: 'x' }) },
    { key: 'divider', label: 'Divider', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined) },
    { key: 'table', label: 'Table', onSelect: (instance: IEditor) => instance.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '3', columns: '3' }) },
  ], [editorState.codeblock]);

  return (
    <div className="air-office-editor-shell" data-testid="lobe-editor-shell">
      {!readOnly && !reviewing && renderToolbar?.(controls)}
      <div ref={setEditorMount} className="air-office-editor-mount" hidden={reviewing}/>
      {/* ThemeProvider must live on document.body (outside GlassScene filters) so
          Lobe's fixed block gutter, slash menu, and table controllers measure in
          viewport space. Do not nest a second antd App or zero the host height —
          table chrome portals to `.ant-app`, and height:0 + a nested App made
          desktop WebView place handles at the wrong origin and drop elevated
          surfaces. Editor paint stays in the mount; React context still flows. */}
      {editorMount && createPortal(<ConfigProvider motion={motion} config={{ proxy: 'custom' }}>
        <ThemeProvider
          className="air-office-editor-portals"
          themeMode={theme}
          theme={{
            cssVar: true,
            token: { controlHeightSM: 24, fontFamily: 'var(--font-sans)' }
          }}
          enableCustomFonts={false}
          enableGlobalStyle={false}
        >
          {createPortal(
            <div className={theme === 'dark' ? 'lobe-editor-dark' : undefined}>
              <Editor
                className="air-office-lobe-editor"
                editor={editor}
                content={seedContent}
                type={seedType}
                editable={!readOnly}
                placeholder={isEmptyDocument ? <span className="air-office-note-placeholder">Write your note...</span> : undefined}
                onInit={handleInit}
                onChange={onChangeStable}
                onTextChange={onTextChangeStable}
                plugins={[
                  ReactLiteXmlPlugin,
                  Editor.withProps(ReactBlockPlugin, { anchorPadding: 'var(--editor-block-gutter)' }),
                  ReactListPlugin,
                  ReactLinkPlugin,
                  ReactMathPlugin,
                  ReactTablePlugin,
                  ReactHRPlugin,
                  ReactCodePlugin,
                  ReactCodeblockPlugin,
                  Editor.withProps(ReactImagePlugin, {
                    handleUpload: async (file: File) => {
                      const attachment = await onAttach?.(file);
                      if (!attachment) throw new Error('The attachment was not saved.');
                      return { url: attachment.dataUrl };
                    }
                  }),
                  Editor.withProps(ReactFilePlugin, {
                    handleUpload: async (file: File) => {
                      const attachment = await onAttach?.(file);
                      if (!attachment) throw new Error('The attachment was not saved.');
                      return { url: attachment.dataUrl };
                    }
                  })
                ]}
                slashOption={{ items: slashItems }}
              />
            </div>,
            editorMount
          )}
        </ThemeProvider>
      </ConfigProvider>, globalThis.document.body)}

      {activeProposal && onAcceptProposal && onRejectProposal && onCancelProposal && (
        <DocumentAIProposalView
          proposal={activeProposal}
          oldValue={seedBody as unknown as SerializedEditorState}
          oldMarkdown={(() => {
            try {
              const live = editor.getDocument?.('markdown');
              if (typeof live === 'string' && live.length > 0) return live;
            } catch { /* Fall through to the stored document. */ }
            try { return documentMarkdown(document); } catch { return seedMarkdown ?? ''; }
          })()}
          isStale={isProposalStale}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
          onCancel={onCancelProposal}
        />
      )}
    </div>
  );
}
