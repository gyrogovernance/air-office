import { Chip, Surface } from '@heroui/react';
import { toolActivityLabel, toolDisplayName } from '../tools/tool-presentation.policy';
import { isFileMutationTool, toolWorkspacePath, workspaceFileLabel } from './workspace-file-link.policy';
import { WebSearchActivity } from './web-search-activity.component';

function looksLikeMachineText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<') || /<!doctype|<\/?[a-z][\s\S]*>/i.test(trimmed.slice(0, 240));
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() && !looksLikeMachineText(value)) return value.trim();
  }
  return '';
}

/** One short human line for the summary; never JSON, HTML, or parameter names. */
export function toolPreview(args: unknown, result: unknown): string {
  if (args && typeof args === 'object') {
    const fromArgs = firstString(args as Record<string, unknown>, ['query', 'q', 'pattern', 'glob', 'url', 'path', 'fileName', 'title', 'prompt', 'question']);
    if (fromArgs) return fromArgs.length > 120 ? `${fromArgs.slice(0, 117).trimEnd()}…` : fromArgs;
  }
  if (typeof args === 'string' && args.trim() && args.trim() !== '{}') {
    try {
      const parsed: unknown = JSON.parse(args);
      if (parsed && typeof parsed === 'object') return toolPreview(parsed, result);
    } catch { /* argsText that is not JSON stays out of the preview */ }
  }
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const fromResult = firstString(record, ['title', 'name', 'summary', 'message']);
    if (fromResult) return fromResult.length > 120 ? `${fromResult.slice(0, 117).trimEnd()}…` : fromResult;
    if (typeof record.count === 'number') return `${record.count} items`;
    if (Array.isArray(record.notes)) return `${record.notes.length} notes`;
    if (Array.isArray(record.results)) return `${record.results.length} results`;
    if (Array.isArray(record.files)) return `${record.files.length} files`;
  }
  return '';
}

export interface ChatToolCallProps {
  toolName: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  /** When false, the call has settled even if `result` is empty. */
  isPreliminary?: boolean;
}

/** Live until the host marks the call settled or supplies a final result. */
export function toolCallRunning(props: Pick<ChatToolCallProps, 'result' | 'isError' | 'isPreliminary'>): boolean {
  if (props.isError || props.isPreliminary === false) return false;
  return props.isPreliminary === true || props.result === undefined;
}

/**
 * One quiet row for a tool step. Successful create/edit/write calls leave the
 * thread (their paths land as reply-footer links); other successful work is a
 * label plus a short preview. Failures stay a muted chip. Raw payloads never
 * enter the thread. Path mutate tools use Ask-first approval, not a separate
 * propose-edit review surface.
 */
export function ChatToolCall(props: ChatToolCallProps) {
  const running = toolCallRunning(props);
  const status = props.isError ? 'error' : running ? 'running' : 'success';
  const webTool = props.toolName === 'web_search' || props.toolName === 'web_fetch' || props.toolName === 'fetch_url';
  if (webTool) return <WebSearchActivity {...props}/>;
  // Finished file mutations surface as footer links on the assistant message.
  if (isFileMutationTool(props.toolName) && !running && !props.isError) return null;
  const filePath = toolWorkspacePath(props.toolName, props.args ?? props.argsText, props.result);
  const preview = filePath
    ? workspaceFileLabel(filePath)
    : toolPreview(props.args ?? props.argsText, props.result);
  // Errors keep the catalog name ("Find files"); past-tense done labels imply success.
  const label = props.isError ? toolDisplayName(props.toolName) : toolActivityLabel(props.toolName, running);
  return <Surface className="chat-tool-call flex flex-col gap-1 rounded-xl px-2.5 py-1.5" variant="secondary" data-status={status}>
    <div className="chat-tool-summary flex min-h-7 items-center gap-2">
      <span className="chat-tool-name shrink-0 text-xs font-medium text-muted">{label}</span>
      {preview ? <span className="chat-tool-preview min-w-0 text-xs text-muted" title={filePath ?? preview}>{preview}</span> : null}
      {running ? <Chip className="chat-tool-status ms-auto" size="sm" color="accent" variant="soft">Working…</Chip> : null}
      {props.isError ? <Chip className="chat-tool-status ms-auto" size="sm" color="danger" variant="soft">Failed</Chip> : null}
    </div>
  </Surface>;
}
