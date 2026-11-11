import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button, TextArea } from '@heroui/react';
import { jsonPropertyRows, parseStructuredOutput } from './chat-rendering.policy';
import { IconCopy } from '../app/ui-icons.component';

/**
 * Structured JSON rendering for chat code fences (CHAT-103, CHAT-155).
 *
 * Parses the fence into an indented property list. Unparsable content and the
 * raw toggle show the original text unchanged. Edit switches the raw view into
 * a textarea; a valid edit can be applied (the fence shows the edited JSON and
 * the tree re-parses) and copied, while an invalid edit stays local with a
 * visible reason.
 */
export function ChatStructuredOutput(props: { code: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const current = applied ?? props.code;
  const parsed = useMemo(() => parseStructuredOutput(current), [current]);
  const rows = useMemo(() => (parsed.ok ? jsonPropertyRows(parsed.value) : []), [parsed]);
  const raw = editing || showRaw || !parsed.ok;

  useEffect(() => () => setCopied(false), []);

  const startEdit = () => { setDraft(current); setEditing(true); };
  const cancelEdit = () => { setDraft(null); setEditing(false); };
  const applyEdit = () => {
    const text = draft ?? '';
    const check = parseStructuredOutput(text);
    if (!check.ok) return;
    setApplied(text);
    setDraft(null);
    setEditing(false);
    setShowRaw(false);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(current); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };

  return <div className="chat-json" data-mode={raw ? 'raw' : 'structured'}>
    <div className="chat-json-head">
      <span>{editing ? 'Editing JSON' : raw ? 'Raw JSON' : `Structured output · ${rows.length} entries`}</span>
      <div className="markdown-code-block-actions">
        {parsed.ok && !editing && <Button variant="tertiary" size="sm" aria-label={showRaw ? 'Show structured view' : 'Show raw JSON'}
          aria-pressed={showRaw} onPress={() => setShowRaw((value) => !value)}>
          {showRaw ? 'Tree' : 'Raw'}
        </Button>}
        {parsed.ok && !editing && <Button variant="tertiary" size="sm" aria-label="Edit JSON" onPress={startEdit}>Edit</Button>}
        {editing && <>
          <Button variant="tertiary" size="sm" aria-label="Apply JSON edit" isDisabled={!parseStructuredOutput(draft ?? '').ok} onPress={applyEdit}>Apply</Button>
          <Button variant="tertiary" size="sm" aria-label="Cancel JSON edit" onPress={cancelEdit}>Cancel</Button>
        </>}
        {!editing && <Button variant="tertiary" size="sm" aria-label={copied ? 'JSON copied' : 'Copy JSON'} onPress={() => void copy()}>
          <IconCopy aria-hidden="true"/><span>{copied ? 'Copied' : 'Copy'}</span>
        </Button>}
      </div>
    </div>
    {editing
      ? <TextArea className="chat-json-edit" aria-label="JSON editor" spellCheck={false} value={draft ?? ''} onChange={(event) => setDraft(event.target.value)}/>
      : raw
        ? <pre className="chat-json-raw">{current}</pre>
        : <div className="chat-json-tree">{rows.map((row, index) =>
            <div className="chat-json-row" key={index} data-kind={row.kind}
              style={{ '--depth': row.depth } as CSSProperties}>
              <span className="chat-json-label">{row.label}</span>
              <span className="chat-json-value">{row.display}</span>
            </div>)}
          </div>}
  </div>;
}
