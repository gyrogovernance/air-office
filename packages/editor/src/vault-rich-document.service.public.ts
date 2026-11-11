import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { RichDocumentRecord } from '@office/contracts/rich-document';
import { atomicWriteText } from '@office/vault/atomic';
import {
  assessMarkdownDrift,
  parseNoteJson,
  pairPathsFromNotePath,
  withProjection,
  type NoteDriftState,
  type NoteEnvelope,
} from '@office/vault/note';
import { ensureVaultLayout } from '@office/vault/service';
import {
  noteJsonRelative,
  normalizeVaultRelative,
  programNotesDir,
  slugify,
  VAULT_PATHS,
} from '@office/vault/domain';
import {
  resolveUnderVault,
  resolveVaultRoot,
  toVaultRelative,
} from '@office/vault/host';
import { isInboundRichDocument, validateRichDocument } from './rich-document.domain.public';
import { markdownToNativeBody, nativeBodyToMarkdown } from './rich-document-native-bridge.domain.public';

export interface RichDocumentStore {
  list(): RichDocumentRecord[];
  get(id: string): RichDocumentRecord | null;
  save(document: RichDocumentRecord): RichDocumentRecord;
  trash(id: string): boolean;
  trashed(): RichDocumentRecord[];
  restore(id: string): RichDocumentRecord | null;
  clearAll(): number;
  close(): void;
}

export type VaultRichDocumentStore = RichDocumentStore & {
  /** Vault-relative path of the note pair, when known. */
  pathOf(id: string): string | null;
  drift(idOrPath: string): NoteDriftState;
  applyMarkdown(idOrPath: string, markdown?: string): { document: RichDocumentRecord; warnings: string[] };
  discardMarkdown(idOrPath: string): RichDocumentRecord;
};

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

function identityFromJsonPath(vaultRelativeJson: string): { path: string; programSlug: string; slug: string } {
  const path = normalizeVaultRelative(vaultRelativeJson);
  const projectMatch = path.match(/^programs\/([^/]+)\/projects\/[^/]+\/notes\/(.+)\.note\.json$/);
  if (projectMatch) return { path, programSlug: projectMatch[1]!, slug: basename(projectMatch[2]!) };
  const match = path.match(/^programs\/([^/]+)\/notes\/(.+)\.note\.json$/);
  if (!match) throw new Error(`Note path is outside programs/*/notes: ${path}`);
  return { path, programSlug: match[1]!, slug: basename(match[2]!) };
}

function stripRuntimeIdentity(document: RichDocumentRecord): NoteEnvelope {
  const { path: _path, programSlug: _program, slug: _slug, ...rest } = document;
  return rest as NoteEnvelope;
}

function withIdentity(document: RichDocumentRecord, vaultRelativeJson: string): RichDocumentRecord {
  const identity = identityFromJsonPath(vaultRelativeJson);
  return { ...document, ...identity };
}

function readText(absolute: string): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function walkNoteJsonFiles(absoluteNotesRoot: string): string[] {
  if (!existsSync(absoluteNotesRoot)) return [];
  const out: string[] = [];
  const stack = [absoluteNotesRoot];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name.endsWith('.note.json')) out.push(target);
    }
  }
  return out;
}

function walkMarkdownOrphans(absoluteNotesRoot: string): string[] {
  if (!existsSync(absoluteNotesRoot)) return [];
  const out: string[] = [];
  const stack = [absoluteNotesRoot];
  while (stack.length) {
    const current = stack.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        const jsonSibling = join(current, entry.name.replace(/\.md$/i, '.note.json'));
        if (!existsSync(jsonSibling)) out.push(target);
      }
    }
  }
  return out;
}

function parseStored(bytes: string): RichDocumentRecord {
  const envelope = parseNoteJson(bytes);
  if (!validateRichDocument(envelope) && !isInboundRichDocument(envelope)) {
    throw new Error('Invalid note JSON: document does not match the supported rich-document format.');
  }
  return envelope as RichDocumentRecord;
}

function uniqueNotePath(root: string, programSlug: string, preferredSlug: string): string {
  let slug = slugify(preferredSlug);
  let relativePath = noteJsonRelative(programSlug, slug);
  let suffix = 2;
  while (existsSync(resolveUnderVault(root, relativePath))) {
    relativePath = noteJsonRelative(programSlug, `${slug}-${suffix++}`);
  }
  return relativePath;
}

/**
 * Program-scoped vault note authority under programs/<program>/notes/ (recursive),
 * plus paired markdown projections. Replaces SQLite / `.office-document.json`.
 */
