import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { atomicWriteText } from '@office/vault/atomic';

export type LeanPathRoots = {
  vaultRoot: string;
  connectedRoots?: readonly string[];
  /** Absolute directories chat tools must never read or write (Keys / private profile). */
  deniedRoots?: readonly string[];
};

/** Library-relative prefixes that stay out of chat tools (runtime DBs and app settings). */
const PROTECTED_LIBRARY_PREFIXES = ['.air/runtime', '.air/settings'] as const;

function canonicalize(path: string): string {
  return resolve(path);
}

function isUnderRoot(absolute: string, root: string): boolean {
  const rootResolved = canonicalize(root);
  const prefix = rootResolved.endsWith(sep) ? rootResolved : `${rootResolved}${sep}`;
  return absolute === rootResolved || absolute.startsWith(prefix);
}

function isUnderRootReal(absoluteReal: string, root: string): boolean {
  let rootReal: string;
  try {
    rootReal = realpathSync(canonicalize(root));
  } catch {
    rootReal = canonicalize(root);
  }
  const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
  return absoluteReal === rootReal || absoluteReal.startsWith(prefix);
}

function libraryRelative(absolute: string, vaultRoot: string): string | null {
  const rel = relative(canonicalize(vaultRoot), absolute).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel.startsWith('../') || isAbsolute(rel)) return null;
  return rel;
}

function hasReservedSegment(absolute: string): boolean {
  return absolute.replace(/\\/g, '/').split('/').some((part) => /^(credentials?|secrets?|keychain|provider-credentials)$/i.test(part));
}

function isProtectedLibraryPath(absolute: string, vaultRoot: string): boolean {
  const rel = libraryRelative(absolute, vaultRoot)?.toLowerCase();
  if (!rel) return false;
  return PROTECTED_LIBRARY_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

function assertAllowed(absolute: string, roots: LeanPathRoots, useReal: boolean): void {
  const allowed = [roots.vaultRoot, ...(roots.connectedRoots ?? [])];
  const contained = useReal
    ? allowed.some((root) => isUnderRootReal(absolute, root))
    : allowed.some((root) => isUnderRoot(absolute, root));
  if (!contained) throw new Error('Path is outside the Library and connected folders.');
  const denied = roots.deniedRoots ?? [];
  const blocked = useReal
    ? denied.some((root) => isUnderRootReal(absolute, root))
    : denied.some((root) => isUnderRoot(absolute, root));
  if (blocked || hasReservedSegment(absolute) || isProtectedLibraryPath(absolute, roots.vaultRoot)) {
    throw new Error('That path is reserved and is not available to chat tools.');
  }
}

/** Realpath an existing path, or the nearest existing ancestor when creating. */
function realpathExistingOrAncestor(absolute: string): string {
  let current = absolute;
  for (let depth = 0; depth <= 64; depth += 1) {
    try {
      return realpathSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw new Error('Path could not be verified.');
    }
    const parent = dirname(current);
    if (parent === current) return canonicalize(absolute);
    current = parent;
  }
  throw new Error('Path could not be verified.');
}

export function resolveLeanPath(path: string, roots: LeanPathRoots): string {
  if (!path || path.includes('\0')) throw new Error('Invalid path.');
  const absolute = isAbsolute(path) ? canonicalize(path) : canonicalize(join(roots.vaultRoot, path));
  assertAllowed(absolute, roots, false);
  assertAllowed(realpathExistingOrAncestor(absolute), roots, true);
  return absolute;
}

function toDisplayPath(absolute: string, roots: LeanPathRoots): string {
  const vaultRel = relative(canonicalize(roots.vaultRoot), absolute).replace(/\\/g, '/');
  if (vaultRel && !vaultRel.startsWith('../') && !isAbsolute(vaultRel)) return vaultRel;
  return absolute.replace(/\\/g, '/');
}

export function leanView(input: { path: string; view_range?: [number, number] }, roots: LeanPathRoots): { path: string; content: string } {
  const absolute = resolveLeanPath(input.path, roots);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`File not found: ${input.path}`);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  if (!input.view_range) return { path: toDisplayPath(absolute, roots), content: lines.join('\n') };
  const [start, end] = input.view_range;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1) throw new Error('view_range must be [startLine, endLine] with startLine >= 1.');
  const from = start - 1;
  const to = end === -1 ? lines.length : end;
  if (to < start && end !== -1) throw new Error('view_range endLine must be >= startLine or -1.');
  return { path: toDisplayPath(absolute, roots), content: lines.slice(from, to).join('\n') };
}

