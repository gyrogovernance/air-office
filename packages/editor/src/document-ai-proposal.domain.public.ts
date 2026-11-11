import { CAN_UNDO_COMMAND, type EditorState, type LexicalEditor } from 'lexical';
import type { RichDocument } from './rich-document.domain.public';
import { nativeBodyContentKey } from './rich-document-native-bridge.domain.public';

type ProposalEditorHistory = {
  current: { editor: LexicalEditor; editorState: EditorState } | null;
  undoStack: Array<{ editor: LexicalEditor; editorState: EditorState }>;
  redoStack: Array<{ editor: LexicalEditor; editorState: EditorState }>;
};

type ProposalEditor = {
  getDocument(type: string): unknown;
  getLexicalEditor(): LexicalEditor | null;
  getHistoryState?: () => ProposalEditorHistory;
  setDocument(type: string, content: string, options?: Record<string, unknown>): void;
};

export type DocumentAIProposalScope = 'cursor' | 'selection' | 'section' | 'document';

export type DocumentAIProposalStatus = 'pending' | 'reviewing' | 'applied' | 'rejected' | 'stale';

/**
 * A document edit proposal against a native Lobe body.
 * Session node ids are advisory only; staleness is decided by content hash.
 */
export type DocumentAIProposal = {
  id: string;
  documentId: string;
  contentHash: string;
  scope: DocumentAIProposalScope;
  /** Session-scoped Lobe node ids captured when the proposal was created; may not survive reload. */
  targetNodeIds: string[];
  beforeText: string;
  afterText: string;
  /** Markdown form of the proposed change; applied via the mounted editor. */
  proposedMarkdown: string;
  createdAt: string;
  status: DocumentAIProposalStatus;
};

export function createContentHash(body: unknown): string {
  return nativeBodyContentKey(body);
}

export function createDocumentAIProposal(params: {
  id?: string;
  document: RichDocument;
  scope: DocumentAIProposalScope;
  targetNodeIds?: string[];
  beforeText: string;
  afterText: string;
  proposedMarkdown: string;
}): DocumentAIProposal {
  return {
    id: params.id ?? crypto.randomUUID(),
    documentId: params.document.id,
    contentHash: createContentHash(params.document.body),
    scope: params.scope,
    targetNodeIds: params.targetNodeIds ?? [],
    beforeText: params.beforeText,
    afterText: params.afterText,
    proposedMarkdown: params.proposedMarkdown,
    createdAt: new Date().toISOString(),
    status: 'reviewing'
  };
}

export function isProposalStale(proposal: DocumentAIProposal, currentDocument: RichDocument): boolean {
  if (proposal.documentId !== currentDocument.id) return true;
  return proposal.contentHash !== createContentHash(currentDocument.body);
}

/**
 * Applies a proposal by splicing its markdown into the mounted editor's markdown document.
 */
export function proposalDocumentMarkdown(current: string, proposal: DocumentAIProposal): string {
  const currentMarkdown = current.replace(/\u200b/g, '');
  if (proposal.status !== 'reviewing') throw new Error('Only a reviewing proposal can be applied.');

  const proposalMarkdown = proposal.proposedMarkdown;
  let newMarkdown: string;

  if (proposal.scope === 'document') {
    newMarkdown = proposalMarkdown;
  } else if (proposal.scope === 'selection') {
    if (!proposal.beforeText) throw new Error('A selection proposal requires its original text.');
    const firstMatch = currentMarkdown.indexOf(proposal.beforeText);
    if (firstMatch < 0) throw new Error('The selected text is no longer present.');
    if (currentMarkdown.indexOf(proposal.beforeText, firstMatch + 1) >= 0) throw new Error('The selected text appears more than once; select a larger unique passage.');
    newMarkdown = currentMarkdown.slice(0, firstMatch) + proposalMarkdown + currentMarkdown.slice(firstMatch + proposal.beforeText.length);
  } else if (proposal.beforeText && currentMarkdown.includes(proposal.beforeText)) {
    if (currentMarkdown.indexOf(proposal.beforeText) !== currentMarkdown.lastIndexOf(proposal.beforeText)) throw new Error('The proposal anchor appears more than once.');
    const idx = currentMarkdown.indexOf(proposal.beforeText) + proposal.beforeText.length;
    newMarkdown = currentMarkdown.slice(0, idx) + '\n\n' + proposalMarkdown + currentMarkdown.slice(idx);
  } else if (proposal.afterText && currentMarkdown.includes(proposal.afterText)) {
    if (currentMarkdown.indexOf(proposal.afterText) !== currentMarkdown.lastIndexOf(proposal.afterText)) throw new Error('The proposal anchor appears more than once.');
    const idx = currentMarkdown.indexOf(proposal.afterText);
    newMarkdown = currentMarkdown.slice(0, idx) + proposalMarkdown + '\n\n' + currentMarkdown.slice(idx);
  } else {
    throw new Error('The proposal target is no longer present.');
  }
  return newMarkdown;
}

export function applyProposalToEditor(
  editor: ProposalEditor | null,
  proposal: DocumentAIProposal
): void {
  if (!editor) throw new Error('Editor instance is required to apply proposal.');
  const current = editor.getDocument('markdown');
  if (typeof current !== 'string') throw new Error('The editor did not return Markdown content.');
  const newMarkdown = proposalDocumentMarkdown(current, proposal);

  // Preserve prior editor state on the undo stack so Accept remains undoable.
  // Lobe's setDocument clears history unless keepHistory is set, and setEditorState
  // itself does not push an undo entry.
  const history = editor.getHistoryState?.() ?? null;
  const lexical = editor.getLexicalEditor();
  const previousState = lexical?.getEditorState() ?? null;
  editor.setDocument('markdown', newMarkdown, { keepHistory: true });
  if (history && lexical && previousState) {
    history.undoStack.push({ editor: lexical, editorState: previousState });
    history.redoStack = [];
    history.current = { editor: lexical, editorState: lexical.getEditorState() };
    lexical.dispatchCommand(CAN_UNDO_COMMAND, true);
  }
}