export function createVaultRichDocumentStore(vaultRoot = resolveVaultRoot()): VaultRichDocumentStore {
  const root = resolveVaultRoot(vaultRoot);
  ensureVaultLayout(root);
  const observed = new Map<string, string>();

  const trashRoot = resolveUnderVault(root, VAULT_PATHS.trash);

  const locateById = (id: string): string | null => {
    const normalized = id.replace(/\\/g, '/');
    if (normalized.includes('/') || normalized.endsWith('.note.json') || normalized.endsWith('.md')) {
      try {
        const { jsonPath } = pairPathsFromNotePath(normalizeVaultRelative(normalized));
        const absolute = resolveUnderVault(root, jsonPath);
        return existsSync(absolute) ? jsonPath : null;
      } catch {
        return null;
      }
    }
    for (const absolute of walkNoteJsonFiles(resolveUnderVault(root, VAULT_PATHS.programs))) {
      const relativePath = toVaultRelative(root, absolute);
      if (!relativePath.includes('/notes/')) continue;
      try {
        const document = parseStored(readFileSync(absolute, 'utf8'));
        if (document.id === id) return relativePath;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid note JSON')) throw error;
        throw error;
      }
    }
    return null;
  };

  const materializeLoneMarkdown = (absoluteMarkdown: string): RichDocumentRecord => {
    const vaultMarkdown = toVaultRelative(root, absoluteMarkdown);
    const { jsonPath, markdownPath } = pairPathsFromNotePath(vaultMarkdown);
    const markdown = readFileSync(absoluteMarkdown, 'utf8');
    let body: unknown;
    try {
      body = markdownToNativeBody(markdown);
    } catch (error) {
      throw new Error(`Lone markdown note could not be converted: ${error instanceof Error ? error.message : String(error)}`);
    }
    const title = basename(markdownPath, '.md');
    const base: RichDocumentRecord = {
      format: 'air-office.rich-document',
      id: crypto.randomUUID(),
      title,
      updatedAt: new Date().toISOString(),
      body,
      attachments: [],
    };
    const projected = withProjection(stripRuntimeIdentity(base), markdownPath, nativeBodyToMarkdown(body));
    atomicWriteText(resolveUnderVault(root, jsonPath), `${JSON.stringify(projected)}\n`);
    atomicWriteText(resolveUnderVault(root, markdownPath), nativeBodyToMarkdown(body));
    const stored = withIdentity(projected as RichDocumentRecord, jsonPath);
    observed.set(jsonPath, projected.projection.sourceJsonHash);
    return stored;
  };

  const readAt = (vaultRelativeJson: string): { document: RichDocumentRecord; bytes: string } | null => {
    const absolute = resolveUnderVault(root, vaultRelativeJson);
    const bytes = readText(absolute);
    if (bytes === null) return null;
    const document = withIdentity(parseStored(bytes), vaultRelativeJson);
    return { document, bytes };
  };

  const scanActive = (): RichDocumentRecord[] => {
    const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
    const documents: RichDocumentRecord[] = [];
    const jsonFiles = walkNoteJsonFiles(programsRoot).filter((absolute) => {
      const rel = toVaultRelative(root, absolute);
      return /(?:^|\/)notes\//.test(rel) && !rel.startsWith(`${VAULT_PATHS.trash}/`);
    });
    for (const absolute of jsonFiles) {
      const relativePath = toVaultRelative(root, absolute);
      const current = readAt(relativePath);
      if (!current) continue;
      documents.push(current.document);
      observed.set(relativePath, current.document.projection?.sourceJsonHash ?? '');
    }
    for (const programEntry of existsSync(programsRoot) ? readdirSync(programsRoot, { withFileTypes: true }) : []) {
      if (!programEntry.isDirectory()) continue;
      const notesRoot = join(programsRoot, programEntry.name, 'notes');
      for (const orphan of walkMarkdownOrphans(notesRoot)) {
        documents.push(materializeLoneMarkdown(orphan));
      }
      const projectsRoot = join(programsRoot, programEntry.name, 'projects');
      if (!existsSync(projectsRoot)) continue;
      for (const projectEntry of readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!projectEntry.isDirectory()) continue;
        for (const orphan of walkMarkdownOrphans(join(projectsRoot, projectEntry.name, 'notes'))) {
          documents.push(materializeLoneMarkdown(orphan));
        }
      }
    }
    return documents.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  };

  const writePair = (vaultRelativeJson: string, document: RichDocumentRecord): RichDocumentRecord => {
    const identity = identityFromJsonPath(vaultRelativeJson);
    const { markdownPath } = pairPathsFromNotePath(vaultRelativeJson);
    if (!validateRichDocument(document)) throw new Error('This rich document does not match the supported format.');
    const updatedAt = new Date().toISOString();
    const markdown = nativeBodyToMarkdown(document.body);
    const envelope = withProjection(
      { ...stripRuntimeIdentity({ ...document, updatedAt, path: undefined, programSlug: undefined, slug: undefined }), updatedAt },
      markdownPath,
      markdown,
    );
    atomicWriteText(resolveUnderVault(root, vaultRelativeJson), `${JSON.stringify(envelope)}\n`);
    atomicWriteText(resolveUnderVault(root, markdownPath), markdown);
    observed.set(vaultRelativeJson, envelope.projection.sourceJsonHash);
    return withIdentity(envelope as RichDocumentRecord, identity.path);
  };

  const resolveSavePath = (document: RichDocumentRecord): string => {
    if (document.path) {
      const { jsonPath } = pairPathsFromNotePath(normalizeVaultRelative(document.path));
      identityFromJsonPath(jsonPath);
      return jsonPath;
    }
    if (document.programSlug && document.slug) {
      return noteJsonRelative(document.programSlug, document.slug);
    }
    const existing = locateById(document.id);
    if (existing) return existing;
    const program = document.programSlug ? slugify(document.programSlug) : 'general';
    mkdirSync(resolveUnderVault(root, programNotesDir(program)), { recursive: true });
    return uniqueNotePath(root, program, document.slug ?? (document.title || document.id));
  };

  const trashRelativeFor = (vaultRelativeJson: string): string =>
    normalizeVaultRelative(`${VAULT_PATHS.trash}/${vaultRelativeJson}`);

  const movePair = (fromJson: string, toJson: string): void => {
    const fromMd = pairPathsFromNotePath(fromJson).markdownPath;
    const toMd = pairPathsFromNotePath(toJson).markdownPath;
    mkdirSync(dirname(resolveUnderVault(root, toJson)), { recursive: true });
    renameSync(resolveUnderVault(root, fromJson), resolveUnderVault(root, toJson));
    const mdAbsolute = resolveUnderVault(root, fromMd);
    if (existsSync(mdAbsolute)) {
      mkdirSync(dirname(resolveUnderVault(root, toMd)), { recursive: true });
      renameSync(mdAbsolute, resolveUnderVault(root, toMd));
    }
    observed.delete(fromJson);
  };

  const scanTrashed = (): RichDocumentRecord[] => {
    const documents: RichDocumentRecord[] = [];
    if (!existsSync(trashRoot)) return documents;
    for (const absolute of walkNoteJsonFiles(trashRoot)) {
      const relativePath = toVaultRelative(root, absolute);
      const original = relativePath.slice(`${VAULT_PATHS.trash}/`.length);
      const bytes = readFileSync(absolute, 'utf8');
      const document = withIdentity(parseStored(bytes), original);
      documents.push({ ...document, path: relativePath });
    }
    return documents.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  };

  /** Prefer an existing note pair; materialize a lone notes markdown file when the JSON pair is missing. */
  const resolveIdOrPath = (idOrPath: string): string => {
    const located = locateById(idOrPath);
    if (located) return located;
    const normalized = idOrPath.replace(/\\/g, '/').trim();
    if (!normalized || (!normalized.includes('/') && !normalized.endsWith('.md'))) {
      throw new Error('This note is unavailable.');
    }
    let jsonPath: string;
    let markdownPath: string;
    try {
      ({ jsonPath, markdownPath } = pairPathsFromNotePath(normalizeVaultRelative(normalized)));
    } catch {
      throw new Error('This note is unavailable.');
    }
    if (!/(?:^|\/)notes\//.test(markdownPath)) {
      throw new Error('apply_markdown_note requires a path under a notes/ folder.');
    }
    const absoluteMarkdown = resolveUnderVault(root, markdownPath);
    const absoluteJson = resolveUnderVault(root, jsonPath);
    if (!existsSync(absoluteMarkdown)) {
      throw new Error(`Note markdown not found: ${markdownPath}`);
    }
    if (existsSync(absoluteJson)) throw new Error('This note is unavailable.');
    materializeLoneMarkdown(absoluteMarkdown);
    return jsonPath;
  };

  return {
    list: () => scanActive(),
    get: (id) => {
      const path = locateById(id);
      if (!path) return null;
      if (path.startsWith(`${VAULT_PATHS.trash}/`)) return null;
      const current = readAt(path);
      if (!current) return null;
      observed.set(path, current.document.projection?.sourceJsonHash ?? '');
      return current.document;
    },
    pathOf: (id) => locateById(id),
    save: (document) => {
      if (!validateRichDocument(document)) throw new Error('This rich document does not match the supported format.');
      const target = resolveSavePath(document);
      if (scanTrashed().some((item) => item.id === document.id)) {
        throw new Error('Restore this note before saving it.');
      }
      const existing = readAt(target);
      if (existing) {
        if (existing.document.id !== document.id) {
          throw new Error('A note already exists at this path.');
        }
        const expected = observed.get(target);
        const actual = existing.document.projection?.sourceJsonHash ?? '';
        if (expected !== undefined && expected !== actual) {
          throw new Error('The canonical rich document changed externally. Reopen it before saving.');
        }
      }
      return writePair(target, document);
    },
    trash: (id) => {
      const path = locateById(id);
      if (!path || path.startsWith(`${VAULT_PATHS.trash}/`)) return false;
      const destination = trashRelativeFor(path);
      if (existsSync(resolveUnderVault(root, destination))) return true;
      movePair(path, destination);
      return true;
    },
    trashed: () => scanTrashed(),
    restore: (id) => {
      const trashed = scanTrashed().find((document) => document.id === id || document.path?.endsWith(id) || document.path === id);
      if (!trashed?.path) return null;
      const trashPath = trashed.path;
      const original = trashPath.slice(`${VAULT_PATHS.trash}/`.length);
      if (existsSync(resolveUnderVault(root, original))) {
        throw new Error('A note already exists at the restore path.');
      }
      movePair(trashPath, original);
      const current = readAt(original);
      return current?.document ?? null;
    },
    clearAll: () => {
      const active = scanActive();
      const trashed = scanTrashed();
      for (const document of active) {
        if (!document.path) continue;
        const { jsonPath, markdownPath } = pairPathsFromNotePath(document.path);
        unlinkSync(resolveUnderVault(root, jsonPath));
        try { unlinkSync(resolveUnderVault(root, markdownPath)); } catch (error) { if (!missing(error)) throw error; }
      }
      if (existsSync(trashRoot)) {
        for (const absolute of walkNoteJsonFiles(trashRoot)) {
          const relativePath = toVaultRelative(root, absolute);
          const { jsonPath, markdownPath } = pairPathsFromNotePath(relativePath);
          unlinkSync(resolveUnderVault(root, jsonPath));
          try { unlinkSync(resolveUnderVault(root, markdownPath)); } catch (error) { if (!missing(error)) throw error; }
        }
      }
      observed.clear();
      return active.length + trashed.length;
    },
    drift: (idOrPath) => {
      const path = resolveIdOrPath(idOrPath);
      const current = readAt(path);
      if (!current) return { kind: 'missing-json' };
      const markdownPath = current.document.projection?.markdownPath ?? pairPathsFromNotePath(path).markdownPath;
      const markdown = readText(resolveUnderVault(root, markdownPath));
      return assessMarkdownDrift(current.document.projection, markdown);
    },
    applyMarkdown: (idOrPath, markdown) => {
      const path = resolveIdOrPath(idOrPath);
      const current = readAt(path);
      if (!current) throw new Error('This note is unavailable.');
      const markdownPath = current.document.projection?.markdownPath ?? pairPathsFromNotePath(path).markdownPath;
      const text = markdown ?? readText(resolveUnderVault(root, markdownPath));
      if (text === null) throw new Error('Markdown projection is missing.');
      const warnings: string[] = [];
      let body: unknown;
      try {
        body = markdownToNativeBody(text);
      } catch (error) {
        // Fail closed: leave JSON unchanged when conversion throws.
        throw new Error(`Markdown could not be applied: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!body || typeof body !== 'object') throw new Error('Markdown could not be applied: converter returned no body.');
      warnings.push('Applied markdown projection into the native note body.');
      const next: RichDocumentRecord = {
        ...current.document,
        body,
        updatedAt: new Date().toISOString(),
      };
      return { document: writePair(path, next), warnings };
    },
    discardMarkdown: (idOrPath) => {
      const path = resolveIdOrPath(idOrPath);
      const current = readAt(path);
      if (!current) throw new Error('This note is unavailable.');
      if (!validateRichDocument(current.document)) throw new Error('This note is unavailable.');
      return writePair(path, current.document);
    },
    close: () => {
      observed.clear();
    },
  };
}