export function leanCreate(input: { path: string; file_text: string }, roots: LeanPathRoots): { path: string; created: true } {
  const absolute = resolveLeanPath(input.path, roots);
  if (existsSync(absolute)) throw new Error(`File already exists: ${input.path}`);
  mkdirSync(dirname(absolute), { recursive: true });
  atomicWriteText(absolute, input.file_text);
  return { path: toDisplayPath(absolute, roots), created: true };
}

export function leanEdit(input: { path: string; old_str: string; new_str: string }, roots: LeanPathRoots): { path: string; replaced: true } {
  const absolute = resolveLeanPath(input.path, roots);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`File not found: ${input.path}`);
  const current = readFileSync(absolute, 'utf8');
  const parts = current.split(input.old_str);
  if (parts.length === 1) throw new Error('old_str was not found in the file.');
  if (parts.length > 2) throw new Error('old_str matched more than once; edit requires exactly one occurrence.');
  atomicWriteText(absolute, parts.join(input.new_str));
  return { path: toDisplayPath(absolute, roots), replaced: true };
}

function notePairSibling(absolute: string): string | null {
  const lower = absolute.replace(/\\/g, '/').toLowerCase();
  if (lower.endsWith('.note.json')) return absolute.slice(0, -'.note.json'.length) + '.md';
  if (lower.endsWith('.md')) return absolute.slice(0, -'.md'.length) + '.note.json';
  return null;
}

function underNotesFolder(displayPath: string): boolean {
  return /(?:^|\/)notes\//.test(displayPath.replace(/\\/g, '/'));
}

/** Delete a single file under vault/connected roots. Note pairs: pass either .md or .note.json to remove both. */
export function leanDelete(input: { path: string }, roots: LeanPathRoots): { path: string; deleted: true; paired?: string } {
  const absolute = resolveLeanPath(input.path, roots);
  if (!existsSync(absolute)) throw new Error(`File not found: ${input.path}`);
  if (!statSync(absolute).isFile()) throw new Error('delete only removes files, not directories.');
  const display = toDisplayPath(absolute, roots);
  const sibling = underNotesFolder(display) ? notePairSibling(absolute) : null;
  unlinkSync(absolute);
  let paired: string | undefined;
  if (sibling && existsSync(sibling) && statSync(sibling).isFile()) {
    assertAllowed(sibling, roots, false);
    assertAllowed(realpathExistingOrAncestor(sibling), roots, true);
    unlinkSync(sibling);
    paired = toDisplayPath(sibling, roots);
  }
  return { path: display, deleted: true, ...(paired ? { paired } : {}) };
}

/** Move/rename a file within vault/connected roots. Note pairs move together. */
export function leanMove(input: { path: string; to: string }, roots: LeanPathRoots): { path: string; from: string; paired?: string } {
  const fromAbs = resolveLeanPath(input.path, roots);
  if (!existsSync(fromAbs) || !statSync(fromAbs).isFile()) throw new Error(`File not found: ${input.path}`);
  const toAbs = resolveLeanPath(input.to, roots);
  if (existsSync(toAbs)) throw new Error(`Destination already exists: ${input.to}`);
  mkdirSync(dirname(toAbs), { recursive: true });
  const fromDisplay = toDisplayPath(fromAbs, roots);
  const sibling = underNotesFolder(fromDisplay) ? notePairSibling(fromAbs) : null;
  renameSync(fromAbs, toAbs);
  let paired: string | undefined;
  if (sibling && existsSync(sibling) && statSync(sibling).isFile()) {
    const toSibling = notePairSibling(toAbs);
    if (!toSibling) throw new Error('Note pair moves require a .md or .note.json destination.');
    assertAllowed(toSibling, roots, false);
    assertAllowed(realpathExistingOrAncestor(toSibling), roots, true);
    if (existsSync(toSibling)) throw new Error(`Destination pair already exists: ${toDisplayPath(toSibling, roots)}`);
    mkdirSync(dirname(toSibling), { recursive: true });
    renameSync(sibling, toSibling);
    paired = toDisplayPath(toSibling, roots);
  }
  return { path: toDisplayPath(toAbs, roots), from: fromDisplay, ...(paired ? { paired } : {}) };
}

