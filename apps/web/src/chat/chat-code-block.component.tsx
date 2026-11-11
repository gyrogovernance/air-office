import { isValidElement, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { defaultComponents } from 'streamdown';
import { useChatRenderContext } from './chat-render-context.composition';
import { ChatDiffView } from './chat-diff.component';
import { ChatStructuredOutput } from './chat-structured-output.component';
import { fenceLanguage, hastText, type HastNode, type JobSubmission } from './chat-rendering.policy';

type CodeBlockProps = ComponentPropsWithoutRef<'code'> & { node?: unknown; 'data-block'?: boolean };

const DefaultCode = defaultComponents.code;

const DIFF_LANGUAGES = new Set(['diff', 'udiff', 'patch']);
const JSON_LANGUAGES = new Set(['json', 'jsonc']);

function flattenChildren(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map((child) => flattenChildren(child)).join('');
  if (isValidElement<{ children?: ReactNode }>(children)) return flattenChildren(children.props.children);
  return '';
}

function readFenceText(props: CodeBlockProps): string {
  return flattenChildren(props.children) || hastText(props.node as HastNode | undefined);
}

function delegateToDefault(props: CodeBlockProps): ReactNode {
  const { node: _hastNode, ...rest } = props;
  return <DefaultCode {...rest}/>;
}

type CopyState = 'idle' | 'copied' | 'failed';

function CopyControl(props: { code: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };
  const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy';
  return <span
    className="markdown-code-block-copy"
    role="button"
    tabIndex={0}
    data-state={state}
    aria-label={state === 'copied' ? 'Code copied' : 'Copy code'}
    onClick={() => void copy()}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void copy(); } }}
  >{label}</span>;
}

type RunState = 'idle' | 'running' | 'submitted' | 'unavailable' | 'failed';

function RunToJobControl(props: { code: string; language: string; submit: (code: string, language: string) => Promise<JobSubmission> }) {
  const [state, setState] = useState<RunState>('idle');
  const [reason, setReason] = useState('');
  const run = async () => {
    setState('running');
    try {
      const result = await props.submit(props.code, props.language);
      if (result.status === 'submitted') setState('submitted');
      else if (result.status === 'unavailable') setState('unavailable');
      else {
        setReason(result.reason);
        setState('failed');
      }
    } catch (error) {
      setReason(error instanceof Error ? error.message : 'The job runner could not be reached.');
      setState('failed');
    }
  };
  const label = state === 'running' ? 'Starting job'
    : state === 'submitted' ? 'Job queued'
    : state === 'unavailable' ? 'No job runner'
    : state === 'failed' ? 'Run failed'
    : 'Run to job';
  const title = state === 'failed' ? reason
    : state === 'unavailable' ? 'This service does not accept code jobs'
    : state === 'submitted' ? 'The job runner accepted this code'
    : 'Send this code to the job runner';
  const disabled = state === 'running' || state === 'submitted' || state === 'unavailable';
  return <span
    className="markdown-code-block-copy"
    role="button"
    tabIndex={disabled ? -1 : 0}
    data-state={state}
    aria-label={label}
    aria-disabled={disabled || undefined}
    title={title}
    onClick={() => { if (!disabled) void run(); }}
    onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); void run(); } }}
  >{label}</span>;
}

function FencedCode(props: CodeBlockProps & { language: string | null }) {
  const { submitCodeJob } = useChatRenderContext();
  const code = readFenceText(props);
  const label = props.language ?? 'text';
  let body: ReactNode;
  if (props.language !== null && DIFF_LANGUAGES.has(props.language)) body = <ChatDiffView code={code}/>;
  else if (props.language !== null && JSON_LANGUAGES.has(props.language)) body = <ChatStructuredOutput code={code}/>;
  else if (props.language === null) body = <pre><code>{code}</code></pre>;
  else body = <DefaultCode className={props.className} node={props.node as never} data-block={props['data-block'] ?? true} {...{ children: props.children }}/>;
  return <div className="markdown-code-block" data-language={label}>
    <div className="markdown-code-block-bar">
      <span>{label}</span>
      <span className="markdown-code-block-actions">
        <CopyControl code={code}/>
        {submitCodeJob ? <RunToJobControl code={code} language={label} submit={submitCodeJob}/> : null}
      </span>
    </div>
    <div className="markdown-code-block-content">{body}</div>
  </div>;
}

/**
 * Code fence renderer for chat. Uses the shared Guides markdown-code-block shell
 * so chat and Guides share one visual source of truth; chat only adds run-to-job
 * plus dedicated diff and JSON bodies.
 */
export function ChatCodeBlock(props: CodeBlockProps) {
  const language = fenceLanguage(props.className);
  const isFence = props['data-block'] !== undefined || language !== null;
  if (!isFence || language === 'mermaid') return delegateToDefault(props);
  return <FencedCode {...props} language={language}/>;
}
