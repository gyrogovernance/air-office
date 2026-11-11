import { sha256Text } from './vault.host.public';

export type NoteProjection = {
  markdownPath: string;
  sourceJsonHash: string;
  markdownHash: string;
};

export type NoteEnvelope = {
  format: string;
  id: string;
  title: string;
  updatedAt: string;
  body: unknown;
  attachments: unknown[];
  projection?: NoteProjection;
};

export type NoteDriftState =
  | { kind: 'ok' }
  | { kind: 'markdown-drift'; expectedHash: string; actualHash: string }
  | { kind: 'missing-markdown' }
  | { kind: 'missing-json' }
  | { kind: 'invalid-json'; message: string };

/** Canonical JSON bytes for hashing: projection field excluded, stable key order via JSON.stringify of stripped object. */
export function canonicalNoteJsonBytes(document: NoteEnvelope): string {
  const { projection: _projection, ...rest } = document;
  return `${JSON.stringify(rest)}\n`;
}

export function computeSourceJsonHash(document: NoteEnvelope): string {
  return sha256Text(canonicalNoteJsonBytes(document));
}

export function computeMarkdownHash(markdown: string): string {
  return sha256Text(markdown);
}

export function withProjection(
  document: NoteEnvelope,
  markdownPath: string,
  markdown: string,
): NoteEnvelope & { projection: NoteProjection } {
  const withoutProjection: NoteEnvelope = { ...document };
  delete withoutProjection.projection;
  return {
    ...withoutProjection,
    projection: {
      markdownPath,
      sourceJsonHash: computeSourceJsonHash(withoutProjection),
      markdownHash: computeMarkdownHash(markdown),
    },
  };
}

export function assessMarkdownDrift(
  projection: NoteProjection | undefined,
  markdownOnDisk: string | null,
): NoteDriftState {
  if (!projection) return markdownOnDisk === null ? { kind: 'missing-markdown' } : { kind: 'markdown-drift', expectedHash: '', actualHash: computeMarkdownHash(markdownOnDisk) };
  if (markdownOnDisk === null) return { kind: 'missing-markdown' };
  const actual = computeMarkdownHash(markdownOnDisk);
  if (actual !== projection.markdownHash) {
    return { kind: 'markdown-drift', expectedHash: projection.markdownHash, actualHash: actual };
  }
  return { kind: 'ok' };
}

export function parseNoteJson(bytes: string): NoteEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`Invalid note JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid note JSON: expected an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.format !== 'string' || typeof record.id !== 'string' || typeof record.title !== 'string') {
    throw new Error('Invalid note JSON: missing required envelope fields.');
  }
  return parsed as NoteEnvelope;
}

export function pairPathsFromNotePath(path: string): { jsonPath: string; markdownPath: string } {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.endsWith('.note.json')) {
    return { jsonPath: normalized, markdownPath: normalized.replace(/\.note\.json$/, '.md') };
  }
  if (normalized.endsWith('.md')) {
    return { jsonPath: normalized.replace(/\.md$/, '.note.json'), markdownPath: normalized };
  }
  throw new Error(`Path is not a note pair: ${path}`);
}