/** Classify a vault-relative path for open_path (note vs plain file). */
export function leanPathKind(path: string, roots: LeanPathRoots): { path: string; kind: 'note' | 'file' } {
  const absolute = resolveLeanPath(path, roots);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`File not found: ${path}`);
  const display = toDisplayPath(absolute, roots);
  const kind = underNotesFolder(display) && (display.endsWith('.md') || display.endsWith('.note.json')) ? 'note' : 'file';
  return { path: display, kind };
}

function walkFiles(directory: string, matches: string[], limit: number, roots: LeanPathRoots): void {
  if (matches.length >= limit) return;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (matches.length >= limit) return;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (hasReservedSegment(absolute) || isProtectedLibraryPath(absolute, roots.vaultRoot)) continue;
      const denied = roots.deniedRoots ?? [];
      if (denied.some((root) => isUnderRoot(absolute, root))) continue;
      walkFiles(absolute, matches, limit, roots);
    } else if (entry.isFile()) {
      if (hasReservedSegment(absolute) || isProtectedLibraryPath(absolute, roots.vaultRoot)) continue;
      matches.push(absolute);
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE::/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function leanGlob(input: { pattern: string; path?: string }, roots: LeanPathRoots): { matches: string[] } {
  const base = resolveLeanPath(input.path?.trim() || '.', roots);
  if (!existsSync(base)) return { matches: [] };
  const files: string[] = [];
  if (statSync(base).isFile()) files.push(base);
  else walkFiles(base, files, 2000, roots);
  const matcher = globToRegExp(input.pattern.replace(/\\/g, '/'));
  const matches = files
    .map((file) => toDisplayPath(file, roots))
    .filter((display) => matcher.test(display) || matcher.test(display.split('/').pop() ?? display))
    .slice(0, 500);
  return { matches };
}

export function leanGrep(input: {
  pattern: string;
  path?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  glob?: string;
  '-i'?: boolean;
  '-A'?: number;
  '-B'?: number;
  '-C'?: number;
  '-n'?: boolean;
  head_limit?: number;
  multiline?: boolean;
}, roots: LeanPathRoots): unknown {
  const base = resolveLeanPath(input.path?.trim() || '.', roots);
  const files: string[] = [];
  if (existsSync(base) && statSync(base).isFile()) files.push(base);
  else if (existsSync(base)) walkFiles(base, files, 2000, roots);
  const fileGlob = input.glob ? globToRegExp(input.glob.replace(/\\/g, '/')) : null;
  const flags = `${input['-i'] ? 'i' : ''}${input.multiline ? 's' : ''}`;
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern, flags);
  } catch (error) {
    throw new Error(`Invalid grep pattern: ${error instanceof Error ? error.message : String(error)}`);
  }
  const head = Math.min(Math.max(input.head_limit ?? 50, 1), 500);
  const mode = input.output_mode ?? 'content';
  const context = input['-C'] ?? 0;
  const before = input['-B'] ?? context;
  const after = input['-A'] ?? context;
  const hits: { path: string; line?: number; text?: string }[] = [];
  const fileCounts = new Map<string, number>();
  for (const file of files) {
    const display = toDisplayPath(file, roots);
    if (fileGlob && !fileGlob.test(display) && !fileGlob.test(display.split('/').pop() ?? display)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    let count = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!regex.test(line)) continue;
      count += 1;
      if (mode === 'content' && hits.length < head) {
        const from = Math.max(0, index - before);
        const to = Math.min(lines.length, index + 1 + after);
        const slice = lines.slice(from, to).map((entry, offset) => {
          const lineNumber = from + offset + 1;
          return input['-n'] === false ? entry : `${lineNumber}:${entry}`;
        }).join('\n');
        hits.push({ path: display, line: index + 1, text: slice });
      }
    }
    if (count > 0) fileCounts.set(display, count);
  }
  if (mode === 'files_with_matches') return { files: [...fileCounts.keys()].slice(0, head) };
  if (mode === 'count') return { counts: [...fileCounts.entries()].slice(0, head).map(([path, count]) => ({ path, count })) };
  return { matches: hits };
}
