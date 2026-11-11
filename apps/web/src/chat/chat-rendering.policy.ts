/**
 * Pure rendering rules for the chat surface.
 *
 * Covers CSV export with spreadsheet formula sanitization, citation freshness
 * against loaded knowledge versions, structured JSON output rows, unified diff
 * parsing and side-by-side pairing, and job submission endpoint fallback.
 */

export const CODE_JOB_ENDPOINTS = ['/api/v1/jobs/run', '/api/v1/jobs'] as const;

export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  children?: HastNode[];
}

export function fenceLanguage(className: string | null | undefined): string | null {
  return /language-([^\s]+)/.exec(className ?? '')?.[1] ?? null;
}

export function hastText(node: HastNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map((child) => hastText(child)).join('');
}

/** Prefixes cells that spreadsheets would evaluate as formulas before quoting. */
export function sanitizeCsvCell(value: string): string {
  return value.length > 0 && '=+-@'.includes(value[0]!) ? `'${value}` : value;
}

function quoteCsvCell(value: string): string {
  const cell = sanitizeCsvCell(value);
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function rowsToCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [headers, ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\r\n');
}

export function tableRowsFromNode(node: HastNode | null | undefined): { headers: string[]; rows: string[][] } | null {
  if (node?.type !== 'element' || node.tagName !== 'table') return null;
  const headers: string[] = [];
  const rows: string[][] = [];
  const cellsOf = (row: HastNode): string[] => (row.children ?? [])
    .filter((cell) => cell.type === 'element' && (cell.tagName === 'th' || cell.tagName === 'td'))
    .map(hastText);
  for (const child of node.children ?? []) {
    if (child.type !== 'element') continue;
    if (child.tagName === 'tr') {
      rows.push(cellsOf(child));
      continue;
    }
    if (child.tagName !== 'thead' && child.tagName !== 'tbody' && child.tagName !== 'tfoot') continue;
    const parsed = (child.children ?? [])
      .filter((row) => row.type === 'element' && row.tagName === 'tr')
      .map(cellsOf);
    if (child.tagName === 'thead') {
      if (parsed[0]) headers.push(...parsed[0]);
      rows.push(...parsed.slice(1));
    } else {
      rows.push(...parsed);
    }
  }
  return { headers, rows };
}

export type CitationState = 'link' | 'verified' | 'stale' | 'unverified';

export interface CitationVersion {
  id: string;
  documentId: string;
  observedAt: string;
}

export interface CitationResult {
  versionId: string;
  resolved: boolean;
}

export interface CitationContext {
  versions: readonly CitationVersion[];
  results?: readonly CitationResult[];
}

/** Recognizes the citation URL shapes the chat can open in the knowledge panel. */
export function citationVersionId(href: string | null | undefined): string | null {
  if (!href) return null;
  const patterns = [
    /air-office:(?:\/\/)?(?:citation|version)\/([A-Za-z0-9._~-]+)/,
    /#(?:cite|version)[-:]([A-Za-z0-9._~-]+)/,
    /[?&](?:versionId|version|cite)=([A-Za-z0-9._~-]+)/,
    /\/versions\/([A-Za-z0-9._~-]+)/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(href);
    if (match) return match[1] ?? null;
  }
  return null;
}

export function citationState(href: string | null | undefined, context: CitationContext): CitationState {
  const versionId = citationVersionId(href);
  if (!versionId) return 'link';
  const cited = context.versions.find((version) => version.id === versionId);
  if (cited) {
    const changed = context.versions.some((version) =>
      version.documentId === cited.documentId && version.id !== cited.id && version.observedAt > cited.observedAt);
    if (changed) return 'stale';
  }
  if (context.results?.find((result) => result.versionId === versionId)?.resolved) return 'verified';
  return 'unverified';
}

export type StructuredParse = { ok: true; value: unknown } | { ok: false };

export function parseStructuredOutput(text: string): StructuredParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

export type PropertyKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface PropertyRow {
  path: readonly (string | number)[];
  depth: number;
  kind: PropertyKind;
  label: string;
  display: string;
}

const MAX_PROPERTY_ROWS = 500;

/** Flattens a parsed JSON value into an indented property list for the structured view. */
export function jsonPropertyRows(value: unknown): PropertyRow[] {
  const rows: PropertyRow[] = [];
  const visit = (node: unknown, path: (string | number)[], depth: number): void => {
    if (rows.length >= MAX_PROPERTY_ROWS) return;
    const label = path.length > 0 ? String(path[path.length - 1]) : 'value';
    if (node === null || typeof node !== 'object') {
      const kind = (node === null ? 'null' : typeof node) as PropertyKind;
      const display = node === null ? 'null' : typeof node === 'string' ? JSON.stringify(node) : String(node);
      rows.push({ path, depth, kind, label, display });
      return;
    }
    const entries: [string, unknown][] = Array.isArray(node)
      ? node.map((item, index) => [String(index), item])
      : Object.entries(node as Record<string, unknown>);
    const kind: PropertyKind = Array.isArray(node) ? 'array' : 'object';
    const display = kind === 'array' ? `[ ${entries.length} ]` : `{ ${entries.length} }`;
    rows.push({ path, depth, kind, label, display });
    for (const [key, child] of entries) {
      visit(child, [...path, kind === 'array' ? Number(key) : key], depth + 1);
    }
  };
  visit(value, [], 0);
  return rows;
}

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'context';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export function parseUnifiedDiff(text: string): DiffLine[] {
  const source = text.split(/\r?\n/);
  if (source.length > 0 && source[source.length - 1] === '') source.pop();
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  return source.map((line): DiffLine => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]) - 1;
      newNo = Number(hunk[2]) - 1;
      return { kind: 'hunk', text: line, oldNo: null, newNo: null };
    }
    if (!inHunk) {
      if (/^(---|\+\+\+|diff --git |index |new file|deleted file|similarity index|rename |Binary files)/.test(line)) {
        return { kind: 'meta', text: line, oldNo: null, newNo: null };
      }
      if (line.startsWith('+')) return { kind: 'add', text: line, oldNo: null, newNo: null };
      if (line.startsWith('-')) return { kind: 'del', text: line, oldNo: null, newNo: null };
      return { kind: 'meta', text: line, oldNo: null, newNo: null };
    }
    if (line.startsWith('+')) {
      newNo += 1;
      return { kind: 'add', text: line, oldNo: null, newNo };
    }
    if (line.startsWith('-')) {
      oldNo += 1;
      return { kind: 'del', text: line, oldNo, newNo: null };
    }
    if (line.startsWith('\\')) return { kind: 'meta', text: line, oldNo: null, newNo: null };
    oldNo += 1;
    newNo += 1;
    return { kind: 'context', text: line, oldNo, newNo };
  });
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'add') added += 1;
    else if (line.kind === 'del') removed += 1;
  }
  return { added, removed };
}

