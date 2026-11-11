import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Tabs } from '@heroui/react';
import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger, GlassToolbar, GlassToolbarButton } from '@glass-sdk/liquid-glass';
import type { RichDocument, RichDocumentAttachment } from '@office/editor/rich-document-domain';
import { documentMarkdown } from '@office/editor/rich-document-domain';
import { LobeDocumentEditor } from '@office/editor/ui';
import type { LobeDocumentEditorProps, LobeDocumentEditorControls, DocumentAIProposal } from '@office/editor/ui';
/* Editor styles load from styles-manifest so portal chrome is in the app cascade. */
import { IconBold, IconChevronDown, IconCode, IconDownload, IconItalic, IconLink, IconMore, IconPaperclip, IconPlus, IconRefresh, IconSave, IconStrike, IconUnderline } from '../app/ui-icons.component';
import { HugeiconsIcon } from '@hugeicons/react';
import { CodeIcon, File01Icon, Redo02Icon, Undo02Icon } from '@hugeicons/core-free-icons';
import { useInterfaceScaleKey } from '../settings/use-interface-scale-key.hook';

type Props = {
  document: RichDocument;
  /** File tabs pass the buffer markdown so Lobe hydrates with type=markdown. */
  seedMarkdown?: string;
  theme?: 'light' | 'dark';
  onChange: (body: unknown, markdown?: string) => void;
  onAttach: (file: File, insert?: boolean) => Promise<RichDocumentAttachment | undefined>;
  onExport: (format: 'markdown' | 'html') => void;
  onSourceMode: () => void;
  sourceMode: boolean;
  sourceValue?: string;
  onSourceDraftChange?: (source: string) => void;
  onSourceChange: (source: string) => void | Promise<void>;
  onSelectionChange?: (selectedText: string) => void;
  editorRef?: LobeDocumentEditorProps['editorRef'];
  onSave?: () => void;
  dirty?: boolean;
  saving?: boolean;
  /** Asks the workspace chat path to draft a proposal for the current selection (or cursor). */
  onPromptAI?: (prompt: string, selectedText: string) => void;
  activeProposal?: DocumentAIProposal | null;
  isProposalStale?: boolean;
  onAcceptProposal?: () => void;
  onRejectProposal?: () => void;
  onCancelProposal?: () => void;
};

export function RichDocumentEditorView(props: Props) {
  return <RichDocumentEditorSession key={props.document.id} {...props}/>;
}

