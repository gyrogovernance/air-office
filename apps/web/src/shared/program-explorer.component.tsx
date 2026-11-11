import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { dragAndDropFeature, hotkeysCoreFeature, keyboardDragAndDropFeature, renamingFeature, searchFeature, selectionFeature, syncDataLoaderFeature, type ItemInstance, type DragTarget } from '@headless-tree/core';
import { AssistiveTreeDescription, useTree } from '@headless-tree/react';
import { GlassScene, GlassContent, GlassToolbar, GlassToolbarButton } from '@glass-sdk/liquid-glass';
import { Button, Dropdown, SearchField, Tabs, type Selection } from '@heroui/react';
import type { WorkspaceNode } from '@office/workspace/domain';
import type { ConnectedRoot, FilesystemEntry, FilesystemTarget, TrashedEntry } from '@office/files/domain';
import type { FileSnapshot } from '@office/contracts/file';
import type { ConversationSummary } from '@office/chat/domain';
import { useAppDialogs } from './app-dialogs.component';
import type { ServiceClient } from './service-client.hook';
import { resetServiceDiscovery } from './service-endpoint.hook';
import { IconChevronDown, IconChevronRight, IconEdit, IconFile, IconFolder, IconMore, IconPlus, IconRefresh } from '../app/ui-icons.component';

const LIBRARY_VIEWS = [
  { id: 'files', label: 'Files' },
  { id: 'notes', label: 'Notes' },
  { id: 'search', label: 'Search' },
] as const;

type LibraryView = (typeof LIBRARY_VIEWS)[number]['id'];

function isLibraryView(value: unknown): value is LibraryView {
  return value === 'files' || value === 'notes' || value === 'search';
}

type Note = { id: string; title: string; path?: string };
type ExplorerGroup = 'programs' | 'projects' | 'notes' | 'chats' | 'imports';
type ExplorerItem = { id: string; name: string } & (
  | { kind: 'group'; group: ExplorerGroup }
  | { kind: 'collection'; collection: 'notes' | 'chats'; parentId: string }
  | { kind: 'node'; node: WorkspaceNode }
  | { kind: 'chat'; chat: ConversationSummary; recent: boolean }
  | { kind: 'note'; note: Note }
  | { kind: 'disk'; entry: FilesystemEntry }
  | { kind: 'import'; file: FileSnapshot }
);
export interface ProgramExplorerControls { connectFolder(parentId?: string): Promise<void>; createProgram(): Promise<void>; refresh(): Promise<void>; reveal(scopeId: string): void; }
interface Props {
  client: ServiceClient;
  appearance?: 'light' | 'dark';
  controlsRef?: Ref<ProgramExplorerControls>;
  /** Portal host beside the Library title for the view trigger and new action. */
  headerHost?: HTMLElement | null;
  notes: Note[];
  chats: ConversationSummary[];
  importedFiles: FileSnapshot[];
  activeNoteId: string | null;
  activeChatId: string | null;
  sending: boolean;
  onOpenNote(id: string): void;
  onOpenScope?(id?: string, section?: 'files' | 'instructions'): void;
  onOpenChat(id: string, messageId?: string | null): void;
  onOpenFile(target: FilesystemTarget): Promise<void>;
  onOpenImport(file: FileSnapshot): void;
  onCreateNote(title: string): Promise<Note>;
  onRenameNote(id: string, name: string): Promise<void>;
  onCloneNote(id: string): Promise<Note>;
  onTrashNote?(id: string): Promise<void>;
  onRestoreNote?(id: string): Promise<void>;
  onCreateChat(): Promise<string>;
  onChatAction(id: string, action: 'pin' | 'archive' | 'unread' | 'clone' | 'tags' | 'delete' | 'stage', confirmed?: boolean): Promise<void>;
  onRenameChat(id: string, name: string): Promise<void>;
  onChanged(): Promise<void>;
  onDiskMutation(target: FilesystemTarget, destination: FilesystemTarget | null): void;
  /** Retained for callers from the earlier explorer search API; library search is local-only. */
  onSearch?: (query: string, options?: { includeArchived?: boolean }) => Promise<unknown>;
}
const group = (name: ExplorerGroup) => `group:${name}`;
const nodeId = (id: string) => `node:${id}`;
const diskId = (target: FilesystemTarget) => `disk:${encodeURIComponent(JSON.stringify([target.rootId, target.path]))}`;
const directoryOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const joinPath = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
function container(item: ExplorerItem): boolean {
  return item.kind === 'group' || item.kind === 'collection' || item.kind === 'node' || item.kind === 'disk' && item.entry.kind === 'directory';
}
function workspaceParent(item: ExplorerItem): string | null | undefined {
  if (item.kind === 'collection') return item.parentId;
  if (item.kind === 'node' && item.node.kind !== 'mount') return item.node.id;
  if (item.kind === 'group' && (item.group === 'notes' || item.group === 'chats')) return null;
  return undefined;
}
function diskDirectory(item: ExplorerItem): FilesystemTarget | null {
  if (item.kind === 'node' && item.node.kind === 'mount') return { rootId: item.node.rootId, path: '' };
  return item.kind === 'disk' && item.entry.kind === 'directory' ? item.entry : null;
}
function documentId(item: ExplorerItem): string | null {
  if (item.kind === 'note') return item.note.path ?? item.note.id;
  if (item.kind === 'node' && item.node.kind === 'note') return item.node.targetId;
  return null;
}
function collectionType(item: ExplorerItem): 'notes' | 'chats' | null { return documentId(item) ? 'notes' : item.kind === 'chat' ? 'chats' : null; }

