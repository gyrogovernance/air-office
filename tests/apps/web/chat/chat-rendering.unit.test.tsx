import { afterAll, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ChatRenderContextValue } from '../../../../apps/web/src/chat/chat-render-context.composition';
import type { JobSubmitClient } from '../../../../apps/web/src/chat/chat-rendering.policy';
import '../../../support/web-dom.adapter';


const { act, StrictMode, createElement } = await import('react');
const { createRoot } = await import('react-dom/client');
const policy = await import('../../../../apps/web/src/chat/chat-rendering.policy');
const { ChatCodeBlock } = await import('../../../../apps/web/src/chat/chat-code-block.component');
const { ChatDiffView } = await import('../../../../apps/web/src/chat/chat-diff.component');
const { ChatStructuredOutput } = await import('../../../../apps/web/src/chat/chat-structured-output.component');
const { ChatCitationLink } = await import('../../../../apps/web/src/chat/chat-citation.component');
const { ChatTable } = await import('../../../../apps/web/src/chat/chat-table.component');
const { ChatToolCall } = await import('../../../../apps/web/src/chat/chat-tool-call.component');
const { ChatRenderContext } = await import('../../../../apps/web/src/chat/chat-render-context.composition');
const { CHAT_MESSAGE_COMPONENTS } = await import('../../../../apps/web/src/chat/chat-rail.component');
const { StreamdownTextPrimitive } = await import('@assistant-ui/react-streamdown');
const { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } = await import('@assistant-ui/react');

