export { LobeDocumentEditor, type LobeDocumentEditorProps, type LobeDocumentEditorControls } from './rich-document-editor.component';
export { DocumentAIProposalView, type DocumentAIProposalViewProps } from './document-ai-proposal-view.component';
export {
  createDocumentAIProposal,
  isProposalStale,
  applyProposalToEditor,
  type DocumentAIProposal,
  type DocumentAIProposalScope,
  type DocumentAIProposalStatus
} from './document-ai-proposal.domain.public';
