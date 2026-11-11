import { Button } from '@heroui/react';
import type { NoteDriftState } from '../app/note-projection-drift.hook';

type Props = {
  drift: NoteDriftState | null;
  editorDirty: boolean;
  busy?: boolean;
  error?: string | null;
  onApply: () => void;
  onDiscard: () => void;
  onKeepEditor: () => void;
  onKeepMarkdown: () => void;
  onCancel: () => void;
};

/**
 * Surfaces markdown projection drift and dual-dirty (editor + markdown) choices.
 * Apply/Discard for md-only drift; Keep editor / Keep markdown / Cancel when both sides diverge.
 */
export function NoteProjectionConflict(props: Props) {
  if (!props.drift || props.drift.kind === 'ok') return null;
  const dual = props.editorDirty && props.drift.kind === 'markdown-drift';
  const title = dual
    ? 'This note’s editor and Markdown both changed'
    : props.drift.kind === 'markdown-drift'
      ? 'Markdown projection drifted from the saved note'
      : props.drift.kind === 'missing-markdown'
        ? 'Markdown projection is missing'
        : props.drift.kind === 'missing-json'
          ? 'Note JSON is missing'
          : 'Note JSON could not be read';
  const detail = dual
    ? 'Choose which side to keep before saving or applying. Cancel leaves both drafts as they are.'
    : props.drift.kind === 'markdown-drift'
      ? 'Apply converts Markdown into the note body. Discard regenerates Markdown from the saved note.'
      : props.drift.kind === 'invalid-json'
        ? props.drift.message
        : 'Fix the vault files or regenerate the projection before continuing.';
  return (
    <div className="document-conflict" role="alert">
      <span>
        <strong>{title}</strong>
        {' '}
        {detail}
        {props.error ? ` ${props.error}` : ''}
      </span>
      <span className="document-conflict-actions">
        {dual ? (
          <>
            <Button size="sm" variant="secondary" isDisabled={props.busy} onPress={props.onKeepEditor}>Keep editor</Button>
            <Button size="sm" variant="secondary" isDisabled={props.busy} onPress={props.onKeepMarkdown}>Keep markdown</Button>
            <Button size="sm" variant="ghost" isDisabled={props.busy} onPress={props.onCancel}>Cancel</Button>
          </>
        ) : props.drift.kind === 'markdown-drift' || props.drift.kind === 'missing-markdown' ? (
          <>
            <Button size="sm" variant="secondary" isDisabled={props.busy || props.editorDirty} onPress={props.onApply}>Apply markdown</Button>
            <Button size="sm" variant="secondary" isDisabled={props.busy} onPress={props.onDiscard}>Discard markdown</Button>
          </>
        ) : null}
      </span>
    </div>
  );
}