function RichDocumentEditorSession({
  document,
  seedMarkdown,
  theme,
  onChange,
  onAttach,
  onExport,
  onSourceMode,
  sourceMode,
  sourceValue,
  onSourceDraftChange,
  onSourceChange,
  onSelectionChange,
  editorRef,
  onSave,
  dirty = false,
  saving = false,
  onPromptAI,
  activeProposal,
  isProposalStale,
  onAcceptProposal,
  onRejectProposal,
  onCancelProposal
}: Props) {
  const attachmentInput = useRef<HTMLInputElement>(null);
  const interfaceScale = useInterfaceScaleKey();
  const appearance = theme === 'dark' ? 'dark' : 'light';
  const [selection, setSelection] = useState('');
  const reportSelection = (selectedText: string) => {
    setSelection(selectedText);
    onSelectionChange?.(selectedText);
  };
  const [topDock, setTopDock] = useState<Element | null>(null);
  const [bottomDock, setBottomDock] = useState<Element | null>(null);
  const [sourceDraft, setSource] = useState<string | null>(() => {
    try { return localStorage.getItem(`air-office:draft:${document.id}:source`); }
    catch { return null; }
  });
  const currentMarkdown = documentMarkdown(document);
  const source = sourceValue ?? sourceDraft ?? currentMarkdown;
  const [sourceError, setSourceError] = useState('');
  const [sourceStatus, setSourceStatus] = useState('');

  function listSourceBackups(): string[] {
    try {
      const prefix = `air-office:draft:${document.id}:source-backup:`;
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      // Timestamped backup keys sort newest-first; legacy uuid keys follow.
      return keys.sort().reverse();
    } catch {
      return [];
    }
  }
  const sourceBackups = listSourceBackups();

  function restoreSourceBackup() {
    try {
      const [key] = sourceBackups;
      if (!key) return;
      const backup = localStorage.getItem(key);
      if (backup === null) { setSourceError('That source backup is no longer available in this browser.'); return; }
      // Never lose the draft being replaced: keep it as a backup first.
      if (source !== backup && source !== currentMarkdown) {
        localStorage.setItem(`air-office:draft:${document.id}:source-backup:${Date.now()}-${crypto.randomUUID()}`, source);
      }
      if (!protectSource(backup)) return;
      setSourceStatus('Backup restored into the source draft. Apply it to the document to keep it, or edit it first.');
    } catch {
      setSourceError('The source backup could not be restored in this browser.');
    }
  }

  useLayoutEffect(() => {
    setTopDock(window.document.querySelector('.document-top-dock'));
    setBottomDock(window.document.querySelector('.bottom-dock'));
  }, []);

  function protectSource(value: string): boolean {
    setSourceStatus('');
    if (onSourceDraftChange) {
      onSourceDraftChange(value);
      return true;
    }
    setSource(value);
    try {
      localStorage.setItem(`air-office:draft:${document.id}:source`, value);
      setSourceError('');
      return true;
    } catch {
      setSourceError('The source draft could not be protected in this browser. Copy or export it before closing this document.');
      return false;
    }
  }

  function downloadCanonical() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.title}.office-document.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadSource() {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${document.title}.source.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const documentToolbar = (
    <div className="document-controls">
      <Tabs className="document-view-tabs" selectedKey={sourceMode ? 'source' : 'document'} onSelectionChange={(key) => { if ((key === 'source' && !sourceMode) || (key === 'document' && sourceMode)) onSourceMode(); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Editor view mode">
            <Tabs.Tab id="document" className="whitespace-nowrap"><HugeiconsIcon icon={File01Icon} size={16} className="document-mode-icon"/><span className="document-mode-label">Document</span><Tabs.Indicator/></Tabs.Tab>
            <Tabs.Tab id="source" className="whitespace-nowrap"><HugeiconsIcon icon={CodeIcon} size={16} className="document-mode-icon"/><span className="document-mode-label">Source</span><Tabs.Indicator/></Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      {/* Docks sit in the stage GlassScene now; register toolbars there so Regular samples the card, not a flat fill. */}
      <GlassToolbar className="document-action-bar" aria-label="Document tools" material="regular" appearance={appearance}>
        {onSave && <GlassToolbarButton size="icon" aria-label={saving ? 'Saving document' : dirty ? 'Save document' : 'Document saved'} disabled={!dirty || saving} onClick={onSave}><IconSave/></GlassToolbarButton>}
        <GlassMenu>
          <GlassToolbarButton size="icon" aria-label="Document actions" render={<GlassMenuTrigger/>}><IconMore/></GlassToolbarButton>
          <GlassMenuContent className="workspace-menu document-actions-menu ui-frost" align="end" material="regular" appearance={appearance} morph="detach">
            <GlassMenuItem onClick={() => attachmentInput.current?.click()}><IconPaperclip/>Add attachment</GlassMenuItem>
            {onPromptAI && <GlassMenuItem onClick={() => onPromptAI(selection.trim() ? 'Improve this passage.' : 'Continue writing from the cursor.', selection)}>{selection.trim() ? 'Improve selection with AI' : 'Continue with AI'}</GlassMenuItem>}
            <GlassMenuSeparator/>
            <GlassMenuItem onClick={() => onExport('markdown')}><IconDownload/>Export Markdown</GlassMenuItem>
            <GlassMenuItem onClick={() => onExport('html')}><IconDownload/>Export HTML</GlassMenuItem>
            <GlassMenuItem onClick={downloadCanonical}><IconDownload/>Export document JSON</GlassMenuItem>
            <GlassMenuItem onClick={downloadSource}><IconDownload/>Download source draft</GlassMenuItem>
          </GlassMenuContent>
        </GlassMenu>
      </GlassToolbar>
    </div>
  );

  return (
    <div className="rich-document-stage" data-editor-theme={theme}>
      {bottomDock && createPortal(documentToolbar, bottomDock)}
      <input ref={attachmentInput} aria-label="Add attachment" type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAttach(file); event.currentTarget.value = ''; }}/>

      <div className="document-paper-container">
        {sourceMode ? (
          <div className="rich-source-pane">
            <div className="source-pane-header">
              {!onSourceDraftChange && source !== currentMarkdown && <p className="source-pane-notice" role="status">This protected source draft differs from the document. Apply it to the document, or refresh to use the document and keep a backup of this draft.</p>}
              {!onSourceDraftChange && <div className="source-pane-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    try {
                      const updated = documentMarkdown(document);
                      if (updated !== source) {
                        localStorage.setItem(`air-office:draft:${document.id}:source-backup:${Date.now()}-${crypto.randomUUID()}`, source);
                      }
                      protectSource(updated);
                    } catch {
                      setSourceError('Your previous source could not be saved. Download the source draft before refreshing.');
                    }
                  }}
                >
                  <IconRefresh />
                  <span>Refresh</span>
                </Button>
                {sourceBackups.length > 0 && (
                  <Button variant="secondary" size="sm" onPress={restoreSourceBackup}>
                    <span>Restore latest backup</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  onPress={async () => { if (!sourceError) await onSourceChange(source); }}
                  isDisabled={Boolean(sourceError)}
                >
                  Apply to document
                </Button>
              </div>}
            </div>
            {sourceStatus && <p className="source-pane-notice" role="status">{sourceStatus}</p>}
            <textarea
              aria-label="Markdown source"
              className="source-editor-area"
              value={source}
              onChange={(event) => protectSource(event.target.value)}
              spellCheck={false}
            />
            {sourceError && <p className="source-error-banner" role="alert">{sourceError}</p>}
          </div>
        ) : (
          <LobeDocumentEditor
            renderToolbar={(controls) => topDock && createPortal(<DocumentFormattingToolbar controls={controls} appearance={appearance} interfaceScale={interfaceScale}/>, topDock)}
            document={document}
            seedMarkdown={seedMarkdown}
            readOnly={false}
            theme={theme}
            onChange={onChange}
            onAttach={(file) => onAttach(file, false)}
            onSelectionChange={reportSelection}
            editorRef={editorRef}
            activeProposal={activeProposal}
            isProposalStale={isProposalStale}
            onAcceptProposal={onAcceptProposal}
            onRejectProposal={onRejectProposal}
            onCancelProposal={onCancelProposal}
          />
        )}
      </div>

      {document.attachments.length > 0 && (
        <aside className="document-attachments-panel" aria-label="Document attachments">
          <span className="attachments-heading">Attachments ({document.attachments.length})</span>
          <div className="attachments-grid">
            {document.attachments.map((attachment) => (
              <div key={attachment.id} className="attachment-chip">
                <IconPaperclip className="attachment-icon" />
                <a download={attachment.name} href={attachment.dataUrl} className="attachment-link">
                  {attachment.name}
                </a>
                <span className="attachment-size">{Math.ceil(attachment.size / 1024)} KB</span>
              </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function DocumentFormattingToolbar({ controls, appearance, interfaceScale }: {
  controls: LobeDocumentEditorControls;
  appearance: 'light' | 'dark';
  interfaceScale: string;
}) {
  const blockLabels: Record<string, string> = { paragraph: 'Text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', bullet: 'Bullets', number: 'Numbers', check: 'Checklist', quote: 'Quote', code: 'Code block' };
  const retainSelection = (event: React.MouseEvent) => event.preventDefault();
  return (
    <GlassToolbar key={`document-format-${interfaceScale}`} className="document-format-bar" aria-label="Text formatting" material="regular" appearance={appearance}>
      <GlassMenu>
        <GlassToolbarButton className="document-block-type" size="default" aria-label="Block type" onMouseDown={retainSelection} render={<GlassMenuTrigger/>}>
          <span>{blockLabels[controls.blockType ?? 'paragraph'] ?? 'Text'}</span><IconChevronDown/>
        </GlassToolbarButton>
        <GlassMenuContent className="workspace-menu document-format-menu ui-frost" align="start" material="regular" appearance={appearance} morph="detach">
          <GlassMenuItem onClick={controls.paragraph}>Text</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h1')}>Heading 1</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h2')}>Heading 2</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h3')}>Heading 3</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h4')}>Heading 4</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h5')}>Heading 5</GlassMenuItem>
          <GlassMenuItem onClick={() => controls.heading('h6')}>Heading 6</GlassMenuItem>
          <GlassMenuSeparator/>
          <GlassMenuItem onClick={controls.bulletList}>Bullet list</GlassMenuItem>
          <GlassMenuItem onClick={controls.numberList}>Numbered list</GlassMenuItem>
          <GlassMenuItem onClick={controls.checkList}>Checklist</GlassMenuItem>
          <GlassMenuItem onClick={controls.blockquote}>Quote</GlassMenuItem>
          <GlassMenuItem onClick={controls.codeblock}>Code block</GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
      <GlassToolbarButton size="icon" aria-label="Bold" aria-pressed={controls.isBold} onMouseDown={retainSelection} onClick={controls.bold}><IconBold/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Italic" aria-pressed={controls.isItalic} onMouseDown={retainSelection} onClick={controls.italic}><IconItalic/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Underline" aria-pressed={controls.isUnderline} onMouseDown={retainSelection} onClick={controls.underline}><IconUnderline/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Strikethrough" aria-pressed={controls.isStrikethrough} onMouseDown={retainSelection} onClick={controls.strikethrough}><IconStrike/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Inline code" aria-pressed={controls.isCode} onMouseDown={retainSelection} onClick={controls.code}><IconCode/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Link" onMouseDown={retainSelection} onClick={controls.insertLink}><IconLink/></GlassToolbarButton>
      <GlassMenu>
        <GlassToolbarButton size="icon" aria-label="Insert block" onMouseDown={retainSelection} render={<GlassMenuTrigger/>}><IconPlus/></GlassToolbarButton>
        <GlassMenuContent className="workspace-menu document-format-menu ui-frost" align="end" material="regular" appearance={appearance} morph="detach">
          <GlassMenuItem onClick={controls.table}>Table</GlassMenuItem>
          <GlassMenuItem onClick={controls.divider}>Divider</GlassMenuItem>
          <GlassMenuItem onClick={controls.checkList}>Checklist</GlassMenuItem>
          <GlassMenuItem onClick={controls.codeblock}>Code block</GlassMenuItem>
        </GlassMenuContent>
      </GlassMenu>
      <GlassToolbarButton size="icon" aria-label="Undo" disabled={!controls.canUndo} onMouseDown={retainSelection} onClick={controls.undo}><HugeiconsIcon icon={Undo02Icon} size={16}/></GlassToolbarButton>
      <GlassToolbarButton size="icon" aria-label="Redo" disabled={!controls.canRedo} onMouseDown={retainSelection} onClick={controls.redo}><HugeiconsIcon icon={Redo02Icon} size={16}/></GlassToolbarButton>
    </GlassToolbar>
  );
}
