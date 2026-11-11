import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeSourceOriginal, readSourceOriginalBytes, resolveSourceOriginalAbsolute } from '@office/vault/sources';
import { knowledgeRuntimeRelative } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot, sha256Bytes } from '@office/vault/host';

export type SourceMeta = {
  name: string;
  kind: string;
  documentId: string;
  observedAt: string;
  byteSize: number;
  contentHash: string;
};

export type StoredSourceOriginal = {
  collectionSlug: string;
  contentHash: string;
  relativeOriginal: string;
  relativeMeta: string;
  meta: SourceMeta;
};

/** File extension from a display name (without the dot), or null when the name has none. */
export function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).trim();
  return ext.length > 0 ? ext : null;
}

function fileNameForOriginal(name: string, extension?: string | null): string {
  const ext = extension?.replace(/^\./, '').trim();
  if (!ext) return name;
  if (name.includes('.')) return `${name.slice(0, name.lastIndexOf('.'))}.${ext}`;
  return `${name}.${ext}`;
}

/** Persist immutable source bytes under sources/<collection>/originals/<sha256>.<ext>. Null collection uses inbox. Idempotent on content hash. Extension defaults from name so originals are not written as .bin when the name already carries one. */
export function storeSourceOriginal(input: {
  vaultRoot?: string;
  collectionId: string | null;
  documentId: string;
  name: string;
  kind: string;
  bytes: Uint8Array | Buffer;
  extension?: string;
}): StoredSourceOriginal {
  const extension = input.extension?.replace(/^\./, '').trim() || extensionFromName(input.name) || undefined;
  const written = writeSourceOriginal({
    root: input.vaultRoot,
    collectionSlug: input.collectionId,
    name: fileNameForOriginal(input.name, extension),
    kind: input.kind,
    documentId: input.documentId,
    bytes: input.bytes,
  });
  const collectionSlug = written.originalPath.split('/')[1] ?? 'inbox';
  const meta: SourceMeta = {
    name: input.name,
    kind: input.kind,
    documentId: input.documentId,
    observedAt: new Date().toISOString(),
    byteSize: input.bytes.byteLength,
    contentHash: written.contentHash,
  };
  return {
    collectionSlug,
    contentHash: written.contentHash,
    relativeOriginal: written.originalPath,
    relativeMeta: written.metaPath,
    meta,
  };
}

/** Read vault original bytes for a collection + content hash, or null when the file is absent. */
export function readSourceOriginal(input: {
  vaultRoot?: string;
  collectionId: string | null;
  contentHash: string;
}): Uint8Array | null {
  return readSourceOriginalBytes({
    root: input.vaultRoot,
    collectionSlug: input.collectionId,
    contentHash: input.contentHash,
  });
}

export const loadSourceOriginalBytes = readSourceOriginal;

/** Absolute path of a vault original when present. */
export function locateSourceOriginal(input: {
  vaultRoot?: string;
  collectionId: string | null;
  contentHash: string;
}): string | null {
  return resolveSourceOriginalAbsolute({
    root: input.vaultRoot,
    collectionSlug: input.collectionId,
    contentHash: input.contentHash,
  });
}

/** Rebuildable knowledge artifacts live under .air/runtime/knowledge/<contentHash>/; not a second public identity. */
export function runtimeKnowledgePath(vaultRoot: string, contentHash: string): string {
  const root = resolveVaultRoot(vaultRoot);
  const absolute = resolveUnderVault(root, knowledgeRuntimeRelative(contentHash));
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

export function contentHashOf(bytes: Uint8Array | Buffer | string): string {
  if (typeof bytes === 'string') return createHash('sha256').update(bytes, 'utf8').digest('hex');
  return sha256Bytes(bytes);
}

export { join };
