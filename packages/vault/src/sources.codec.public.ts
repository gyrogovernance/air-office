import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteBytes, atomicWriteText } from './atomic-write.adapter';
import {
  sourcesCollectionDir,
  sourcesCollectionYamlRelative,
  sourcesMetaRelative,
  sourcesOriginalRelative,
} from './vault.domain.public';
import {
  resolveUnderVault,
  resolveVaultRoot,
  sha256Bytes,
} from './vault.host.public';
import { ensureVaultLayout } from './vault.service.public';

export type SourceCollectionYaml = {
  id: string;
  name: string;
  createdAt: string;
};

export type SourceMetaYaml = {
  name: string;
  kind: string;
  documentId: string;
  observedAt: string;
  byteSize: number;
  contentHash: string;
};

function parseMapping(bytes: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(bytes);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid ${label}.`);
  return parsed as Record<string, unknown>;
}

export function parseSourceCollectionYaml(bytes: string): SourceCollectionYaml {
  const data = parseMapping(bytes, 'collection.yaml');
  for (const key of Object.keys(data)) {
    if (!['id', 'name', 'createdAt'].includes(key)) throw new Error(`Unknown collection.yaml key: ${key}`);
  }
  if (typeof data.id !== 'string' || typeof data.name !== 'string' || typeof data.createdAt !== 'string') {
    throw new Error('collection.yaml requires id, name, createdAt.');
  }
  return data as SourceCollectionYaml;
}

export function parseSourceMetaYaml(bytes: string): SourceMetaYaml {
  const data = parseMapping(bytes, 'source meta.yaml');
  for (const key of Object.keys(data)) {
    if (!['name', 'kind', 'documentId', 'observedAt', 'byteSize', 'contentHash'].includes(key)) {
      throw new Error(`Unknown source meta key: ${key}`);
    }
  }
  if (
    typeof data.name !== 'string'
    || typeof data.kind !== 'string'
    || typeof data.documentId !== 'string'
    || typeof data.observedAt !== 'string'
    || typeof data.byteSize !== 'number'
    || typeof data.contentHash !== 'string'
  ) {
    throw new Error('source meta.yaml is missing required fields.');
  }
  return data as SourceMetaYaml;
}

/** Write originals + meta under sources/<collection>/; null collection uses inbox. Idempotent on content hash. */
export function writeSourceOriginal(options: {
  root?: string;
  collectionSlug: string | null;
  name: string;
  kind: string;
  documentId: string;
  bytes: Uint8Array | Buffer;
  observedAt?: string;
}): { contentHash: string; originalPath: string; metaPath: string; created: boolean } {
  const root = options.root ? resolveVaultRoot(options.root) : resolveVaultRoot();
  ensureVaultLayout(root);
  const collection = options.collectionSlug?.trim() || 'inbox';
  const contentHash = sha256Bytes(options.bytes);
  const ext = options.name.includes('.') ? options.name.slice(options.name.lastIndexOf('.') + 1) : 'bin';
  const originalRelative = sourcesOriginalRelative(collection, contentHash, ext);
  const metaRelative = sourcesMetaRelative(collection, contentHash);
  const collectionRelative = sourcesCollectionYamlRelative(collection);
  const originalAbsolute = resolveUnderVault(root, originalRelative);
  const metaAbsolute = resolveUnderVault(root, metaRelative);
  const collectionAbsolute = resolveUnderVault(root, collectionRelative);
  mkdirSync(dirname(originalAbsolute), { recursive: true });
  mkdirSync(dirname(metaAbsolute), { recursive: true });
  if (!existsSync(collectionAbsolute)) {
    atomicWriteText(collectionAbsolute, Bun.YAML.stringify({
      id: collection,
      name: collection === 'inbox' ? 'Inbox' : collection,
      createdAt: options.observedAt ?? new Date().toISOString(),
    } satisfies SourceCollectionYaml));
  }
  const created = !existsSync(originalAbsolute);
  if (created) atomicWriteBytes(originalAbsolute, options.bytes);
  atomicWriteText(metaAbsolute, Bun.YAML.stringify({
    name: options.name,
    kind: options.kind,
    documentId: options.documentId,
    observedAt: options.observedAt ?? new Date().toISOString(),
    byteSize: options.bytes.byteLength,
    contentHash,
  } satisfies SourceMetaYaml));
  return { contentHash, originalPath: originalRelative, metaPath: metaRelative, created };
}

export function readSourceMeta(root: string, collectionSlug: string, contentHash: string): SourceMetaYaml {
  const path = resolveUnderVault(root, sourcesMetaRelative(collectionSlug, contentHash));
  return parseSourceMetaYaml(readFileSync(path, 'utf8'));
}

/** Resolve absolute path of sources/<collection>/originals/<sha256>.<ext>, or null when absent. */
export function resolveSourceOriginalAbsolute(options: {
  root?: string;
  collectionSlug: string | null;
  contentHash: string;
}): string | null {
  const root = options.root ? resolveVaultRoot(options.root) : resolveVaultRoot();
  const originalsDir = resolveUnderVault(root, `${sourcesCollectionDir(options.collectionSlug ?? 'inbox')}/originals`);
  if (!existsSync(originalsDir)) return null;
  const prefix = `${options.contentHash}.`;
  const matches = readdirSync(originalsDir)
    .filter((name) => name === options.contentHash || name.startsWith(prefix))
    .sort();
  if (matches.length === 0) return null;
  return join(originalsDir, matches[0]!);
}

/** Read immutable source bytes from the vault original keyed by content hash. */
export function readSourceOriginalBytes(options: {
  root?: string;
  collectionSlug: string | null;
  contentHash: string;
}): Uint8Array | null {
  const absolute = resolveSourceOriginalAbsolute(options);
  if (!absolute) return null;
  return new Uint8Array(readFileSync(absolute));
}