export function ProgramExplorer(props: Props) {
  const dialogs = useAppDialogs();
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [roots, setRoots] = useState<ConnectedRoot[]>([]);
  const [directories, setDirectories] = useState<Record<string, FilesystemEntry[]>>({});
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationActive = useRef(false);
  const [query, setQuery] = useState('');
  const [libraryView, setLibraryView] = useState<LibraryView>('files');
  const [treeView, setTreeView] = useState<'type' | 'location'>('location');
  const libraryViewLabel = LIBRARY_VIEWS.find((view) => view.id === libraryView)?.label ?? 'Files';
  const chooseLibraryView = (keys: Selection) => {
    const key = [...keys][0];
    if (!isLibraryView(key)) return;
    setLibraryView(key);
  };
  const [clipboard, setClipboard] = useState<{ items: ExplorerItem[]; operation: 'move' | 'copy' } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const modifierClick = useRef(false);
  const [expanded, setExpanded] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('air-office:explorer-expanded') ?? 'null'); if (Array.isArray(value) && value.every((id): id is string => typeof id === 'string')) return value; } catch { /* Expansion is optional; content remains service-owned. */ }
    return [group('programs'), group('projects'), group('notes'), group('chats'), group('imports')];
  });
  const loadedDirectories = useRef(new Set<string>());
  const seenCollections = useRef(new Set<string>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const uploadInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<FilesystemTarget | null>(null);
  const request = useCallback(<T,>(path: string, body?: unknown, method = 'POST') => props.client.json<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), [props.client]);
  const refresh = useCallback(async () => {
    const [catalog, connected] = await Promise.all([props.client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes'), props.client.json<{ roots: ConnectedRoot[] }>('/api/v1/external/roots')]);
    setNodes(catalog.nodes); setRoots(connected.roots); setCatalogReady(true);
  }, [props.client]);
  const loadDirectory = useCallback(async (target: FilesystemTarget, force = false) => {
    const id = diskId(target);
    const running = inflight.current.get(id);
    if (running) return running;
    if (loadedDirectories.current.has(id) && !force) return;
    const task = (async () => {
      try {
        const { entries } = await props.client.json<{ entries: FilesystemEntry[] }>(`/api/v1/external/children?${new URLSearchParams({ ...target })}`);
        loadedDirectories.current.add(id);
        setDirectories((current) => ({ ...current, [id]: entries }));
        setDirectoryErrors((current) => { const next = { ...current }; delete next[id]; return next; });
      } catch (reason) { setDirectoryErrors((current) => ({ ...current, [id]: reason instanceof Error ? reason.message : 'Folder unavailable.' })); }
      finally { inflight.current.delete(id); }
    })();
    inflight.current.set(id, task);
    return task;
  }, [props.client]);
  const run = async (action: () => Promise<void>) => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true); setError('');
    try { await action(); await refresh(); await props.onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The operation could not be completed.'); }
    finally { operationActive.current = false; setBusy(false); }
  };
  const [connectPhase, setConnectPhase] = useState<'waiting' | 'ready' | 'failed'>('waiting');
  const retryConnect = useCallback(() => {
    resetServiceDiscovery();
    setConnectPhase('waiting');
    setCatalogReady(false);
    setError('');
    void refresh().then(() => { setConnectPhase('ready'); setError(''); }).catch((reason: unknown) => {
      setConnectPhase('failed');
      setError(reason instanceof Error ? reason.message : 'Programs could not be loaded.');
    });
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    setConnectPhase('waiting');
    // resolveServiceBase already waits up to SERVICE_READY_DEADLINE_MS; one pass is enough.
    void refresh().then(() => {
      if (cancelled) return;
      setConnectPhase('ready');
      setError('');
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setConnectPhase('failed');
      setError(reason instanceof Error ? reason.message : 'Programs could not be loaded.');
    });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => {
    const onFocus = () => {
      if (connectPhase === 'failed') return;
      void refresh().then(() => { setConnectPhase('ready'); setError(''); }).catch(() => undefined);
      loadedDirectories.current.clear();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [connectPhase, refresh]);
  const index = useMemo(() => {
    const items = new Map<string, ExplorerItem>();
    const children = new Map<string, string[]>();
    const add = (item: ExplorerItem, parent: string) => { items.set(item.id, item); children.set(parent, [...children.get(parent) ?? [], item.id]); };
    const collection = (parentId: string, type: 'notes' | 'chats') => {
      const id = `collection:${type}:${parentId}`;
      if (!items.has(id)) add({ id, kind: 'collection', collection: type, parentId, name: type === 'notes' ? 'Notes' : 'Chats' }, nodeId(parentId));
      return id;
    };
    items.set('root', { id: 'root', kind: 'group', group: 'programs', name: 'Library' });
    add({ id: group('programs'), kind: 'group', group: 'programs', name: 'Programs' }, 'root');
    add({ id: group('projects'), kind: 'group', group: 'projects', name: 'Projects' }, 'root');
    add({ id: group('notes'), kind: 'group', group: 'notes', name: 'Notes' }, 'root');
    add({ id: group('chats'), kind: 'group', group: 'chats', name: 'Chats' }, 'root');
    const filedNotes = new Set<string>();
    for (const node of nodes.filter((node) => node.kind === 'note')) {
      filedNotes.add(node.targetId);
      const match = props.notes.find((note) => note.id === node.targetId || note.path === node.targetId);
      if (match) {
        filedNotes.add(match.id);
        if (match.path) filedNotes.add(match.path);
      }
    }
    const unfiled = props.notes.filter((note) => !filedNotes.has(note.id) && !(note.path && filedNotes.has(note.path)));
    for (const node of nodes) {
      const name = node.kind === 'note' ? props.notes.find((note) => note.id === node.targetId || note.path === node.targetId)?.title ?? node.name : node.name;
      add({ id: nodeId(node.id), kind: 'node', node, name }, node.parentId ? node.kind === 'note' ? collection(node.parentId, 'notes') : nodeId(node.parentId) : node.kind === 'program' ? group('programs') : node.kind === 'project' ? group('projects') : group('notes'));
    }
    for (const note of unfiled) add({ id: `note:${note.path ?? note.id}`, kind: 'note', note, name: note.title }, group('notes'));
    for (const chat of props.chats.filter((chat) => !chat.archivedAt)) {
      if (chat.folderId && nodes.some((node) => node.id === chat.folderId)) add({ id: `chat:${chat.id}`, kind: 'chat', chat, recent: false, name: chat.title }, collection(chat.folderId, 'chats'));
      else add({ id: `chat:${chat.id}`, kind: 'chat', chat, recent: false, name: chat.title }, group('chats'));
    }
    for (const node of nodes) {
      if (node.kind !== 'mount') continue;
      const walk = (target: FilesystemTarget, parent: string) => {
        for (const entry of directories[diskId(target)] ?? []) {
          const id = diskId(entry);
          add({ id, kind: 'disk', entry, name: entry.name }, parent);
          if (entry.kind === 'directory') walk(entry, id);
        }
      };
      walk({ rootId: node.rootId, path: '' }, nodeId(node.id));
    }
    if (props.importedFiles.length) {
      add({ id: group('imports'), kind: 'group', group: 'imports', name: 'Imported files' }, 'root');
      for (const file of props.importedFiles) add({ id: `import:${file.id}`, kind: 'import', file, name: file.name }, group('imports'));
    }
    if (libraryView === 'notes') {
      children.set('root', props.notes.map((note) => {
        const id = `note:${note.path ?? note.id}`;
        items.set(id, { id, kind: 'note', note, name: note.title });
        return id;
      }));
    } else if (treeView === 'type' || libraryView === 'search') {
      for (const [parent, ids] of children) children.set(parent, ids.filter((id) => {
        const item = items.get(id);
        return item && item.kind !== 'collection' && collectionType(item) === null;
      }));
      children.set(group('notes'), [...nodes.filter((node) => node.kind === 'note').map((node) => nodeId(node.id)), ...unfiled.map((note) => `note:${note.path ?? note.id}`)]);
      children.set(group('chats'), props.chats.filter((chat) => !chat.archivedAt).map((chat) => `chat:${chat.id}`));
      const unfiledContainers = nodes.filter((node) => node.parentId === null && node.kind === 'mount').map((node) => nodeId(node.id));
      children.set('root', [group('programs'), group('projects'), group('notes'), group('chats'), ...unfiledContainers, ...(props.importedFiles.length ? [group('imports')] : [])]);
    } else {
      const locations = nodes.filter((node) => node.kind === 'program' || node.kind === 'mount' && node.parentId === null).map((node) => nodeId(node.id));
      const unfiledNotes = (children.get(group('notes')) ?? []).filter((id) => { const item = items.get(id); return item && documentId(item) !== null; });
      children.set(group('notes'), unfiledNotes);
      children.set('root', [...locations, ...(unfiledNotes.length ? [group('notes')] : []), ...((children.get(group('chats'))?.length ?? 0) ? [group('chats')] : []), ...(props.importedFiles.length ? [group('imports')] : [])]);
    }
    const needle = libraryView === 'search' ? query.trim().toLocaleLowerCase() : '';
    if (needle) {
      const keep = new Set<string>(['root']);
      const parents = new Map<string, string>();
      for (const [parent, ids] of children) for (const id of ids) parents.set(id, parent);
      for (const item of items.values()) if (item.kind !== 'group' && item.kind !== 'collection' && item.kind !== 'chat' && item.name.toLocaleLowerCase().includes(needle)) {
        let id: string | undefined = item.id;
        while (id && !keep.has(id)) { keep.add(id); id = parents.get(id); }
      }
      for (const [id, ids] of children) children.set(id, ids.filter((child) => keep.has(child)));
    }
    return { items, children };
  }, [nodes, props.notes, props.chats, props.importedFiles, directories, query, catalogReady, libraryView, treeView]);
  const indexRef = useRef(index);
  useEffect(() => {
    const added = [...index.items.values()].filter((item) => item.kind === 'collection' && !seenCollections.current.has(item.id)).map((item) => item.id);
    if (!added.length) return;
    for (const id of added) seenCollections.current.add(id);
    setExpanded((current) => [...new Set([...current, ...added])]);
  }, [index]);
  const open = async (item: ExplorerItem) => {
    if (item.kind === 'node' && (item.node.kind === 'program' || item.node.kind === 'project')) { props.onOpenScope?.(item.node.id); return; }
    const note = documentId(item);
    if (note) props.onOpenNote(note);
    else if (item.kind === 'chat') props.onOpenChat(item.chat.id);
    else if (item.kind === 'disk' && item.entry.kind === 'file') await props.onOpenFile(item.entry);
    else if (item.kind === 'import') props.onOpenImport(item.file);
  };
  const createContainer = async (kind: 'program' | 'project') => {
    const name = await dialogs.prompt({ title: kind === 'program' ? 'New program' : 'New project', label: 'Name', submitLabel: 'Create' });
    if (!name?.trim()) return;
    const id = crypto.randomUUID();
    await request('/api/v1/workspace/nodes', { id, kind, name: name.trim() });
    setExpanded((current) => [...new Set([...current, group(kind === 'program' ? 'programs' : 'projects'), nodeId(id)])]);
  };
  const createProgram = () => createContainer('program');
  const createProject = () => createContainer('project');
  const connectFolder = async (parentId?: string) => {
    props.onOpenScope?.(parentId, 'files');
  };
  useImperativeHandle(props.controlsRef, () => ({
    createProgram: () => run(createProgram),
    connectFolder: (parentId) => run(() => connectFolder(parentId)),
    refresh,
    reveal: (scopeId: string) => {
      setTreeView('location');
      setExpanded((current) => {
        const ids = new Set(current);
        const node = nodes.find((item) => item.id === scopeId);
        let ancestor = node?.kind === 'program' ? group('programs') : null;
        let parent = node?.parentId;
        while (parent) {
          ids.add(nodeId(parent));
          parent = nodes.find((item) => item.id === parent)?.parentId ?? null;
        }
        if (ancestor) ids.add(ancestor);
        ids.add(nodeId(scopeId));
        return [...ids];
      });
    },
  }));
  const createItem = async (item: ExplorerItem, kind: 'folder' | 'note' | 'chat' | 'file') => {
    const external = diskDirectory(item);
    if (external) {
      const name = await dialogs.prompt({ title: kind === 'folder' ? 'New folder' : 'New file', label: 'Name', initialValue: kind === 'file' ? 'untitled.md' : '', submitLabel: 'Create' });
      if (!name?.trim()) return;
      await request('/api/v1/external/entries', { rootId: external.rootId, parentPath: external.path, name: name.trim(), kind: kind === 'folder' ? 'directory' : 'file' });
      await loadDirectory(external, true);
      return;
    }
    const parentId = workspaceParent(item);
    if (!parentId) throw new Error('Choose a program, project, folder or note first.');
    setExpanded((current) => [...new Set([...current, item.id])]);
    if (kind === 'chat') {
      const id = await props.onCreateChat();
      await request('/api/v1/workspace/move-chats', { ids: [id], parentId });
      return;
    }
    const name = await dialogs.prompt({ title: kind === 'folder' ? 'New folder' : 'New note', label: 'Name', submitLabel: 'Create' });
    if (!name?.trim()) return;
    const common = { id: crypto.randomUUID(), name: name.trim(), parentId };
    if (kind === 'folder') await request('/api/v1/workspace/nodes', { ...common, kind: 'folder' });
    else { const note = await props.onCreateNote(name.trim()); await request('/api/v1/workspace/nodes', { ...common, kind: 'note', targetId: note.path ?? note.id }); }
  };
  const rename = async (item: ExplorerItem, name: string) => {
    const normalized = name.trim(); if (!normalized || normalized === item.name) return;
    const note = documentId(item);
    if (note) await props.onRenameNote(note, normalized);
    if (item.kind === 'node') await request(`/api/v1/workspace/nodes/${encodeURIComponent(item.node.id)}`, { name: normalized }, 'PATCH');
    else if (item.kind === 'chat') await props.onRenameChat(item.chat.id, normalized);
    else if (item.kind === 'disk') {
      const destinationPath = joinPath(directoryOf(item.entry.path), normalized);
      await request('/api/v1/external/transfer', { ...item.entry, destinationPath, operation: 'move' });
      props.onDiskMutation(item.entry, { rootId: item.entry.rootId, path: destinationPath });
      await loadDirectory({ rootId: item.entry.rootId, path: directoryOf(item.entry.path) }, true);
    }
  };
  const move = async (sources: ExplorerItem[], destination: ExplorerItem, operation: 'move' | 'copy' = 'move', beforeId?: string) => {
    if (destination.kind === 'collection' && sources.some((source) => collectionType(source) !== destination.collection)) throw new Error(`Only ${destination.name.toLowerCase()} belong in this folder.`);
    if (destination.kind === 'group') {
      if ((destination.group === 'notes' || destination.group === 'chats') && sources.some((source) => collectionType(source) !== destination.group)) throw new Error(`Only ${destination.name.toLowerCase()} belong in this category.`);
      if ((destination.group === 'programs' || destination.group === 'projects') && sources.some((source) => source.kind !== 'node' || source.node.kind !== (destination.group === 'programs' ? 'program' : 'project'))) throw new Error(`Only ${destination.name.toLowerCase()} belong in this category.`);
    }
    const external = diskDirectory(destination);
    if (external) {
      if (sources.some((source) => source.kind !== 'disk')) throw new Error('Use Export to turn notes or chats into external files.');
      for (const source of sources) if (source.kind === 'disk') {
        const destinationPath = joinPath(external.path, source.entry.name);
        try { await request('/api/v1/external/transfer', { ...source.entry, destinationRootId: external.rootId, destinationPath, operation }); }
        finally { await loadDirectory(external, true); }
        if (operation === 'move') props.onDiskMutation(source.entry, { rootId: external.rootId, path: destinationPath });
        await loadDirectory({ rootId: source.entry.rootId, path: directoryOf(source.entry.path) }, true);
      }
      await loadDirectory(external, true);
      return;
    }
    let parentId = workspaceParent(destination);
    if (destination.kind === 'group' && (destination.group === 'programs' || destination.group === 'projects')) parentId = null;
    if (parentId === undefined) throw new Error('Choose a destination folder.');
    if (sources.some((source) => source.kind === 'disk' || source.kind === 'import' || source.kind === 'group' || source.kind === 'collection')) throw new Error('Choose individual items to move. Use a connected folder for file moves.');
    if (operation === 'copy' && sources.some((source) => !documentId(source))) throw new Error('Copy supports notes and files. Use Clone from the chat menu to copy a conversation.');
    const nodeIds: string[] = [], chats: string[] = [], notes: { id: string; targetId: string; name: string }[] = [];
    for (const source of sources) {
      if (source.kind === 'node') {
        if (operation === 'copy') {
          if (source.node.kind !== 'note') throw new Error('Copy currently supports notes and files. Use Move for folders.');
          const note = await props.onCloneNote(source.node.targetId);
          notes.push({ id: crypto.randomUUID(), name: note.title, targetId: note.path ?? note.id });
        } else nodeIds.push(source.node.id);
      } else if (source.kind === 'chat') { if (operation === 'copy') throw new Error('Use Clone from the chat menu to copy a conversation.'); chats.push(source.chat.id); }
      else if (source.kind === 'note') {
        const note = operation === 'copy' ? await props.onCloneNote(source.note.path ?? source.note.id) : source.note;
        notes.push({ id: crypto.randomUUID(), name: note.title, targetId: note.path ?? note.id });
      }
    }
    await request('/api/v1/workspace/organize', { ids: [...new Set(nodeIds)], chatIds: [...new Set(chats)], notes, parentId, beforeId: beforeId ?? null });
    setExpanded((current) => [...new Set([...current, destination.id])]);
  };
  const canDrop = (sources: ExplorerItem[], destination: ExplorerItem): boolean => {
    if (busy || !sources.length || sources.some((item) => item.kind === 'group' || item.kind === 'collection' || item.kind === 'import')) return false;
    if (destination.kind === 'collection' && sources.some((source) => collectionType(source) !== destination.collection)) return false;
    const external = diskDirectory(destination);
    if (external) return sources.every((source) => source.kind === 'disk' && (source.entry.rootId !== external.rootId || source.entry.path !== external.path && !external.path.startsWith(`${source.entry.path}/`)));
    if (destination.kind === 'group' && destination.group === 'programs') return sources.every((source) => source.kind === 'node' && source.node.kind === 'program');
    if (destination.kind === 'group' && destination.group === 'projects') return sources.every((source) => source.kind === 'node' && source.node.kind === 'project');
    if (destination.kind === 'group' && destination.group === 'chats') return sources.every((source) => source.kind === 'chat');
    if (destination.kind === 'group' && destination.group === 'notes') return sources.every((source) => documentId(source) !== null);
    if (sources.some((source) => source.kind === 'node' && source.node.kind === 'project')) return sources.every((source) => source.kind === 'node' && source.node.kind === 'project') && destination.kind === 'node' && destination.node.kind === 'program';
    if (workspaceParent(destination) === undefined || sources.some((source) => source.kind === 'disk' || source.kind === 'node' && source.node.kind === 'program')) return false;
    return sources.every((source) => {
      let current: WorkspaceNode | undefined = destination.kind === 'node' ? destination.node : destination.kind === 'collection' ? nodes.find((node) => node.id === destination.parentId) : undefined;
      while (current) { if (source.kind === 'node' && source.node.id === current.id) return false; current = nodes.find((node) => node.id === current?.parentId); }
      return true;
    });
  };
  const destinationFor = (target: DragTarget<ExplorerItem>) => target.item.getItemData();
  const visibleExpanded = useMemo(() => libraryView === 'search' && query.trim() ? [...index.children.keys()] : expanded, [libraryView, query, index, expanded]);
  const tree = useTree<ExplorerItem>({
    rootItemId: 'root',
    state: { expandedItems: visibleExpanded },
    setExpandedItems: (updater) => setExpanded((current) => { const next = typeof updater === 'function' ? updater(current) : updater; localStorage.setItem('air-office:explorer-expanded', JSON.stringify(next)); return next; }),
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => container(item.getItemData()),
    dataLoader: {
      getItem: (id) => { const item = indexRef.current.items.get(id); if (!item) throw new Error('Explorer item no longer exists.'); return item; },
      getChildren: (id) => indexRef.current.children.get(id) ?? []
    },
    onPrimaryAction: (item) => { if (modifierClick.current) return; if (!busy && !props.sending) void run(() => open(item.getItemData())); },
    canRename: (item) => { const data = item.getItemData(); return !busy && data.kind !== 'group' && data.kind !== 'collection' && data.kind !== 'import' && !(data.kind === 'disk' && data.entry.kind === 'symlink'); },
    onRename: (item, name) => { void run(() => rename(item.getItemData(), name)); },
    canReorder: libraryView === 'files' && treeView === 'location',
    canDrag: (items) => !busy && items.every((item) => !['group', 'collection', 'import'].includes(item.getItemData().kind)),
    canDrop: (items, target) => canDrop(items.map((item) => item.getItemData()), destinationFor(target)),
    onDrop: async (items, target) => { const before = 'childIndex' in target ? indexRef.current.children.get(target.item.getId())?.slice(target.childIndex).find((id) => id.startsWith('node:'))?.slice(5) : undefined; await run(() => move(items.map((item) => item.getItemData()), destinationFor(target), 'move', before)); },
    canDragForeignDragObjectOver: (data, target) => data.types.includes('Files') && !!diskDirectory(destinationFor(target)),
    canDropForeignDragObject: (data, target) => data.files.length > 0 && !!diskDirectory(destinationFor(target)),
    onDropForeignDragObject: async (data, target) => { const destination = diskDirectory(destinationFor(target)); if (destination) await run(() => uploadFiles(destination, Array.from(data.files))); },
    indent: 16,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, renamingFeature, searchFeature, dragAndDropFeature, keyboardDragAndDropFeature]
  });
  useLayoutEffect(() => {
    const state = tree.getState();
    indexRef.current = index;
    tree.applySubStateUpdate('selectedItems', state.selectedItems.filter((id) => index.items.has(id)));
    setSelectedCount(state.selectedItems.filter((id) => index.items.has(id)).length);
    if (state.focusedItem && !index.items.has(state.focusedItem)) tree.applySubStateUpdate('focusedItem', 'root');
    if (state.renamingItem && !index.items.has(state.renamingItem)) tree.applySubStateUpdate('renamingItem', null);
    if (state.dnd?.draggedItems?.some((item) => !index.items.has(item.getId()))) tree.applySubStateUpdate('dnd', null);
    tree.rebuildTree();
  }, [tree, index]);
  useEffect(() => { try { localStorage.setItem('air-office:explorer-expanded', JSON.stringify(expanded)); } catch { /* Navigation remains usable when preference storage is full. */ } }, [expanded]);
  useEffect(() => {
    for (const id of expanded) {
      const item = index.items.get(id);
      const target = item && diskDirectory(item);
      if (target) void loadDirectory(target);
    }
  }, [expanded, index, loadDirectory]);
  async function uploadFiles(target: FilesystemTarget, files: File[]) {
    for (const file of files) {
      const response = await props.client.request(`/api/v1/external/upload?${new URLSearchParams({ ...target, name: file.name })}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file });
      if (!response.ok) { const body: unknown = await response.json().catch(() => null); throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Could not import ${file.name}.`); }
    }
    await loadDirectory(target, true);
  }
  async function download(target: FilesystemTarget, name: string) {
    const response = await props.client.request(`/api/v1/external/download?${new URLSearchParams({ ...target })}`);
    if (!response.ok) throw new Error('This file could not be downloaded.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function remove(item: ExplorerItem, confirmed = false) {
    if (item.kind === 'disk') {
      if (!confirmed && !await dialogs.confirm({ title: 'Move to trash?', message: `${item.name} will move to AIR Office trash inside this connected folder. It can be restored.`, confirmLabel: 'Move to trash', destructive: true })) return;
      await request('/api/v1/external/trash', item.entry);
      props.onDiskMutation(item.entry, null);
      await loadDirectory({ rootId: item.entry.rootId, path: directoryOf(item.entry.path) }, true);
    } else if (item.kind === 'node') {
      let policy: 'keep-chats' | 'delete-chats' = 'keep-chats';
      const subtree = new Set([item.node.id]);
      for (let size = 0; size !== subtree.size;) { size = subtree.size; for (const node of nodes) if (node.parentId && subtree.has(node.parentId)) subtree.add(node.id); }
      const hasChats = props.chats.some((chat) => chat.folderId && subtree.has(chat.folderId));
      if (confirmed) policy = 'keep-chats';
      else if (hasChats) {
      const choice = await dialogs.choose({ title: 'Remove from Programs?', message: 'Notes and external files will be preserved. Choose what to do with the chats in this item and its nested folders.', options: [{ label: 'Keep chats in the chat list', value: 'keep-chats' }, { label: 'Delete these chats permanently', value: 'delete-chats', destructive: true }] });
        if (choice !== 'keep-chats' && choice !== 'delete-chats') return;
        policy = choice;
      } else {
      if (!await dialogs.confirm({ title: item.node.kind === 'mount' ? 'Disconnect folder?' : 'Remove from Programs?', message: item.node.kind === 'mount' ? 'The folder and all its files will stay on disk.' : 'Notes will stay in Library and chats will stay in the chat list. Connected folders and their files will stay on disk.', confirmLabel: item.node.kind === 'mount' ? 'Disconnect' : 'Remove', destructive: false })) return;
      }
      await request(`/api/v1/workspace/nodes/${encodeURIComponent(item.node.id)}`, { policy }, 'DELETE');
    } else if (item.kind === 'chat') await props.onChatAction(item.chat.id, 'delete', confirmed);
  }
  async function trashNote(id: string) {
    if (await dialogs.confirm({ title: 'Move note to trash?', message: 'This note can be restored from the Programs menu. Nested notes and chats will remain available, and unsaved drafts will be preserved.', confirmLabel: 'Move to trash', destructive: true })) await props.onTrashNote?.(id);
  }
  async function restoreTrash(target: FilesystemTarget) {
    const { entries } = await props.client.json<{ entries: TrashedEntry[] }>(`/api/v1/external/trash?${new URLSearchParams({ rootId: target.rootId })}`);
    if (!entries.length) { setError('This connected folder has no trashed items.'); return; }
    const id = await dialogs.choose({ title: 'Restore from trash', message: 'Choose the item to restore to its original location.', options: entries.map((entry) => ({ label: entry.originalPath, value: entry.id })) });
    if (!id) return;
    const { entry } = await request<{ entry: FilesystemEntry }>('/api/v1/external/restore', { id });
    await loadDirectory({ rootId: entry.rootId, path: directoryOf(entry.path) }, true);
  }
  const selection = (item: ItemInstance<ExplorerItem>) => item.isSelected() ? tree.getSelectedItems().map((selected) => selected.getItemData()) : [item.getItemData()];
  const selectedItems = () => tree.getSelectedItems().map((selected) => selected.getItemData());
  async function removeSelection(items: ExplorerItem[]) {
    const removable = items.filter((item) => item.kind === 'disk' || item.kind === 'node' || item.kind === 'chat' || documentId(item) !== null);
    if (!removable.length) return;
    if (removable.length === 1) {
      const [only] = removable;
      const note = only ? documentId(only) : null;
      if (note && props.onTrashNote) await trashNote(note);
      else if (only) await remove(only);
      return;
    }
    const notes = removable.filter((item) => documentId(item) !== null);
    const others = removable.filter((item) => documentId(item) === null);
    if (!await dialogs.confirm({ title: `Delete ${removable.length} items?`, message: 'Notes move to trash and can be restored. Chats are removed from your history. Connected folders and their files stay on disk.', confirmLabel: 'Delete', destructive: true })) return;
    for (const item of notes) await props.onTrashNote?.(documentId(item)!);
    for (const item of others) await remove(item, true);
    tree.setSelectedItems([]);
  }
  function menuItems(item: ItemInstance<ExplorerItem>) {
    const data = item.getItemData(), external = diskDirectory(data), parentId = workspaceParent(data), note = documentId(data);
    const action = (label: string, callback: () => Promise<void> | void, disabled = false, mutates = true) => <Dropdown.Item key={label} id={label} textValue={label} className="explorer-menu-item" isDisabled={busy || disabled} onAction={() => { if (mutates) void run(async () => { await callback(); }); else void callback(); }}>{label}</Dropdown.Item>;
    if (data.kind === 'collection') return <>
      {action(data.collection === 'notes' ? 'New note' : 'New chat', () => createItem(data, data.collection === 'notes' ? 'note' : 'chat'))}
      {clipboard && action('Paste here', async () => { await move(clipboard.items, data, clipboard.operation); if (clipboard.operation === 'move') setClipboard(null); })}
    </>;
    return <>
      {data.kind === 'group' && data.group === 'programs' && action('New program', createProgram)}
      {data.kind === 'group' && data.group === 'projects' && action('New project', createProject)}
      {data.kind === 'group' && data.group === 'programs' && props.onRestoreNote && action('Restore a trashed note…', async () => {
        const { documents } = await props.client.json<{ documents: Note[] }>('/api/v1/rich-documents/trash');
        if (!documents.length) { setError('There are no notes in trash.'); return; }
        const id = await dialogs.choose({ title: 'Restore note', message: 'Choose a note to restore to Library.', options: documents.map((note) => ({ label: note.title, value: note.path ?? note.id })) });
        if (id) await props.onRestoreNote?.(id);
      })}
      {data.kind === 'group' && data.group === 'chats' && action('New chat', async () => { await props.onCreateChat(); })}
      {data.kind === 'group' && data.group === 'notes' && action('New note', async () => { await props.onCreateNote('Untitled note'); })}
      {parentId && <>{action('New folder', () => createItem(data, 'folder'))}{action('New note', () => createItem(data, 'note'))}{action('New chat', () => createItem(data, 'chat'))}{action('Connect local folder…', () => connectFolder(parentId))}</>}
      {external && <>{action('New file', () => createItem(data, 'file'))}{action('New folder', () => createItem(data, 'folder'))}{action('Import files…', () => { uploadTarget.current = external; uploadInput.current?.click(); })}{action('Refresh folder', () => loadDirectory(external, true))}{action('Restore from trash…', () => restoreTrash(external))}</>}
      {data.kind === 'node' && (data.node.kind === 'program' || data.node.kind === 'project') && action(`Edit ${data.node.kind}`, () => props.onOpenScope?.(data.node.id), false, false)}
      {data.kind !== 'group' && action('Open', () => open(data), data.kind === 'node' && !note && data.node.kind !== 'program' && data.node.kind !== 'project' || data.kind === 'disk' && data.entry.kind !== 'file')}
      {item.canRename() && action('Rename', () => { item.startRenaming(); }, false, false)}
      {data.kind === 'node' && data.node.kind !== 'mount' && action('Edit instructions…', async () => { if (props.onOpenScope && (data.node.kind === 'program' || data.node.kind === 'project')) { props.onOpenScope(data.node.id, 'instructions'); return; } const instruction = await dialogs.prompt({ title: 'Instructions', label: 'Instructions inherited by chats inside this item', initialValue: data.node.instruction, submitLabel: 'Save', multiline: true }); if (instruction !== null) await request(`/api/v1/workspace/nodes/${encodeURIComponent(data.node.id)}`, { instruction }, 'PATCH'); })}
      {data.kind === 'chat' && <>{action('Open in stage', () => props.onChatAction(data.chat.id, 'stage'))}{action(data.chat.pinned ? 'Unpin' : 'Pin', () => props.onChatAction(data.chat.id, 'pin'))}{action('Tags…', () => props.onChatAction(data.chat.id, 'tags'))}{action('Mark unread', () => props.onChatAction(data.chat.id, 'unread'))}{action('Clone chat', () => props.onChatAction(data.chat.id, 'clone'))}{action(data.chat.archivedAt ? 'Restore chat' : 'Archive chat', () => props.onChatAction(data.chat.id, 'archive'))}</>}
      {note && action('Duplicate note', async () => { const copy = await props.onCloneNote(note); if (data.kind === 'node' && data.node.parentId) await request('/api/v1/workspace/nodes', { id: crypto.randomUUID(), kind: 'note', name: copy.title, parentId: data.node.parentId, targetId: copy.path ?? copy.id }); })}
      {note && props.onTrashNote && action('Move note to trash…', () => trashNote(note))}
      {data.kind !== 'group' && data.kind !== 'import' && <>{action('Cut', () => setClipboard({ items: selection(item), operation: 'move' }))}{(data.kind === 'disk' || note) && action('Copy', () => setClipboard({ items: selection(item), operation: 'copy' }))}</>}
      {(parentId !== undefined || external) && clipboard && action('Paste here', async () => { await move(clipboard.items, data, clipboard.operation); if (clipboard.operation === 'move') setClipboard(null); })}
      {data.kind === 'disk' && data.entry.kind === 'file' && action('Download', () => download(data.entry, data.name))}
      {data.kind === 'disk' && action('Copy relative path', () => navigator.clipboard.writeText(data.entry.path))}
      {data.kind === 'node' && data.node.kind === 'mount' && action('Copy folder path', () => { const node = data.node; if (node.kind === 'mount') return navigator.clipboard.writeText(roots.find((root) => root.id === node.rootId)?.path ?? ''); })}
        {(data.kind === 'disk' || data.kind === 'node' || data.kind === 'chat' || note) && action(selection(item).length > 1 ? `Delete ${selection(item).length} items...` : data.kind === 'disk' ? 'Move to trash...' : data.kind === 'node' && data.node.kind === 'mount' ? 'Disconnect...' : data.kind === 'chat' ? 'Delete chat...' : 'Remove from Programs...', () => removeSelection(selection(item)))}
    </>;
  }
  const libraryHeader = (
    <div className="sidebar-view-pill" role="group" aria-label="Library view actions">
      {libraryView !== 'search' && (
        <Button
          isIconOnly
          className="sidebar-view-new"
          variant="ghost"
          size="sm"
          aria-label={libraryView === 'notes' ? 'New note' : 'New program or project'}
          isDisabled={busy}
          onPress={() => void run(async () => {
            if (libraryView === 'notes') { await props.onCreateNote('Untitled note'); return; }
            const kind = await dialogs.choose({ title: 'New item', message: 'Create a program or project.', options: [{ label: 'Program', value: 'program' }, { label: 'Project', value: 'project' }] });
            if (kind === 'program' || kind === 'project') await createContainer(kind);
          })}
        ><IconPlus/></Button>
      )}
      <Dropdown>
        <Button className="chat-view-trigger" variant="ghost" size="sm" aria-label="Library view">
          <span className="chat-view-trigger-label">{libraryViewLabel}</span>
          <IconChevronDown className="chat-view-trigger-chevron" aria-hidden="true"/>
        </Button>
        <Dropdown.Popover className="chat-view-popover" placement="bottom end">
          <Dropdown.Menu
            aria-label="Library view"
            className="chat-view-menu"
            selectionMode="single"
            selectedKeys={new Set([libraryView])}
            onSelectionChange={chooseLibraryView}
          >
            {LIBRARY_VIEWS.map((view) => (
              <Dropdown.Item key={view.id} id={view.id} textValue={view.label} className="chat-view-menu-item">
                {view.label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
  const explorerChromeOpen = !props.headerHost || libraryView === 'search' || libraryView === 'files';
  return <section className="program-explorer" data-library-view={libraryView} aria-label="Library programs, projects, notes and files" aria-busy={busy}>
    {props.headerHost ? createPortal(libraryHeader, props.headerHost) : null}
    {explorerChromeOpen && <div className="explorer-chrome">
      {!props.headerHost ? libraryHeader : null}
      {libraryView === 'search' && <SearchField className="explorer-search" aria-label="Search library" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input autoFocus placeholder="Search programs, projects, notes and files…" /><SearchField.ClearButton /></SearchField.Group></SearchField>}
      {libraryView === 'files' && <div className="explorer-view-toolbar">
        <GlassScene className="workspace-action-scene library-refresh-scene" appearance={props.appearance ?? 'light'} material="regular" maxSurfaces={1}>
          <GlassContent className="workspace-action-material sidebar-switch-material" aria-hidden="true"/>
          <GlassToolbar className="document-action-bar library-refresh-bar" aria-label="Refresh library" material="regular" radius="capsule" appearance={props.appearance ?? 'light'}>
            <GlassToolbarButton
              className="library-refresh-button"
              size="icon"
              aria-label="Refresh library"
              disabled={busy}
              onClick={() => void run(async () => { loadedDirectories.current.clear(); setDirectories({}); })}
            ><IconRefresh/></GlassToolbarButton>
          </GlassToolbar>
        </GlassScene>
        <Tabs selectedKey={treeView} onSelectionChange={(key) => { if (key === 'type' || key === 'location') setTreeView(key); }}>
          <Tabs.ListContainer>
            <Tabs.List aria-label="File organization">
              <Tabs.Tab id="type" className="whitespace-nowrap">By Type<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="location" className="whitespace-nowrap">By Location<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
      </div>}
    </div>}
    <div className="explorer-scroll" id="rail-left-files-scroll">
    {libraryView === 'search' && !query.trim() && <p className="explorer-empty">Search programs, projects, notes and files in your Library.</p>}
    {error && <div className="explorer-feedback" role="alert">{error}<Button isIconOnly variant="ghost" size="sm" onPress={() => setError('')} aria-label="Dismiss explorer error">×</Button></div>}
    {clipboard && <div className="explorer-clipboard" role="status">{clipboard.items.length} item{clipboard.items.length === 1 ? '' : 's'} ready to {clipboard.operation === 'move' ? 'move' : 'copy'}<Button variant="ghost" size="sm" onPress={() => setClipboard(null)}>Cancel</Button></div>}
    {selectedCount > 1 && <div className="explorer-clipboard explorer-selection" role="status">{selectedCount} selected<Button variant="danger-soft" size="sm" onPress={() => void run(() => removeSelection(selectedItems()))}>Delete</Button><Button variant="ghost" size="sm" onPress={() => tree.setSelectedItems([])}>Clear</Button></div>}
    <div {...tree.getContainerProps()} hidden={libraryView === 'search' && !query.trim()} aria-label={libraryView === 'notes' ? 'Library notes' : libraryView === 'search' ? 'Library search results' : 'Library files'} className="explorer-tree" onClickCapture={(event) => { modifierClick.current = event.ctrlKey || event.metaKey || event.shiftKey; }} onKeyDownCapture={(event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      if ((event.ctrlKey || event.metaKey) && ['x', 'c', 'v'].includes(event.key.toLowerCase())) {
        const focused = tree.getFocusedItem(); if (!focused) return;
        const data = focused.getItemData();
        if (event.key.toLowerCase() === 'v') { if (clipboard) { event.preventDefault(); void run(async () => { await move(clipboard.items, data, clipboard.operation); if (clipboard.operation === 'move') setClipboard(null); }); } }
        else if (data.kind !== 'group' && data.kind !== 'collection' && data.kind !== 'import') { event.preventDefault(); setClipboard({ items: selection(focused), operation: event.key.toLowerCase() === 'x' ? 'move' : 'copy' }); }
      }
      if (event.key === 'Delete') { const focused = tree.getFocusedItem(); if (focused) { event.preventDefault(); void run(() => removeSelection(selection(focused))); } }
    }}>
      {tree.getItems().map((item) => {
        const data = item.getItemData(), target = diskDirectory(data);
        const note = documentId(data);
        const selected = item.isSelected() || note !== null && note === props.activeNoteId || data.kind === 'chat' && data.chat.id === props.activeChatId;
        const Icon = data.kind === 'chat' ? IconChat : note ? IconEdit : container(data) ? IconFolder : IconFile;
        const unavailable = target && directoryErrors[diskId(target)];
        const groupRow = data.kind === 'group';
        const category = data.kind === 'group' && data.group !== 'imports' ? data.group : data.kind === 'node' && data.node.kind === 'program' ? 'programs' : data.kind === 'node' && data.node.kind === 'project' ? 'projects' : null;
        return <Dropdown key={item.getId()} trigger="contextMenu">
          <div {...item.getProps()} className={`explorer-row ${groupRow ? 'explorer-group' : ''} ${category ? `explorer-category explorer-category-${category}` : ''} ${data.kind === 'collection' ? `explorer-collection explorer-collection-${data.collection}` : ''} ${selected ? 'is-selected' : ''} ${item.isFocused() ? 'is-focused' : ''} ${item.isDragTarget() ? 'is-drop-target' : ''}`} style={{ paddingLeft: `${8 + Math.max(0, item.getItemMeta().level) * 16}px` }} title={unavailable || data.name}>
          <button type="button" tabIndex={-1} className="explorer-disclosure" aria-label={item.isExpanded() ? `Collapse ${data.name}` : `Expand ${data.name}`} style={{ visibility: container(data) ? 'visible' : 'hidden' }} onClick={(event) => { event.stopPropagation(); if (item.isExpanded()) item.collapse(); else item.expand(); }}><IconChevronRight className={item.isExpanded() ? 'expanded' : ''}/></button>
          {(!groupRow || category) && <Icon className="explorer-icon"/>}
          {item.isRenaming() ? <input {...item.getRenameInputProps()} aria-label={`Rename ${data.name}`} className="explorer-rename" onClick={(event) => event.stopPropagation()}/> : <span className="explorer-name">{data.name}</span>}
          {data.kind === 'node' && data.node.kind === 'mount' && <span className="explorer-badge" title="External folder on this computer">local</span>}
          {data.kind === 'chat' && data.chat.pinned && <span className="explorer-badge">pin</span>}
          {data.kind === 'chat' && data.chat.unreadAt && <span className="explorer-unread" aria-label="Unread"/>}
          {unavailable && <span className="explorer-badge" aria-label="Folder unavailable">!</span>}
          <Dropdown>
            <Dropdown.Trigger className="explorer-more" aria-label={`Options for ${data.name}`} onClick={(event) => event.stopPropagation()}><IconMore/></Dropdown.Trigger>
            <Dropdown.Popover className="explorer-menu-popover" placement="right top" offset={4}>
              <div onClick={(event) => event.stopPropagation()}>
                <Dropdown.Menu className="explorer-menu" aria-label={`Options for ${data.name}`}>{menuItems(item)}</Dropdown.Menu>
              </div>
            </Dropdown.Popover>
          </Dropdown>
          </div>
          <Dropdown.Popover className="explorer-menu-popover">
            <div onClick={(event) => event.stopPropagation()}>
              <Dropdown.Menu className="explorer-menu" aria-label={`Options for ${data.name}`}>{menuItems(item)}</Dropdown.Menu>
            </div>
          </Dropdown.Popover>
        </Dropdown>;
      })}
      <div className="explorer-drag-line" style={tree.getDragLineStyle()}/>
    </div>
    <AssistiveTreeDescription tree={tree}/>
    {!catalogReady && connectPhase !== 'failed' && <p className="explorer-empty" role="status">Waiting for AIR Office service…</p>}
    {!catalogReady && connectPhase === 'failed' && <div className="explorer-empty" role="alert">
      <p>{error || 'AIR Office service is unavailable.'}</p>
      <Button size="sm" variant="secondary" onPress={() => retryConnect()}>Retry</Button>
    </div>}
    {catalogReady && libraryView === 'files' && nodes.length === 0 && props.notes.length === 0 && props.chats.length === 0 && props.importedFiles.length === 0 && <div className="explorer-empty"><p>Organize notes, chats and connected folders in programs or projects.</p><button type="button" onClick={() => void run(createProgram)}>Create a program</button> <button type="button" onClick={() => void run(createProject)}>Create a project</button></div>}
    {catalogReady && libraryView === 'notes' && props.notes.length === 0 && <div className="explorer-empty"><p>Your notes appear here.</p><button type="button" onClick={() => void run(async () => { await props.onCreateNote('Untitled note'); })}>Create a note</button></div>}
    </div>
    <input ref={uploadInput} type="file" hidden multiple onChange={(event) => { const target = uploadTarget.current; const files = Array.from(event.target.files ?? []); event.target.value = ''; if (target && files.length) void run(() => uploadFiles(target, files)); }}/>
  </section>;
}
function IconChat({ className }: { className?: string }) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z"/></svg>; }