export interface DiffCell {
  no: number | null;
  text: string;
}

export interface DiffPair {
  kind: 'context' | 'change' | 'meta';
  left: DiffCell | null;
  right: DiffCell | null;
}

/** Zips runs of deletions and additions into aligned side-by-side rows. */
export function pairDiffLines(lines: readonly DiffLine[]): DiffPair[] {
  const pairs: DiffPair[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === 'context') {
      pairs.push({ kind: 'context', left: { no: line.oldNo, text: line.text }, right: { no: line.newNo, text: line.text } });
      index += 1;
      continue;
    }
    if (line.kind === 'meta' || line.kind === 'hunk') {
      pairs.push({ kind: 'meta', left: { no: null, text: line.text }, right: null });
      index += 1;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && (lines[index].kind === 'del' || lines[index].kind === 'add')) {
      if (lines[index].kind === 'del') removed.push(lines[index]);
      else added.push(lines[index]);
      index += 1;
    }
    const count = Math.max(removed.length, added.length);
    for (let position = 0; position < count; position += 1) {
      const before = removed[position];
      const after = added[position];
      pairs.push({
        kind: 'change',
        left: before ? { no: before.oldNo, text: before.text } : null,
        right: after ? { no: after.newNo, text: after.text } : null
      });
    }
  }
  return pairs;
}

export type JobSubmission =
  | { status: 'submitted'; endpoint: string; jobId: string | null }
  | { status: 'unavailable' }
  | { status: 'rejected'; endpoint: string; reason: string };

export interface JobSubmitClient {
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

/** Posts the code to the first job endpoint the local service accepts. */
export async function submitCodeToJobRunner(client: JobSubmitClient, code: string, language: string): Promise<JobSubmission> {
  for (const endpoint of CODE_JOB_ENDPOINTS) {
    let response: Response;
    try {
      response = await client.request(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, language })
      });
    } catch {
      return { status: 'unavailable' };
    }
    if (response.ok) {
      const payload = await response.json().catch(() => null) as { jobId?: unknown; job?: { id?: unknown }; id?: unknown } | null;
      const jobId = [payload?.jobId, payload?.job?.id, payload?.id].find((value) => typeof value === 'string');
      return { status: 'submitted', endpoint, jobId: jobId ?? null };
    }
    if (response.status === 404 || response.status === 405) continue;
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    const reason = typeof payload?.error === 'string' && payload.error
      ? payload.error
      : `The job runner responded with status ${response.status}.`;
    return { status: 'rejected', endpoint, reason };
  }
  return { status: 'unavailable' };
}

export function previewValue(value: unknown, maxLength = 160): string {
  let text: string;
  if (typeof value === 'string') text = value.trim().replace(/\s+/g, ' ');
  else if (value === undefined) text = '';
  else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function prettyJsonText(text: string): string | null {
  const trimmed = text.trim();
  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return prettyJsonText(value) ?? value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
