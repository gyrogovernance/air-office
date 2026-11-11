import { useMemo } from 'react';
import { LexicalDiff, type LexicalDiffBlockRenderContext } from '@lobehub/editor/renderer';
import type { SerializedEditorState } from 'lexical';
import { proposalDocumentMarkdown, type DocumentAIProposal } from './document-ai-proposal.domain.public';
import { markdownToNativeBody } from './rich-document.domain.public';

export type DocumentAIProposalViewProps = {
  proposal: DocumentAIProposal;
  oldValue: SerializedEditorState;
  oldMarkdown: string;
  isStale: boolean;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
};

// Imported node identities are newly allocated and are not document changes.
function withoutNodeIds(value: SerializedEditorState): SerializedEditorState {
  return JSON.parse(JSON.stringify(value, function (this: { type?: unknown }, key, item: unknown) {
    return key === 'id' && typeof this.type === 'string' ? undefined : item;
  })) as SerializedEditorState;
}

function renderInlineBlock(context: LexicalDiffBlockRenderContext) {
  const { row } = context;
  return {
    old: row.oldCell && row.kind !== 'equal'
      ? <div data-proposal-change="removed"><span className="proposal-change-label">Removed</span>{context.renderDefaultOld()}</div>
      : <span data-proposal-empty="true" />,
    new: row.newCell
      ? <div data-proposal-change={row.kind === 'equal' ? 'unchanged' : 'added'}>{row.kind !== 'equal' && <span className="proposal-change-label">Added</span>}{context.renderDefaultNew()}</div>
      : <span data-proposal-empty="true" />
  };
}

export function DocumentAIProposalView({ proposal, oldValue, oldMarkdown, isStale, onAccept, onReject, onCancel }: DocumentAIProposalViewProps) {
  const preview = useMemo(() => {
    try {
      /* Build both sides from the same markdown snapshot so markdown-seeded
         editors (empty JSON shell + live markdown) still preview correctly. */
      const baselineMarkdown = oldMarkdown || '';
      const old = withoutNodeIds((baselineMarkdown.trim()
        ? markdownToNativeBody(baselineMarkdown)
        : oldValue) as SerializedEditorState);
      const next = withoutNodeIds(markdownToNativeBody(proposalDocumentMarkdown(baselineMarkdown, proposal)) as SerializedEditorState);
      return { old, next, error: null };
    } catch {
      return { old: oldValue, next: oldValue, error: 'This edit can no longer be matched to the document. Select the passage again to rewrite it.' };
    }
  }, [oldValue, oldMarkdown, proposal]);

  return <section className="air-office-proposal-inline" aria-label="Document change review">
    <div className="proposal-inline-toolbar">
      <span>{preview.error || isStale ? 'Proposal unavailable' : 'Review changes'}</span>
      <div className="proposal-inline-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>{preview.error || isStale ? 'Back to document' : 'Cancel'}</button>
        {!preview.error && !isStale && <button type="button" className="secondary-button" onClick={onReject}>Reject</button>}
        {!preview.error && !isStale && <button type="button" className="primary-button" onClick={onAccept}>Accept Edit</button>}
      </div>
    </div>
    {(isStale || preview.error) && <div className="proposal-stale-badge" role="alert">{preview.error ?? 'The document changed after this proposal was created. Select the passage again to rewrite it.'}</div>}
    {!preview.error && !isStale && <LexicalDiff className="proposal-inline-diff" oldValue={preview.old} newValue={preview.next} appearance="borderless" renderBlockDiff={renderInlineBlock} />}
  </section>;
}