const mounts: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = [];
afterAll(async () => {
  for (const mount of mounts) { mount.root.unmount(); mount.host.remove(); }
  // Let any scheduled React work finish while the DOM globals still exist.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

async function renderIn(element: ReactElement, wrap?: (child: ReactElement) => ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounts.push({ root, host });
  await act(async () => { root.render(createElement(StrictMode, null, wrap ? wrap(element) : element)); });
  return { host };
}

test('sanitizeCsvCell prefixes cells a spreadsheet would treat as formulas', () => {
  expect(policy.sanitizeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  expect(policy.sanitizeCsvCell('+1')).toBe("'+1");
  expect(policy.sanitizeCsvCell('-2')).toBe("'-2");
  expect(policy.sanitizeCsvCell('@mention')).toBe("'@mention");
  expect(policy.sanitizeCsvCell('plain')).toBe('plain');
  expect(policy.sanitizeCsvCell('')).toBe('');
  expect(policy.sanitizeCsvCell('a=b')).toBe('a=b');
});

test('rowsToCsv sanitizes formulas, quotes special cells and joins rows', () => {
  const csv = policy.rowsToCsv(['name', 'formula'], [['a,b', '=1+1'], ['say "hi"', 'plain']]);
  expect(csv).toBe('name,formula\r\n"a,b",\'=1+1\r\n"say ""hi""",plain');
});

test('tableRowsFromNode reads the head and body of a markdown table', () => {
  const text = (value: string) => ({ type: 'text', value });
  const cell = (tagName: string, value: string) => ({ type: 'element', tagName, children: [text(value)] });
  const row = (tagName: string, values: string[]) => ({ type: 'element', tagName: 'tr', children: values.map((value) => cell(tagName, value)) });
  const node = { type: 'element', tagName: 'table', children: [
    { type: 'element', tagName: 'thead', children: [row('th', ['Name', 'Score'])] },
    { type: 'element', tagName: 'tbody', children: [row('td', ['alpha', '1'])] }
  ] };
  expect(policy.tableRowsFromNode(node)).toEqual({ headers: ['Name', 'Score'], rows: [['alpha', '1']] });
  expect(policy.tableRowsFromNode({ type: 'element', tagName: 'div', children: [] })).toBeNull();
  expect(policy.tableRowsFromNode(undefined)).toBeNull();
});

test('citationVersionId recognizes the citation link shapes', () => {
  expect(policy.citationVersionId('air-office://citation/v-9')).toBe('v-9');
  expect(policy.citationVersionId('air-office:citation/v-9')).toBe('v-9');
  expect(policy.citationVersionId('https://local/doc#cite-v9')).toBe('v9');
  expect(policy.citationVersionId('https://local/search?versionId=v9')).toBe('v9');
  expect(policy.citationVersionId('https://local/api/versions/v9')).toBe('v9');
  expect(policy.citationVersionId('https://example.com/page')).toBeNull();
  expect(policy.citationVersionId(null)).toBeNull();
});

const VERSIONS = [
  { id: 'v1', documentId: 'doc-1', observedAt: '2026-01-01' },
  { id: 'v2', documentId: 'doc-1', observedAt: '2026-02-01' },
  { id: 'v9', documentId: 'doc-9', observedAt: '2026-03-01' }
];

test('citationState marks a citation stale when a newer version of the document exists', () => {
  expect(policy.citationState('air-office://citation/v1', { versions: VERSIONS })).toBe('stale');
  expect(policy.citationState('air-office://citation/v2', { versions: VERSIONS })).toBe('unverified');
  expect(policy.citationState('air-office://citation/v9', { versions: VERSIONS, results: [{ versionId: 'v9', resolved: true }] })).toBe('verified');
  expect(policy.citationState('air-office://citation/gone', { versions: VERSIONS })).toBe('unverified');
  expect(policy.citationState('air-office://citation/gone', { versions: VERSIONS, results: [{ versionId: 'gone', resolved: true }] })).toBe('verified');
  expect(policy.citationState('air-office://citation/gone', { versions: VERSIONS, results: [{ versionId: 'gone', resolved: false }] })).toBe('unverified');
  expect(policy.citationState('https://example.com', { versions: VERSIONS })).toBe('link');
});

test('parseStructuredOutput accepts valid JSON and falls back on anything else', () => {
  expect(policy.parseStructuredOutput('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  expect(policy.parseStructuredOutput('  [1,2]  ')).toEqual({ ok: true, value: [1, 2] });
  expect(policy.parseStructuredOutput('{broken')).toEqual({ ok: false });
  expect(policy.parseStructuredOutput('')).toEqual({ ok: false });
  expect(policy.parseStructuredOutput('not json')).toEqual({ ok: false });
});

test('jsonPropertyRows flattens nested values into an indented property list', () => {
  const rows = policy.jsonPropertyRows({ status: 'ok', stats: { count: 3 }, items: ['a'], missing: null, flag: true });
  const byPath = new Map(rows.map((row) => [row.path.join('.'), row]));
  expect(byPath.get('status')).toMatchObject({ kind: 'string', depth: 1, display: '"ok"' });
  expect(byPath.get('stats')).toMatchObject({ kind: 'object', display: '{ 1 }' });
  expect(byPath.get('stats.count')).toMatchObject({ kind: 'number', depth: 2, display: '3' });
  expect(byPath.get('items')).toMatchObject({ kind: 'array', display: '[ 1 ]' });
  expect(byPath.get('items.0')).toMatchObject({ kind: 'string', display: '"a"' });
  expect(byPath.get('missing')).toMatchObject({ kind: 'null', display: 'null' });
  expect(byPath.get('flag')).toMatchObject({ kind: 'boolean', display: 'true' });
});

const DIFF = ['diff --git a/one.ts b/one.ts', '--- a/one.ts', '+++ b/one.ts', '@@ -1,3 +1,3 @@', ' const keep = 0;', '-const old = 1;', '-const drop = 3;', '+const next = 2;', '+const added = 4;', ' const tail = 9;'].join('\n');

test('parseUnifiedDiff classifies lines and numbers both sides', () => {
  const lines = policy.parseUnifiedDiff(DIFF);
  expect(lines.map((line) => line.kind)).toEqual(['meta', 'meta', 'meta', 'hunk', 'context', 'del', 'del', 'add', 'add', 'context']);
  const numbers = lines.filter((line) => line.oldNo !== null || line.newNo !== null);
  expect(numbers.map((line) => [line.oldNo, line.newNo])).toEqual([[1, 1], [2, null], [3, null], [null, 2], [null, 3], [4, 4]]);
  expect(policy.diffStats(lines)).toEqual({ added: 2, removed: 2 });
});

test('pairDiffLines zips deletions and additions into aligned rows', () => {
  const pairs = policy.pairDiffLines(policy.parseUnifiedDiff(DIFF));
  expect(pairs[0]).toMatchObject({ kind: 'meta' });
  const changes = pairs.filter((pair) => pair.kind === 'change');
  expect(changes).toHaveLength(2);
  expect(changes[0]).toEqual({ kind: 'change', left: { no: 2, text: '-const old = 1;' }, right: { no: 2, text: '+const next = 2;' } });
  expect(changes[1]).toEqual({ kind: 'change', left: { no: 3, text: '-const drop = 3;' }, right: { no: 3, text: '+const added = 4;' } });
  const contexts = pairs.filter((pair) => pair.kind === 'context');
  expect(contexts).toHaveLength(2);
  expect(contexts[0]?.left?.no).toBe(1);
  expect(contexts[1]?.right?.no).toBe(4);
});

test('pairDiffLines leaves an empty cell when one side of a change is longer', () => {
  const lines = policy.parseUnifiedDiff(['@@ -1,1 +1,2 @@', '-gone', '+first', '+second'].join('\n'));
  const changes = policy.pairDiffLines(lines).filter((pair) => pair.kind === 'change');
  expect(changes).toHaveLength(2);
  expect(changes[0]).toEqual({ kind: 'change', left: { no: 1, text: '-gone' }, right: { no: 1, text: '+first' } });
  expect(changes[1]).toEqual({ kind: 'change', left: null, right: { no: 2, text: '+second' } });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('submitCodeToJobRunner reports the first endpoint that accepts the code', async () => {
  const calls: string[] = [];
  const client: JobSubmitClient = { request: async (path: string) => { calls.push(path); return jsonResponse({ jobId: 'job-7' }); } };
  const result = await policy.submitCodeToJobRunner(client, 'run()', 'python');
  expect(result).toEqual({ status: 'submitted', endpoint: '/api/v1/jobs/run', jobId: 'job-7' });
  expect(calls).toEqual(['/api/v1/jobs/run']);
});

test('submitCodeToJobRunner falls through endpoints that do not exist', async () => {
  const calls: string[] = [];
  const client: JobSubmitClient = { request: async (path: string) => {
    calls.push(path);
    return path === '/api/v1/jobs/run' ? jsonResponse({ error: 'Not found' }, 404) : jsonResponse({ job: { id: 'job-2' } });
  } };
  const result = await policy.submitCodeToJobRunner(client, 'run()', 'python');
  expect(result).toEqual({ status: 'submitted', endpoint: '/api/v1/jobs', jobId: 'job-2' });
  expect(calls).toEqual(['/api/v1/jobs/run', '/api/v1/jobs']);
});

test('submitCodeToJobRunner reports rejection and unavailability honestly', async () => {
  const rejected = await policy.submitCodeToJobRunner({ request: async () => jsonResponse({ error: 'Bad code' }, 400) }, 'x', 'js');
  expect(rejected).toEqual({ status: 'rejected', endpoint: '/api/v1/jobs/run', reason: 'Bad code' });
  const missing = await policy.submitCodeToJobRunner({ request: async () => jsonResponse({ error: 'Not found' }, 404) }, 'x', 'js');
  expect(missing).toEqual({ status: 'unavailable' });
  const offline = await policy.submitCodeToJobRunner({ request: async () => { throw new Error('offline'); } }, 'x', 'js');
  expect(offline).toEqual({ status: 'unavailable' });
  const bareStatus = await policy.submitCodeToJobRunner({ request: async () => new Response(null, { status: 503 }) }, 'x', 'js');
  expect(bareStatus).toEqual({ status: 'rejected', endpoint: '/api/v1/jobs/run', reason: 'The job runner responded with status 503.' });
});

test('previewValue collapses whitespace and truncates long payloads', () => {
  expect(policy.previewValue('  a \n b  ')).toBe('a b');
  expect(policy.previewValue({ a: 1 })).toBe('{"a":1}');
  expect(policy.previewValue(undefined)).toBe('');
  expect(policy.previewValue('x'.repeat(400)).length).toBe(162);
  expect(policy.previewValue('x'.repeat(400)).endsWith('...')).toBe(true);
});

test('formatValue pretty prints JSON payloads and leaves prose alone', () => {
  expect(policy.formatValue({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  expect(policy.formatValue('{"a":1}')).toBe('{\n  "a": 1\n}');
  expect(policy.formatValue('plain')).toBe('plain');
  expect(policy.formatValue(undefined)).toBe('');
});

test('an unlabeled fenced code block renders its text without a language highlighter', async () => {
  const { host } = await renderIn(<ChatCodeBlock data-block>{'plain sample\nsecond line'}</ChatCodeBlock>);
  expect(host.querySelector('pre code')?.textContent).toBe('plain sample\nsecond line');
});

test('a fenced code block carries the language label, copy and run-to-job actions', async () => {
  const submit = async () => ({ status: 'submitted' as const, endpoint: '/api/v1/jobs/run', jobId: 'job-1' });
  const value: ChatRenderContextValue = { submitCodeJob: submit };
  const { host } = await renderIn(<ChatCodeBlock className="language-typescript">{'const x = 1;'}</ChatCodeBlock>, (child) => <ChatRenderContext.Provider value={value}>{child}</ChatRenderContext.Provider>);
  const block = host.querySelector('.markdown-code-block');
  expect(block?.getAttribute('data-language')).toBe('typescript');
  expect(block?.querySelector('.markdown-code-block-bar')?.textContent).toContain('typescript');
  expect(block?.querySelector('.markdown-code-block-content')?.textContent).toContain('const x = 1;');
  expect(block?.querySelector('[aria-label="Copy code"]')).not.toBeNull();
  const run = block?.querySelector('[aria-label="Run to job"]') as HTMLElement | null;
  expect(run).not.toBeNull();
  await act(async () => { run?.click(); });
  expect(block?.querySelector('[aria-label="Job queued"]')).not.toBeNull();
});

test('a code block hides the run action when the service offers no job runner', async () => {
  const { host } = await renderIn(<ChatCodeBlock className="language-python">{'print(1)'}</ChatCodeBlock>);
  expect(host.querySelector('[aria-label="Run to job"]')).toBeNull();
  expect(host.querySelector('[aria-label="Copy code"]')).not.toBeNull();
});

test('copy on a code block reports its state through the control', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => undefined }, configurable: true });
  const { host } = await renderIn(<ChatCodeBlock className="language-js">{'copyme()'}</ChatCodeBlock>);
  const control = host.querySelector('[aria-label="Copy code"]') as HTMLElement;
  expect(control).not.toBeNull();
  await act(async () => { control.click(); });
  expect(host.querySelector('[aria-label="Code copied"]')?.getAttribute('data-state')).toBe('copied');
});

test('a diff fence renders the side-by-side view instead of plain code', async () => {
  const { host } = await renderIn(<ChatCodeBlock className="language-diff">{DIFF}</ChatCodeBlock>);
  expect(host.querySelector('.markdown-code-block-content .chat-diff')).not.toBeNull();
  expect(host.querySelector('.chat-diff')).not.toBeNull();
  expect(host.querySelector('.chat-diff-stats b[data-kind="add"]')?.textContent).toBe('+2');
  expect(host.querySelector('.chat-diff-stats b[data-kind="del"]')?.textContent).toBe('-2');
});

test('a json fence renders the structured view instead of plain code', async () => {
  const { host } = await renderIn(<ChatCodeBlock className="language-json">{'{"status":"ok"}'}</ChatCodeBlock>);
  expect(host.querySelector('.chat-json')).not.toBeNull();
  expect(host.querySelector('.chat-json')?.getAttribute('data-mode')).toBe('structured');
});

test('the diff view shows aligned cells with line numbers', async () => {
  const { host } = await renderIn(<ChatDiffView code={DIFF}/>);
  expect(host.querySelectorAll('.chat-diff-cell[data-side="del"]')).toHaveLength(2);
  expect(host.querySelectorAll('.chat-diff-cell[data-side="add"]')).toHaveLength(2);
  expect(host.querySelector('.chat-diff-meta code')?.textContent).toBe('diff --git a/one.ts b/one.ts');
  const firstChange = host.querySelector('.chat-diff-cell[data-side="del"] .chat-diff-no')?.textContent;
  expect(firstChange).toBe('2');
});

test('the structured view toggles between the tree and the raw JSON', async () => {
  const { host } = await renderIn(<ChatStructuredOutput code={'{"status":"ok","count":3}'}/>);
  const view = host.querySelector('.chat-json');
  expect(view?.getAttribute('data-mode')).toBe('structured');
  const labels = [...(view?.querySelectorAll('.chat-json-label') ?? [])].map((element) => element.textContent);
  expect(labels).toEqual(['value', 'status', 'count']);
  expect(view?.querySelectorAll('.chat-json-value')[1]?.textContent).toBe('"ok"');
  const toggle = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Show raw JSON')!;
  await act(async () => { toggle.click(); });
  expect(view?.getAttribute('data-mode')).toBe('raw');
  expect(view?.querySelector('.chat-json-raw')?.textContent).toBe('{"status":"ok","count":3}');
});

async function setControlledValue(area: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the structured view edits JSON in place and applies a valid revision (CHAT-155)', async () => {
  const { host } = await renderIn(<ChatStructuredOutput code={'{"status":"ok","count":3}'}/>);
  const view = host.querySelector('.chat-json');
  const edit = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Edit JSON')!;
  await act(async () => { edit.click(); });
  const area = host.querySelector<HTMLTextAreaElement>('.chat-json-edit');
  expect(area).not.toBeNull();
  await setControlledValue(area!, '{"status":"ok","count":4}');
  const apply = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Apply JSON edit')!;
  expect(apply.disabled).toBe(false);
  await act(async () => { apply.click(); });
  expect(view?.getAttribute('data-mode')).toBe('structured');
  expect(view?.querySelectorAll('.chat-json-value')[2]?.textContent).toBe('4');
  expect(view?.querySelector('.chat-json-raw')).toBeNull();
  const rawToggle = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Show raw JSON')!;
  await act(async () => { rawToggle.click(); });
  expect(view?.querySelector('.chat-json-raw')?.textContent).toBe('{"status":"ok","count":4}');
});

test('an invalid JSON edit cannot be applied and cancels back to the parsed view', async () => {
  const { host } = await renderIn(<ChatStructuredOutput code={'{"status":"ok"}'}/>);
  const view = host.querySelector('.chat-json');
  const edit = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Edit JSON')!;
  await act(async () => { edit.click(); });
  const area = host.querySelector<HTMLTextAreaElement>('.chat-json-edit');
  await setControlledValue(area!, '{"broken":');
  const apply = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Apply JSON edit')!;
  expect(apply.disabled).toBe(true);
  const cancel = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].find((button) => button.getAttribute('aria-label') === 'Cancel JSON edit')!;
  await act(async () => { cancel.click(); });
  expect(view?.getAttribute('data-mode')).toBe('structured');
  expect(view?.querySelector('.chat-json-raw')).toBeNull();
});

test('the structured view falls back to raw JSON when parsing fails', async () => {
  const { host } = await renderIn(<ChatStructuredOutput code={'{"broken":'}/>);
  const view = host.querySelector('.chat-json');
  expect(view?.getAttribute('data-mode')).toBe('raw');
  expect(view?.querySelector('.chat-json-raw')?.textContent).toBe('{"broken":');
  // No toggle, no edit, no copy: an unparsable fence only shows the original text.
  const labels = [...host.querySelectorAll<HTMLButtonElement>('.chat-json-head button')].map((button) => button.getAttribute('aria-label'));
  expect(labels.filter((label) => label !== 'Copy JSON')).toEqual([]);
});

test('a citation link carries a freshness chip and opens the knowledge source', async () => {
  const opened: string[] = [];
  const value: ChatRenderContextValue = { citation: { versions: VERSIONS }, openCitation: (versionId) => { opened.push(versionId); } };
  const { host } = await renderIn(
    <p>
      See <ChatCitationLink href="air-office://citation/v1">the report</ChatCitationLink>
      {' and '}
      <ChatCitationLink href="https://example.com/page">a plain link</ChatCitationLink>
    </p>,
    (child) => <ChatRenderContext.Provider value={value}>{child}</ChatRenderContext.Provider>
  );
  const stale = host.querySelector('a[data-citation-state="stale"]');
  expect(stale?.querySelector('.citation')?.textContent).toBe('stale');
  const plain = [...host.querySelectorAll('a')].find((anchor) => anchor.getAttribute('href') === 'https://example.com/page');
  expect(plain?.querySelector('.citation')).toBeNull();
  await act(async () => { (stale as HTMLAnchorElement).click(); });
  expect(opened).toEqual(['v1']);
});

test('a citation link stays a plain link when the knowledge context is empty', async () => {
  const { host } = await renderIn(<p><ChatCitationLink href="air-office://citation/v1">report</ChatCitationLink></p>);
  expect(host.querySelector('a[data-citation-state]')).toBeNull();
  expect(host.querySelector('a')?.textContent).toBe('report');
});

test('a table offers a CSV export that sanitizes formula cells', async () => {
  const created: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  Object.defineProperty(URL, 'createObjectURL', { value: (blob: Blob) => { created.push(blob); return 'blob:test'; }, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
  HTMLAnchorElement.prototype.click = function () { /* record only */ };
  try {
    const node = { type: 'element', tagName: 'table', children: [
      { type: 'element', tagName: 'thead', children: [{ type: 'element', tagName: 'tr', children: [{ type: 'element', tagName: 'th', children: [{ type: 'text', value: 'formula' }] }] }] },
      { type: 'element', tagName: 'tbody', children: [{ type: 'element', tagName: 'tr', children: [{ type: 'element', tagName: 'td', children: [{ type: 'text', value: '=1+1' }] }] }] }
    ] };
    const { host } = await renderIn(<ChatTable node={node}><tbody><tr><td>=1+1</td></tr></tbody></ChatTable>);
    expect(host.querySelector('.chat-table-meta')?.textContent).toBe('1 rows');
    const control = host.querySelector('[aria-label="Export table as CSV"]') as HTMLElement;
    await act(async () => { control.click(); });
    expect(created).toHaveLength(1);
    expect(await created[0]!.text()).toBe('formula\r\n\'=1+1');
    expect(host.querySelector('[aria-label="Export table as CSV"]')?.textContent).toBe('Exported CSV');
  } finally {
    Object.defineProperty(URL, 'createObjectURL', { value: originalCreate, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevoke, configurable: true });
    HTMLAnchorElement.prototype.click = originalClick;
  }
});

test('a tool call shows a human name without dumping JSON or a Done badge', async () => {
  const { host } = await renderIn(<ChatToolCall toolName="search_notes" args={{ query: 'air' }} result={{ hits: 2 }}/>);
  const card = host.querySelector('.chat-tool-call') as HTMLElement;
  expect(card?.getAttribute('data-status')).toBe('success');
  expect(card?.querySelector('.chat-tool-name')?.textContent).toBe('Search notes');
  expect(card?.querySelector('.chat-tool-preview')?.textContent).toBe('air');
  expect(card?.querySelector('.chat-tool-status')).toBeNull();
  expect(card?.querySelector('pre')).toBeNull();
  expect(card?.textContent).not.toContain('"query"');
  expect(card?.textContent).not.toContain('Done');
});

test('a failed tool call stays one quiet row and a running one shows Working', async () => {
  const failed = await renderIn(<ChatToolCall toolName="glob" args={{ pattern: '**/*.md' }} result={{ error: 'offline' }} isError isPreliminary={false}/>);
  const card = failed.host.querySelector('.chat-tool-call') as HTMLElement;
  expect(card?.getAttribute('data-status')).toBe('error');
  expect(card?.querySelector('.chat-tool-name')?.textContent).toBe('Find files');
  expect(card?.querySelector('.chat-tool-preview')?.textContent).toBe('**/*.md');
  expect(card?.querySelector('.chat-tool-status')?.textContent).toContain('Failed');
  expect(card?.textContent).not.toContain('Found files');
  expect(card?.textContent).not.toContain('Couldn’t finish');
  expect(card?.querySelector('[role="alert"]')).toBeNull();
  expect(card?.querySelector('pre')).toBeNull();
  expect(card?.textContent).not.toContain('offline');
  const running = await renderIn(<ChatToolCall toolName="glob" args={{ pattern: '**/*.md' }} isPreliminary/>);
  const pending = running.host.querySelector('.chat-tool-call') as HTMLElement;
  expect(pending?.getAttribute('data-status')).toBe('running');
  expect(pending?.querySelector('.chat-tool-status')?.textContent).toContain('Working');
  expect(pending?.querySelector('.chat-tool-preview')?.textContent).toBe('**/*.md');
  expect(pending?.querySelector('pre')).toBeNull();
  const settledEmpty = await renderIn(<ChatToolCall toolName="glob" args={{ pattern: '**/*.md' }} result={null} isPreliminary={false}/>);
  expect(settledEmpty.host.querySelector('.chat-tool-call')?.getAttribute('data-status')).toBe('success');
  expect(settledEmpty.host.querySelector('.chat-tool-status')).toBeNull();
  expect(settledEmpty.host.querySelector('.chat-tool-name')?.textContent).toBe('Found files');
});

test('file tools use short tense labels, basename previews, and hide finished creates', async () => {
  const reading = await renderIn(<ChatToolCall toolName="view" args={{ path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' }}/>);
  expect(reading.host.querySelector('.chat-tool-name')?.textContent).toBe('Reading');
  expect(reading.host.querySelector('.chat-tool-preview')?.textContent).toBe('markdown-styles-sample.md');
  expect(reading.host.textContent).not.toContain('Open on stage');
  const read = await renderIn(<ChatToolCall toolName="view" args={{ path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' }} result={{ ok: true }}/>);
  expect(read.host.querySelector('.chat-tool-name')?.textContent).toBe('Read');
  expect(read.host.querySelector('.chat-tool-preview')?.textContent).toBe('markdown-styles-sample.md');
  const created = await renderIn(<ChatToolCall toolName="create" args={{ path: 'C:\\Users\\Example\\Documents\\demo_repo\\markdown-styles-sample.md' }} result={{ ok: true }}/>);
  expect(created.host.querySelector('.chat-tool-call')).toBeNull();
  expect(created.host.textContent).not.toContain('Open on stage');
});

test('chat message components plug into the streamdown pipeline', async () => {
  const MARKDOWN = [
    'Use `inline` in code.',
    '```ts\nconst a = 1;\n```',
    '```diff\n@@ -1 +1 @@\n-old\n+new\n```',
    '```json\n{"k":1}\n```',
    '```mermaid\ngraph TD;\n  A-->B;\n```',
    '| Name | Score |',
    '| --- | --- |',
    '| =danger | 1 |',
    '',
    'See [the report](https://knowledge.local/versions/v9).'
  ].join('\n');
  const value: ChatRenderContextValue = {
    citation: { versions: VERSIONS, results: [{ versionId: 'v9', resolved: true }] },
    submitCodeJob: async () => ({ status: 'submitted', endpoint: '/api/v1/jobs/run', jobId: 'job-1' })
  };
  function Fixture() {
    const runtime = useExternalStoreRuntime({
      messages: [{ id: 'a1', role: 'assistant', content: MARKDOWN, status: { type: 'complete', reason: 'stop' } }],
      convertMessage: (item: ThreadMessageLike) => item,
      onNew: async () => undefined
    });
    const Text = () => <ChatRenderContext.Provider value={value}><StreamdownTextPrimitive components={CHAT_MESSAGE_COMPONENTS}/></ChatRenderContext.Provider>;
    return <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages>
            {({ message }) => <article><MessagePrimitive.Parts components={{ Text }}/></article>}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>;
  }
  const { host } = await renderIn(<Fixture/>);
  for (let attempt = 0; attempt < 30 && !host.querySelector('.markdown-code-block'); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  }
  const codeBlock = host.querySelector('.markdown-code-block[data-language="ts"]');
  expect(codeBlock?.querySelector('.markdown-code-block-bar')?.textContent).toContain('ts');
  expect(codeBlock?.querySelector('[aria-label="Copy code"]')).not.toBeNull();
  expect(codeBlock?.querySelector('[aria-label="Run to job"]')).not.toBeNull();
  expect(host.querySelector('.chat-diff')).not.toBeNull();
  expect(host.querySelector('.chat-json')?.getAttribute('data-mode')).toBe('structured');
  expect(host.querySelector('.chat-table-wrap, .table-root, [data-slot="table"], table')).not.toBeNull();
  expect(host.querySelector('a[data-citation-state="verified"]')).not.toBeNull();
  expect([...host.querySelectorAll('.markdown-code-block')]).toHaveLength(3);
  expect(host.querySelector('[data-streamdown="code-block"]')).not.toBeNull();
  const inline = [...host.querySelectorAll('p code')].find((element) => element.textContent === 'inline');
  expect(inline).toBeDefined();
  expect(inline?.closest('.markdown-code-block')).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
});

