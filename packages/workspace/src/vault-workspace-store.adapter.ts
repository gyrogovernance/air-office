import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseNoteJson } from '@office/vault/note';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  parseWorkspaceSettings,
  writeYamlSettings,
  type WorkspaceSettings,
} from '@office/vault/settings';
import { ensureVaultLayout } from '@office/vault/service';
import {
  normalizeVaultRelative,
  slugify,
  VAULT_PATHS,
} from '@office/vault/domain';
import {
  resolveUnderVault,
  resolveVaultRoot,
  toVaultRelative,
} from '@office/vault/host';
import { WorkspaceError, type WorkspaceNode, type WorkspaceNodeInput } from './workspace-catalog.domain.public';
import type { WorkspaceStore } from './workspace-store.port';

/** Narrow chat placement surface so workspace does not depend on the chat package. */
export type WorkspaceConversationPlacement = {
  load(conversationId: string): { folderId: string | null } | null;
  setFolder(conversationId: string, folderId: string | null): void;
  delete(conversationId: string): void;
  idsInFolders(folderIds: readonly string[]): string[];
};

function readTitleAndInstruction(absoluteDir: string, fallbackName: string): { name: string; instruction: string } {
  const path = join(absoluteDir, 'instruction.md');
  if (!existsSync(path)) return { name: fallbackName, instruction: '' };
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^#\s+([^\n]+)\n?/);
  const name = match?.[1]?.trim() || fallbackName;
  const instruction = raw.replace(/^#\s[^\n]*\n?/, '').trim();
  return { name, instruction };
}

function writeInstruction(absoluteDir: string, name: string, instruction: string): void {
  mkdirSync(absoluteDir, { recursive: true });
  const body = instruction.trim() ? `# ${name}\n\n${instruction.trim()}\n` : `# ${name}\n`;
  writeFileSync(join(absoluteDir, 'instruction.md'), body, 'utf8');
}

function directoryTimes(absoluteDir: string): { createdAt: string; updatedAt: string } {
  try {
    const stats = statSync(absoluteDir);
    const updatedAt = stats.mtime.toISOString();
    const createdAt = stats.birthtime?.toISOString?.() ?? updatedAt;
    return { createdAt, updatedAt };
  } catch {
    const now = new Date().toISOString();
    return { createdAt: now, updatedAt: now };
  }
}

function programId(slug: string): string { return `program:${slug}`; }
function projectId(programSlug: string, projectSlug: string): string { return `project:${programSlug}/${projectSlug}`; }
function noteNodeId(targetId: string): string { return `note:${targetId}`; }
function mountNodeId(id: string): string { return id.startsWith('mount:') ? id : `mount:${id}`; }

function parseProgramId(id: string): string | null {
  return id.startsWith('program:') ? id.slice('program:'.length) : null;
}
function parseProjectId(id: string): { programSlug: string; projectSlug: string } | null {
  if (!id.startsWith('project:')) return null;
  const rest = id.slice('project:'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { programSlug: rest.slice(0, slash), projectSlug: rest.slice(slash + 1) };
}
type NotesLocation =
  | { kind: 'program'; programSlug: string; notesRelative: string }
  | { kind: 'project'; programSlug: string; projectSlug: string; notesRelative: string };

function parseFolderId(id: string): NotesLocation | null {
  const projectMatch = id.match(/^folder:([^/]+)\/projects\/([^/]+)\/notes(?:\/(.+))?$/);
  if (projectMatch) {
    return {
      kind: 'project',
      programSlug: projectMatch[1]!,
      projectSlug: projectMatch[2]!,
      notesRelative: projectMatch[3] ? normalizeVaultRelative(projectMatch[3]) : '',
    };
  }
  const programMatch = id.match(/^folder:([^/]+)\/notes(?:\/(.+))?$/);
  if (programMatch) {
    return {
      kind: 'program',
      programSlug: programMatch[1]!,
      notesRelative: programMatch[2] ? normalizeVaultRelative(programMatch[2]) : '',
    };
  }
  return null;
}

function notesAbsolute(root: string, location: NotesLocation): string {
  if (location.kind === 'project') {
    const base = `${VAULT_PATHS.programs}/${location.programSlug}/projects/${location.projectSlug}/notes`;
    return resolveUnderVault(root, location.notesRelative ? `${base}/${location.notesRelative}` : base);
  }
  const base = `${VAULT_PATHS.programs}/${location.programSlug}/notes`;
  return resolveUnderVault(root, location.notesRelative ? `${base}/${location.notesRelative}` : base);
}

function notesDestinationRelative(location: NotesLocation, fileSlug: string): string {
  const slug = slugify(fileSlug);
  if (location.kind === 'project') {
    const base = `${VAULT_PATHS.programs}/${location.programSlug}/projects/${location.projectSlug}/notes`;
    return normalizeVaultRelative(location.notesRelative ? `${base}/${location.notesRelative}/${slug}.note.json` : `${base}/${slug}.note.json`);
  }
  const base = `${VAULT_PATHS.programs}/${location.programSlug}/notes`;
  return normalizeVaultRelative(location.notesRelative ? `${base}/${location.notesRelative}/${slug}.note.json` : `${base}/${slug}.note.json`);
}

function folderNodeId(location: NotesLocation): string {
  if (location.kind === 'project') {
    const base = `folder:${location.programSlug}/projects/${location.projectSlug}/notes`;
    return location.notesRelative ? `${base}/${location.notesRelative}` : base;
  }
  const base = `folder:${location.programSlug}/notes`;
  return location.notesRelative ? `${base}/${location.notesRelative}` : base;
}

function withFolderName(location: NotesLocation, folderSlug: string): NotesLocation {
  const notesRelative = location.notesRelative ? `${location.notesRelative}/${folderSlug}` : folderSlug;
  return location.kind === 'project'
    ? { ...location, notesRelative }
    : { ...location, notesRelative };
}

export type VaultWorkspaceStoreOptions = {
  vaultRoot?: string;
  /** Vault conversation placement used for move/remove/instruction of chats. */
  conversations?: WorkspaceConversationPlacement;
};

/**
 * Workspace catalog authority from vault directories + `.air/settings/workspace.yaml`.
 * Unfiled notes live under `programs/general/notes/`.
 */
export function createVaultWorkspaceStore(vaultRootOrOptions: string | VaultWorkspaceStoreOptions = {}): WorkspaceStore {
  const options: VaultWorkspaceStoreOptions = typeof vaultRootOrOptions === 'string'
    ? { vaultRoot: vaultRootOrOptions }
    : vaultRootOrOptions;
  const root = resolveVaultRoot(options.vaultRoot);
  ensureVaultLayout(root);
  const conversations = options.conversations ?? null;

  const settingsPath = resolveUnderVault(root, VAULT_PATHS.workspaceSettings);
  const readSettings = (): WorkspaceSettings => {
    if (!existsSync(settingsPath)) return { ...DEFAULT_WORKSPACE_SETTINGS, mounts: [] };
    return parseWorkspaceSettings(readFileSync(settingsPath, 'utf8'));
  };
  const writeSettings = (settings: WorkspaceSettings): void => {
    writeYamlSettings(settingsPath, settings);
  };

  const ensureGeneral = (): string => {
    const absolute = resolveUnderVault(root, `${VAULT_PATHS.programs}/general`);
    mkdirSync(join(absolute, 'notes'), { recursive: true });
    mkdirSync(join(absolute, 'projects'), { recursive: true });
    mkdirSync(join(absolute, 'chats'), { recursive: true });
    if (!existsSync(join(absolute, 'instruction.md'))) writeInstruction(absolute, 'General', '');
    return programId('general');
  };

  const listPrograms = (): WorkspaceNode[] => {
    const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
    if (!existsSync(programsRoot)) return [];
    const settings = readSettings();
    const nodes: WorkspaceNode[] = [];
    for (const entry of readdirSync(programsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name;
      const absolute = join(programsRoot, slug);
      const times = directoryTimes(absolute);
      const meta = readTitleAndInstruction(absolute, slug === 'general' ? 'General' : slug);
      nodes.push({
        id: programId(slug),
        kind: 'program',
        parentId: null,
        name: meta.name,
        instruction: meta.instruction,
        order: 0,
        createdAt: times.createdAt,
        updatedAt: times.updatedAt,
      });
    }
    const sortIds = settings.sortProgramIds ?? [];
    nodes.sort((a, b) => {
      const ai = sortIds.indexOf(a.id);
      const bi = sortIds.indexOf(b.id);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    nodes.forEach((node, index) => { node.order = index; });
    return nodes;
  };

  const listProjects = (programSlug: string, programNodeId: string): WorkspaceNode[] => {
    const projectsRoot = resolveUnderVault(root, `${VAULT_PATHS.programs}/${programSlug}/projects`);
    if (!existsSync(projectsRoot)) return [];
    const nodes: WorkspaceNode[] = [];
    for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = join(projectsRoot, entry.name);
      const times = directoryTimes(absolute);
      const meta = readTitleAndInstruction(absolute, entry.name);
      nodes.push({
        id: projectId(programSlug, entry.name),
        kind: 'project',
        parentId: programNodeId,
        name: meta.name,
        instruction: meta.instruction,
        order: 0,
        createdAt: times.createdAt,
        updatedAt: times.updatedAt,
      });
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    nodes.forEach((node, index) => { node.order = index; });
    return nodes;
  };

  const walkNotes = (
    absoluteNotesRoot: string,
    folderIdPrefix: string,
    parentNodeId: string,
    nodes: WorkspaceNode[],
  ): void => {
    if (!existsSync(absoluteNotesRoot)) return;
    const walk = (absoluteDir: string, relativeDir: string, parentId: string): void => {
      const entries = readdirSync(absoluteDir, { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.note.json')).sort((a, b) => a.name.localeCompare(b.name));
      let order = 0;
      for (const entry of directories) {
        const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const absolute = join(absoluteDir, entry.name);
        const times = directoryTimes(absolute);
        const id = `${folderIdPrefix}/${normalizeVaultRelative(rel)}`;
        const meta = readTitleAndInstruction(absolute, entry.name);
        nodes.push({
          id,
          kind: 'folder',
          parentId,
          name: meta.name,
          instruction: meta.instruction,
          order: order++,
          createdAt: times.createdAt,
          updatedAt: times.updatedAt,
        });
        walk(absolute, rel, id);
      }
      for (const entry of files) {
        const absolute = join(absoluteDir, entry.name);
        const relativePath = toVaultRelative(root, absolute);
        let envelope: ReturnType<typeof parseNoteJson>;
        try {
          envelope = parseNoteJson(readFileSync(absolute, 'utf8'));
        } catch (error) {
          throw new WorkspaceError(
            `Corrupt note JSON at ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
            'invalid',
          );
        }
        const times = directoryTimes(absolute);
        nodes.push({
          id: noteNodeId(relativePath),
          kind: 'note',
          parentId,
          name: envelope.title || basename(entry.name, '.note.json'),
          instruction: '',
          targetId: relativePath,
          order: order++,
          createdAt: times.createdAt,
          updatedAt: envelope.updatedAt || times.updatedAt,
        });
      }
    };
    walk(absoluteNotesRoot, '', parentNodeId);
  };

  const listNoteTree = (programSlug: string, programNodeId: string): WorkspaceNode[] => {
    const nodes: WorkspaceNode[] = [];
    walkNotes(
      resolveUnderVault(root, `${VAULT_PATHS.programs}/${programSlug}/notes`),
      `folder:${programSlug}/notes`,
      programNodeId,
      nodes,
    );
    const projectsRoot = resolveUnderVault(root, `${VAULT_PATHS.programs}/${programSlug}/projects`);
    if (existsSync(projectsRoot)) {
      for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        walkNotes(
          join(projectsRoot, entry.name, 'notes'),
          `folder:${programSlug}/projects/${entry.name}/notes`,
          projectId(programSlug, entry.name),
          nodes,
        );
      }
    }
    return nodes;
  };

  const listMounts = (): WorkspaceNode[] => {
    const settings = readSettings();
    return settings.mounts.map((mount, index) => {
      const times = directoryTimes(root);
      return {
        id: mountNodeId(mount.id),
        kind: 'mount' as const,
        parentId: mount.parentId ?? null,
        name: mount.label,
        instruction: '',
        rootId: mount.rootId,
        order: index,
        createdAt: times.createdAt,
        updatedAt: times.updatedAt,
      };
    });
  };

  const list = (): WorkspaceNode[] => {
    ensureGeneral();
    const programs = listPrograms();
    const nodes: WorkspaceNode[] = [...programs];
    for (const program of programs) {
      const slug = parseProgramId(program.id)!;
      nodes.push(...listProjects(slug, program.id));
      nodes.push(...listNoteTree(slug, program.id));
    }
    nodes.push(...listMounts());
    return nodes;
  };

  const get = (id: string): WorkspaceNode | null => list().find((node) => node.id === id) ?? null;

  const validParent = (parentId: string | null): void => {
    if (parentId === null) return;
    const parent = get(parentId);
    if (!parent || parent.kind === 'mount') throw new WorkspaceError('Choose an existing program, project, folder or note.', 'invalid-parent');
  };

  const validName = (name: string, instruction: string): string => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 200 || instruction.length > 20000) {
      throw new WorkspaceError('Enter a name of at most 200 characters and instructions of at most 20,000 characters.', 'invalid');
    }
    return trimmed;
  };

  const duplicate = (name: string, parentId: string | null, except: ReadonlySet<string>): void => {
    if (list().some((node) => !except.has(node.id) && node.parentId === parentId && node.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
    }
  };

  const absoluteForProgram = (slug: string): string => resolveUnderVault(root, `${VAULT_PATHS.programs}/${slug}`);
  const absoluteForProject = (programSlug: string, projectSlug: string): string =>
    resolveUnderVault(root, `${VAULT_PATHS.programs}/${programSlug}/projects/${projectSlug}`);
  const noteJsonPathForTarget = (targetId: string): string | null => {
    const normalized = normalizeVaultRelative(targetId.replace(/^note:/, ''));
    if (normalized.endsWith('.note.json')) {
      const absolute = resolveUnderVault(root, normalized);
      return existsSync(absolute) ? normalized : null;
    }
    const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
    const stack = [programsRoot];
    while (stack.length) {
      const current = stack.pop()!;
      if (!existsSync(current)) continue;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const target = join(current, entry.name);
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile() && entry.name.endsWith('.note.json')) {
          const relative = toVaultRelative(root, target);
          let envelope: ReturnType<typeof parseNoteJson>;
          try {
            envelope = parseNoteJson(readFileSync(target, 'utf8'));
          } catch (error) {
            throw new WorkspaceError(
              `Corrupt note JSON at ${relative}: ${error instanceof Error ? error.message : String(error)}`,
              'invalid',
            );
          }
          if (envelope.id === targetId || envelope.id === normalized) return relative;
        }
      }
    }
    return null;
  };

  const moveNoteFiles = (targetId: string, destinationJsonRelative: string): void => {
    const current = noteJsonPathForTarget(targetId);
    if (!current) throw new WorkspaceError('This note already has a location or has no document ID.', 'missing');
    if (current === destinationJsonRelative) return;
    const fromJson = resolveUnderVault(root, current);
    const toJson = resolveUnderVault(root, destinationJsonRelative);
    const fromMd = fromJson.replace(/\.note\.json$/, '.md');
    const toMd = toJson.replace(/\.note\.json$/, '.md');
    if (existsSync(toJson)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
    mkdirSync(dirname(toJson), { recursive: true });
    renameSync(fromJson, toJson);
    if (existsSync(fromMd)) {
      mkdirSync(dirname(toMd), { recursive: true });
      renameSync(fromMd, toMd);
    }
  };

  const parentNotesDirectory = (parentId: string | null): NotesLocation => {
    if (parentId === null) return { kind: 'program', programSlug: 'general', notesRelative: '' };
    const programSlug = parseProgramId(parentId);
    if (programSlug) return { kind: 'program', programSlug, notesRelative: '' };
    const project = parseProjectId(parentId);
    if (project) return { kind: 'project', programSlug: project.programSlug, projectSlug: project.projectSlug, notesRelative: '' };
    const folder = parseFolderId(parentId);
    if (folder) return folder;
    const parent = get(parentId);
    if (parent?.kind === 'note') return parentNotesDirectory(parent.parentId);
    throw new WorkspaceError('Choose an existing program, project, folder or note.', 'invalid-parent');
  };

  const uniqueDestination = (location: NotesLocation, fileSlug: string): string => {
    let relative = notesDestinationRelative(location, fileSlug);
    let suffix = 2;
    const baseSlug = slugify(fileSlug);
    while (existsSync(resolveUnderVault(root, relative))) {
      relative = notesDestinationRelative(location, `${baseSlug}-${suffix++}`);
    }
    return relative;
  };

  const descendants = (id: string): Set<string> => {
    const nodes = list();
    const ids = new Set([id]);
    const pending = [id];
    while (pending.length) {
      const parent = pending.pop()!;
      for (const node of nodes) if (node.parentId === parent && !ids.has(node.id)) { ids.add(node.id); pending.push(node.id); }
    }
    return ids;
  };

  const store: WorkspaceStore = {
    list,
    get,
    create: (input: WorkspaceNodeInput) => {
      ensureGeneral();
      const instruction = input.instruction ?? '';
      const name = validName(input.name, instruction);
      if (input.kind === 'program') {
        const slug = slugify(name);
        const absolute = absoluteForProgram(slug);
        if (existsSync(absolute)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
        mkdirSync(join(absolute, 'notes'), { recursive: true });
        mkdirSync(join(absolute, 'projects'), { recursive: true });
        mkdirSync(join(absolute, 'chats'), { recursive: true });
        writeInstruction(absolute, name, instruction);
        const created = get(programId(slug));
        if (!created) throw new WorkspaceError('The workspace item could not be created.', 'invalid');
        return created;
      }
      if (input.kind === 'project') {
        const parentId = input.parentId ?? ensureGeneral();
        validParent(parentId);
        const programSlug = parseProgramId(parentId);
        if (!programSlug) throw new WorkspaceError('Move this project into a program.', 'invalid-parent');
        duplicate(name, parentId, new Set());
        const projectSlug = slugify(name);
        const absolute = absoluteForProject(programSlug, projectSlug);
        if (existsSync(absolute)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
        mkdirSync(join(absolute, 'notes'), { recursive: true });
        writeInstruction(absolute, name, instruction);
        const created = get(projectId(programSlug, projectSlug));
        if (!created) throw new WorkspaceError('The workspace item could not be created.', 'invalid');
        return created;
      }
      if (input.kind === 'folder') {
        validParent(input.parentId);
        duplicate(name, input.parentId, new Set());
        const location = withFolderName(parentNotesDirectory(input.parentId), slugify(name));
        const absolute = notesAbsolute(root, location);
        if (existsSync(absolute)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
        mkdirSync(absolute, { recursive: true });
        writeInstruction(absolute, name, instruction);
        const created = get(folderNodeId(location));
        if (!created) throw new WorkspaceError('The workspace item could not be created.', 'invalid');
        return created;
      }
      if (input.kind === 'note') {
        if (!input.targetId.trim()) throw new WorkspaceError('This note already has a location or has no document ID.', 'duplicate');
        const parentId = input.parentId ?? ensureGeneral();
        validParent(parentId);
        duplicate(name, parentId, new Set([noteNodeId(input.targetId)]));
        const location = parentNotesDirectory(parentId);
        const existingPath = noteJsonPathForTarget(input.targetId);
        if (!existingPath) throw new WorkspaceError('This note already has a location or has no document ID.', 'missing');
        // Path-first seeds may already write the note under the parent notes folder.
        // Keep that path instead of bumping to name-2 because the same file exists.
        const ideal = notesDestinationRelative(location, name);
        const destination = existingPath === ideal || !existsSync(resolveUnderVault(root, ideal))
          ? ideal
          : uniqueDestination(location, name);
        moveNoteFiles(input.targetId, destination);
        const created = get(noteNodeId(destination));
        if (!created) throw new WorkspaceError('The workspace item could not be created.', 'invalid');
        return created;
      }
      if (input.kind === 'mount') {
        if (!input.rootId.trim()) throw new WorkspaceError('Choose an authorized local folder.', 'invalid');
        validParent(input.parentId);
        const settings = readSettings();
        const id = mountNodeId(input.id.trim() || crypto.randomUUID());
        if (settings.mounts.some((mount) => mountNodeId(mount.id) === id)) {
          const existing = get(id);
          if (existing) return existing;
        }
        settings.mounts.push({ id, rootId: input.rootId, label: name, parentId: input.parentId });
        writeSettings(settings);
        const created = get(id);
        if (!created) throw new WorkspaceError('The workspace item could not be created.', 'invalid');
        return created;
      }
      throw new WorkspaceError('Choose a valid item type.', 'invalid');
    },
    update: (id, update) => {
      const current = get(id);
      if (!current) return null;
      const instruction = update.instruction ?? current.instruction;
      const name = validName(update.name ?? current.name, instruction);
      const parentId = update.parentId === undefined ? current.parentId : update.parentId;
      duplicate(name, parentId, new Set([id]));
      if (current.kind === 'program') {
        const slug = parseProgramId(current.id)!;
        writeInstruction(absoluteForProgram(slug), name, instruction);
        // Rename directory when the display name slug changes and it is not general.
        const nextSlug = slug === 'general' ? 'general' : slugify(name);
        if (nextSlug !== slug) {
          const from = absoluteForProgram(slug);
          const to = absoluteForProgram(nextSlug);
          if (existsSync(to)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
          renameSync(from, to);
          id = programId(nextSlug);
        }
      } else if (current.kind === 'project') {
        const parsed = parseProjectId(current.id)!;
        writeInstruction(absoluteForProject(parsed.programSlug, parsed.projectSlug), name, instruction);
        const nextSlug = slugify(name);
        if (nextSlug !== parsed.projectSlug) {
          const from = absoluteForProject(parsed.programSlug, parsed.projectSlug);
          const to = absoluteForProject(parsed.programSlug, nextSlug);
          if (existsSync(to)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
          renameSync(from, to);
          id = projectId(parsed.programSlug, nextSlug);
        }
      } else if (current.kind === 'folder') {
        const parsed = parseFolderId(current.id)!;
        writeInstruction(notesAbsolute(root, parsed), name, instruction);
      } else if (current.kind === 'mount') {
        const settings = readSettings();
        const mount = settings.mounts.find((item) => mountNodeId(item.id) === current.id);
        if (mount) {
          mount.label = name;
          writeSettings(settings);
        }
      } else if (current.kind === 'note') {
        // Note titles are owned by the note document; filing changes go through moveMany.
      }
      if (parentId !== current.parentId) store.moveMany({ ids: [id], parentId });
      return get(id);
    },
    moveMany: (move) => {
      validParent(move.parentId);
      const selected = new Set(move.ids);
      if (selected.size !== move.ids.length || selected.size === 0) throw new WorkspaceError('Choose distinct items to move.', 'invalid');
      const nodes = move.ids.map((id) => {
        const node = get(id);
        if (!node) throw new WorkspaceError('An item no longer exists.', 'missing');
        return node;
      });
      const top = nodes.filter((node) => !nodes.some((other) => other.id !== node.id && descendants(other.id).has(node.id)));
      for (const node of top) {
        if (node.kind === 'program' && move.parentId !== null) throw new WorkspaceError('Programs must remain at the top level.', 'invalid-parent');
        if (node.kind === 'project' && (!move.parentId || get(move.parentId)?.kind !== 'program')) throw new WorkspaceError('Move this project into a program.', 'invalid-parent');
        if (node.kind === 'folder' && move.parentId === null) throw new WorkspaceError('Move this folder into a program or project.', 'invalid-parent');
        if (move.parentId !== null && descendants(node.id).has(move.parentId)) throw new WorkspaceError('An item cannot be moved into itself or its descendants.', 'cycle');
        duplicate(node.name, move.parentId, new Set(top.map((item) => item.id)));
      }
      for (const node of top) {
        if (node.kind === 'note') {
          const location = parentNotesDirectory(move.parentId);
          const destination = uniqueDestination(location, node.name);
          moveNoteFiles(node.targetId, destination);
        } else if (node.kind === 'folder') {
          const parsed = parseFolderId(node.id)!;
          const destination = withFolderName(parentNotesDirectory(move.parentId), basename(parsed.notesRelative) || slugify(node.name));
          const from = notesAbsolute(root, parsed);
          const to = notesAbsolute(root, destination);
          if (from !== to) {
            if (existsSync(to)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
            mkdirSync(dirname(to), { recursive: true });
            renameSync(from, to);
          }
        } else if (node.kind === 'project') {
          const parsed = parseProjectId(node.id)!;
          const programSlug = parseProgramId(move.parentId!)!;
          const from = absoluteForProject(parsed.programSlug, parsed.projectSlug);
          const to = absoluteForProject(programSlug, parsed.projectSlug);
          if (from !== to) {
            if (existsSync(to)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
            mkdirSync(dirname(to), { recursive: true });
            renameSync(from, to);
          }
        } else if (node.kind === 'mount') {
          const settings = readSettings();
          const mount = settings.mounts.find((item) => mountNodeId(item.id) === node.id);
          if (mount) {
            mount.parentId = move.parentId;
            writeSettings(settings);
          }
        } else if (node.kind === 'program' && move.beforeId !== undefined) {
          const settings = readSettings();
          const programs = listPrograms().map((item) => item.id).filter((item) => item !== node.id);
          const before = move.beforeId ? programs.indexOf(move.beforeId) : programs.length;
          if (before < 0) throw new WorkspaceError('The target position no longer exists.', 'invalid');
          programs.splice(before, 0, node.id);
          settings.sortProgramIds = programs;
          writeSettings(settings);
        }
      }
      return list();
    },
    organize: (move) => {
      validParent(move.parentId);
      if (!move.ids.length && !move.chatIds.length && !move.notes.length) throw new WorkspaceError('Choose items to organize.', 'invalid');
      // Validate chats and note-name conflicts before any disk mutation so a failed organize leaves the tree unchanged.
      const chatIds = [...new Set(move.chatIds)];
      if (chatIds.length) {
        if (!conversations) throw new WorkspaceError('The selected chats no longer exist.', 'missing');
        for (const id of chatIds) {
          if (!conversations.load(id)) throw new WorkspaceError('A selected chat no longer exists.', 'missing');
        }
      }
      const noteNames = new Set<string>();
      for (const note of move.notes) {
        const key = note.name.toLocaleLowerCase();
        if (noteNames.has(key)) throw new WorkspaceError('An item with this name already exists here.', 'duplicate');
        noteNames.add(key);
        duplicate(note.name, move.parentId, new Set(move.notes.map((item) => noteNodeId(item.targetId))));
      }
      const ids = new Set(move.ids);
      for (const note of move.notes) {
        const existing = list().find((node) => node.kind === 'note' && node.targetId === note.targetId);
        if (existing) ids.add(existing.id);
        else {
          store.create({ id: note.id, kind: 'note', parentId: move.parentId, name: note.name, targetId: note.targetId });
          ids.add(noteNodeId(note.targetId));
        }
      }
      if (ids.size) store.moveMany({ ids: [...ids], parentId: move.parentId, beforeId: move.beforeId });
      if (chatIds.length) store.moveChats({ ids: chatIds, parentId: move.parentId });
      return list();
    },
    moveChats: (move) => {
      validParent(move.parentId);
      if (move.ids.length === 0 || new Set(move.ids).size !== move.ids.length) throw new WorkspaceError('Choose distinct chats to move.', 'invalid');
      if (!conversations) throw new WorkspaceError('The selected chats no longer exist.', 'missing');
      for (const id of move.ids) {
        if (!conversations.load(id)) throw new WorkspaceError('A selected chat no longer exists.', 'missing');
        conversations.setFolder(id, move.parentId);
      }
    },
    remove: (id, policy) => {
      const current = get(id);
      if (!current) return null;
      if (policy !== 'keep-chats' && policy !== 'delete-chats') throw new WorkspaceError('Choose what to do with the chats.', 'invalid');
      const ids = descendants(id);
      const nodes = list().filter((node) => ids.has(node.id));
      const chatIds: string[] = [];
      if (conversations) {
        for (const conversationId of conversations.idsInFolders([...ids])) {
          chatIds.push(conversationId);
          if (policy === 'delete-chats') conversations.delete(conversationId);
          else conversations.setFolder(conversationId, null);
        }
      }
      const notes = nodes.filter((node) => node.kind === 'note');
      const rootIds = nodes.filter((node) => node.kind === 'mount').map((node) => node.rootId);
      const general = ensureGeneral();
      for (const node of notes) {
        const location = parentNotesDirectory(general);
        const destination = uniqueDestination(location, node.name);
        try {
          moveNoteFiles(node.targetId, destination);
        } catch (error) {
          // Missing notes have nothing left to preserve; other failures must stop
          // before the program/project tree is deleted.
          if (error instanceof WorkspaceError && error.code === 'missing') continue;
          throw error;
        }
      }
      if (current.kind === 'program') {
        const slug = parseProgramId(current.id)!;
        if (slug === 'general') throw new WorkspaceError('The General program cannot be removed.', 'invalid');
        rmSync(absoluteForProgram(slug), { recursive: true, force: true });
      } else if (current.kind === 'project') {
        const parsed = parseProjectId(current.id)!;
        rmSync(absoluteForProject(parsed.programSlug, parsed.projectSlug), { recursive: true, force: true });
      } else if (current.kind === 'folder') {
        const parsed = parseFolderId(current.id)!;
        const folderAbsolute = notesAbsolute(root, parsed);
        if (existsSync(folderAbsolute)) rmSync(folderAbsolute, { recursive: true, force: true });
      } else if (current.kind === 'mount') {
        const settings = readSettings();
        settings.mounts = settings.mounts.filter((mount) => mountNodeId(mount.id) !== current.id);
        writeSettings(settings);
      }
      return { chatIds: chatIds.sort(), documentIds: notes.map((node) => node.targetId).sort(), rootIds: rootIds.sort() };
    },
    clearPersonalData: () => {
      const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
      if (existsSync(programsRoot)) {
        for (const entry of readdirSync(programsRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name === 'general') {
            const notes = join(programsRoot, 'general', 'notes');
            const projects = join(programsRoot, 'general', 'projects');
            if (existsSync(notes)) rmSync(notes, { recursive: true, force: true });
            if (existsSync(projects)) rmSync(projects, { recursive: true, force: true });
            mkdirSync(notes, { recursive: true });
            mkdirSync(projects, { recursive: true });
            writeInstruction(join(programsRoot, 'general'), 'General', '');
          } else {
            rmSync(join(programsRoot, entry.name), { recursive: true, force: true });
          }
        }
      }
      writeSettings({ ...DEFAULT_WORKSPACE_SETTINGS, mounts: [] });
      ensureGeneral();
    },
    instruction(conversationId) {
      if (!conversations) return '';
      const chat = conversations.load(conversationId);
      const instructions: string[] = [];
      const seen = new Set<string>();
      let node = chat?.folderId ? get(chat.folderId) : null;
      while (node && !seen.has(node.id)) {
        seen.add(node.id);
        if (node.instruction.trim()) instructions.unshift(node.instruction.trim());
        node = node.parentId ? get(node.parentId) : null;
      }
      return instructions.join('\n\n');
    },
    close: () => undefined,
  };

  ensureGeneral();
  return store;
}
