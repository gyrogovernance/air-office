import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseJsonlLines, rewriteJsonlFile } from '@office/vault/jsonl';
import { atomicWriteText } from '@office/vault/atomic';
import { ensureVaultLayout } from '@office/vault/service';
import {
  conversationRelative,
  normalizeVaultRelative,
  programChatsDir,
  slugify,
  VAULT_PATHS,
} from '@office/vault/domain';
import {
  resolveUnderVault,
  resolveVaultRoot,
  toVaultRelative,
} from '@office/vault/host';
import { parseConversationSearch } from './conversation-search.policy';
import {
  appendMessage,
  createConversationGraph,
  setConversationMeta,
  updateMessage,
  type Conversation,
  type ConversationGraph,
  type ConversationListFilter,
  type ConversationMessage,
  type ConversationMessageInput,
  type ConversationMetaUpdate,
  type ConversationSearchResult,
  type ConversationSummary,
} from './conversation-graph.entity';
import { pageConversationHistory, type ConversationHistoryQuery } from './conversation-history.policy';
import type { ConversationStore } from './conversation-store.port';

const META_KEYS = ['title', 'pinned', 'archivedAt', 'tags', 'folderId', 'unreadAt', 'createdAt', 'updatedAt'] as const;

type ChatLocation = { programSlug: string; conversationId: string; dir: string; metaPath: string; messagesPath: string };

/** Map workspace folder/program/project ids to the owning program chats directory (general when unfiled or opaque). */
export function programSlugForFolderId(folderId: string | null | undefined): string {
  if (!folderId) return 'general';
  if (folderId.startsWith('program:')) {
    const slug = folderId.slice('program:'.length).trim();
    return slug ? slugify(slug) : 'general';
  }
  if (folderId.startsWith('project:')) {
    const rest = folderId.slice('project:'.length);
    const slash = rest.indexOf('/');
    if (slash > 0) return slugify(rest.slice(0, slash));
  }
  const projectFolder = /^folder:([^/]+)\/projects\//.exec(folderId);
  if (projectFolder?.[1]) return slugify(projectFolder[1]);
  const programFolder = /^folder:([^/]+)\/notes(?:\/|$)/.exec(folderId);
  if (programFolder?.[1]) return slugify(programFolder[1]);
  // Chats may be filed under a note; note ids are note:programs/<slug>/...
  const noteFolder = /^note:programs\/([^/]+)\//.exec(folderId);
  if (noteFolder?.[1]) return slugify(noteFolder[1]);
  return 'general';
}

function isMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === 'string'
    && typeof message.conversationId === 'string'
    && (message.parentId === null || typeof message.parentId === 'string')
    && typeof message.role === 'string'
    && typeof message.content === 'string'
    && typeof message.complete === 'boolean'
    && (message.runId === null || typeof message.runId === 'string')
    && typeof message.createdAt === 'string';
}

function parseMeta(raw: string, conversationId: string): Conversation {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (error) {
    throw new Error(`Invalid chat meta.yaml for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid chat meta.yaml for ${conversationId}.`);
  const data = parsed as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!META_KEYS.includes(key as typeof META_KEYS[number])) throw new Error(`Unknown chat meta key: ${key}`);
  }
  if (typeof data.title !== 'string' || typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') {
    throw new Error(`Chat meta.yaml missing required timestamps/title for ${conversationId}.`);
  }
  if (typeof data.pinned !== 'boolean') throw new Error(`Chat meta.pinned must be boolean for ${conversationId}.`);
  if (data.archivedAt !== null && data.archivedAt !== undefined && typeof data.archivedAt !== 'string') throw new Error('Invalid archivedAt.');
  if (data.unreadAt !== null && data.unreadAt !== undefined && typeof data.unreadAt !== 'string') throw new Error('Invalid unreadAt.');
  if (data.folderId !== null && data.folderId !== undefined && typeof data.folderId !== 'string') throw new Error('Invalid folderId.');
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== 'string'))) throw new Error('Invalid tags.');
  return {
    id: conversationId,
    title: data.title,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    pinned: data.pinned,
    archivedAt: (data.archivedAt as string | null | undefined) ?? null,
    tags: (data.tags as string[] | undefined) ?? [],
    folderId: (data.folderId as string | null | undefined) ?? null,
    unreadAt: (data.unreadAt as string | null | undefined) ?? null,
  };
}

function serializeMeta(conversation: Conversation): string {
  return Bun.YAML.stringify({
    title: conversation.title,
    pinned: conversation.pinned,
    archivedAt: conversation.archivedAt,
    tags: conversation.tags,
    folderId: conversation.folderId,
    unreadAt: conversation.unreadAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
}

function scanLocations(root: string): ChatLocation[] {
  const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
  if (!existsSync(programsRoot)) return [];
  const locations: ChatLocation[] = [];
  for (const program of readdirSync(programsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const chatsRoot = join(programsRoot, program.name, 'chats');
    if (!existsSync(chatsRoot)) continue;
    for (const conversation of readdirSync(chatsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const dir = join(chatsRoot, conversation.name);
      locations.push({
        programSlug: program.name,
        conversationId: conversation.name,
        dir,
        metaPath: join(dir, 'meta.yaml'),
        messagesPath: join(dir, 'messages.jsonl'),
      });
    }
  }
  return locations;
}

function findLocation(root: string, conversationId: string, index: Map<string, ChatLocation>): ChatLocation | null {
  const cached = index.get(conversationId);
  if (cached && existsSync(cached.metaPath)) return cached;
  const general = generalLocation(root, conversationId);
  if (existsSync(general.metaPath)) {
    index.set(conversationId, general);
    return general;
  }
  // Direct path check under each program (avoid listing every chat directory).
  const programsRoot = resolveUnderVault(root, VAULT_PATHS.programs);
  if (!existsSync(programsRoot)) return null;
  for (const program of readdirSync(programsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    if (program.name === 'general') continue;
    const dir = join(programsRoot, program.name, 'chats', conversationId);
    const metaPath = join(dir, 'meta.yaml');
    if (!existsSync(metaPath)) continue;
    const location: ChatLocation = {
      programSlug: program.name,
      conversationId,
      dir,
      metaPath,
      messagesPath: join(dir, 'messages.jsonl'),
    };
    index.set(conversationId, location);
    return location;
  }
  return null;
}

function locationAt(root: string, programSlug: string, conversationId: string): ChatLocation {
  const slug = slugify(programSlug);
  const dir = resolveUnderVault(root, conversationRelative(slug, conversationId));
  return {
    programSlug: slug,
    conversationId,
    dir,
    metaPath: join(dir, 'meta.yaml'),
    messagesPath: join(dir, 'messages.jsonl'),
  };
}

function generalLocation(root: string, conversationId: string): ChatLocation {
  return locationAt(root, 'general', conversationId);
}

function relocateChat(
  root: string,
  index: Map<string, ChatLocation>,
  current: ChatLocation,
  folderId: string | null,
  graph: ConversationGraph,
): ChatLocation {
  const target = locationAt(root, programSlugForFolderId(folderId), current.conversationId);
  if (current.dir === target.dir) {
    writeGraph(current, graph);
    return current;
  }
  writeGraph(current, graph);
  mkdirSync(dirname(target.dir), { recursive: true });
  if (existsSync(target.dir)) throw new Error(`Chat destination already exists under programs/${target.programSlug}/chats/.`);
  renameSync(current.dir, target.dir);
  index.set(current.conversationId, target);
  return target;
}

function loadGraphAt(location: ChatLocation): ConversationGraph | null {
  if (!existsSync(location.metaPath)) return null;
  const conversation = parseMeta(readFileSync(location.metaPath, 'utf8'), location.conversationId);
  const messages = existsSync(location.messagesPath)
    ? parseJsonlLines(readFileSync(location.messagesPath, 'utf8'), isMessage)
    : [];
  if (messages.some((message) => message.conversationId !== location.conversationId)) {
    throw new Error(`Conversation message identity mismatch in ${location.messagesPath}.`);
  }
  return { conversation, messages };
}

/** Sidebar listing only needs meta + a message count; avoid full JSONL parse. */
function loadSummaryAt(location: ChatLocation): ConversationSummary | null {
  if (!existsSync(location.metaPath)) return null;
  const conversation = parseMeta(readFileSync(location.metaPath, 'utf8'), location.conversationId);
  let messageCount = 0;
  if (existsSync(location.messagesPath)) {
    const raw = readFileSync(location.messagesPath, 'utf8');
    if (raw.length) messageCount = raw.trimEnd().split('\n').filter((line) => line.trim()).length;
  }
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount,
    pinned: conversation.pinned,
    archivedAt: conversation.archivedAt,
    tags: conversation.tags,
    folderId: conversation.folderId,
    unreadAt: conversation.unreadAt,
  };
}

function writeGraph(location: ChatLocation, graph: ConversationGraph): void {
  mkdirSync(location.dir, { recursive: true });
  atomicWriteText(location.metaPath, serializeMeta(graph.conversation));
  rewriteJsonlFile(location.messagesPath, graph.messages);
}

function toSummary(graph: ConversationGraph): ConversationSummary {
  return {
    id: graph.conversation.id,
    title: graph.conversation.title,
    updatedAt: graph.conversation.updatedAt,
    messageCount: graph.messages.length,
    pinned: graph.conversation.pinned,
    archivedAt: graph.conversation.archivedAt,
    tags: graph.conversation.tags,
    folderId: graph.conversation.folderId,
    unreadAt: graph.conversation.unreadAt,
  };
}

/** Vault-backed conversation store: `programs/<slug>/chats/<id>/{meta.yaml,messages.jsonl}`. Unfiled chats use `programs/general/`. */
export function createVaultConversationStore(root = resolveVaultRoot()): ConversationStore {
  ensureVaultLayout(root);
  const locationIndex = new Map<string, ChatLocation>();

  const load = (conversationId: string): ConversationGraph | null => {
    const location = findLocation(root, conversationId, locationIndex);
    return location ? loadGraphAt(location) : null;
  };

  const ensure = (conversationId: string): ConversationGraph => {
    const existing = load(conversationId);
    if (existing) return existing;
    const location = generalLocation(root, conversationId);
    locationIndex.set(conversationId, location);
    const graph = createConversationGraph(conversationId);
    writeGraph(location, graph);
    return graph;
  };

  const locationFor = (conversationId: string): ChatLocation => {
    const found = findLocation(root, conversationId, locationIndex);
    if (found) return found;
    const location = generalLocation(root, conversationId);
    locationIndex.set(conversationId, location);
    return location;
  };

  return {
    ensure,
    restore: (conversation) => {
      if (load(conversation.id)) return load(conversation.id)!;
      const location = locationAt(root, programSlugForFolderId(conversation.folderId), conversation.id);
      locationIndex.set(conversation.id, location);
      writeGraph(location, { conversation, messages: [] });
      return { conversation, messages: [] };
    },
    load,
    loadMeta: (conversationId) => {
      const location = findLocation(root, conversationId, locationIndex);
      if (!location || !existsSync(location.metaPath)) return null;
      return parseMeta(readFileSync(location.metaPath, 'utf8'), location.conversationId);
    },
    history: (conversationId, afterMessageId, limit) => {
      const graph = load(conversationId);
      if (!graph) return [];
      const bounded = Math.min(Math.max(limit, 1), 200);
      const ordered = graph.messages.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      if (afterMessageId === null) return ordered.slice(0, bounded);
      const index = ordered.findIndex((message) => message.id === afterMessageId);
      if (index < 0) return [];
      return ordered.slice(index + 1, index + 1 + bounded);
    },
    historyPage: (conversationId, query: ConversationHistoryQuery) => {
      const graph = load(conversationId);
      if (!graph) return null;
      return pageConversationHistory(graph, query);
    },
    summaries: (limit, offset = 0, filter: ConversationListFilter = {}) => {
      const rows = scanLocations(root)
        .map((location) => loadSummaryAt(location))
        .filter((summary): summary is ConversationSummary => summary !== null)
        .filter((summary) => {
          if (filter.archived === true && !summary.archivedAt) return false;
          if (filter.archived === false && summary.archivedAt) return false;
          if (filter.folderId === null && summary.folderId !== null) return false;
          if (filter.folderId !== undefined && filter.folderId !== null && summary.folderId !== filter.folderId) return false;
          if (filter.tag && !summary.tags.includes(filter.tag)) return false;
          return true;
        })
        .sort((left, right) => Number(right.pinned) - Number(left.pinned)
          || right.updatedAt.localeCompare(left.updatedAt)
          || left.id.localeCompare(right.id));
      return rows.slice(offset, offset + Math.min(Math.max(limit, 1), 500));
    },
    appendMessage: (input: ConversationMessageInput) => {
      let graph = ensure(input.conversationId);
      graph = appendMessage(graph, input);
      writeGraph(locationFor(input.conversationId), graph);
      return graph;
    },
    appendTurn: (input) => {
      const current = load(input.conversationId);
      if (!current) throw new Error('Unknown conversation');
      const user = current.messages.find((item) => item.id === input.userId);
      const assistant = current.messages.find((item) => item.id === input.assistantId);
      if (user || assistant) {
        if (!user || !assistant || user.role !== 'user' || user.parentId !== input.parentId || user.content !== input.content || JSON.stringify(user.attachments) !== JSON.stringify(input.attachments) || assistant.role !== 'assistant' || assistant.parentId !== user.id) {
          throw new Error('Turn identity already exists');
        }
        return current;
      }
      const withUser = appendMessage(current, { id: input.userId, parentId: input.parentId, role: 'user', content: input.content, complete: true, attachments: input.attachments });
      const graph = appendMessage(withUser, { id: input.assistantId, parentId: input.userId, role: 'assistant', content: '', complete: false });
      writeGraph(locationFor(input.conversationId), graph);
      return graph;
    },
    updateMessage: (conversationId, id, update) => {
      const graph = ensure(conversationId);
      const next = updateMessage(graph, id, update);
      writeGraph(locationFor(conversationId), next);
      return next;
    },
    deleteMessages: (conversationId, messageIds) => {
      const graph = ensure(conversationId);
      const remove = new Set(messageIds);
      const next = { ...graph, messages: graph.messages.filter((message) => !remove.has(message.id)) };
      writeGraph(locationFor(conversationId), next);
      return next;
    },
    rename: (conversationId, title) => {
      const graph = ensure(conversationId);
      const next = { ...graph, conversation: { ...graph.conversation, title, updatedAt: new Date().toISOString() } };
      writeGraph(locationFor(conversationId), next);
      return next;
    },
    setMeta: (conversationId, update: ConversationMetaUpdate) => {
      const graph = ensure(conversationId);
      const next = setConversationMeta(graph, update);
      next.conversation.updatedAt = new Date().toISOString();
      relocateChat(root, locationIndex, locationFor(conversationId), next.conversation.folderId, next);
      return next;
    },
    search: (query, options) => {
      const filter = parseConversationSearch(query);
      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
      const term = filter.text.trim().toLowerCase();
      const results: ConversationSearchResult[] = [];
      for (const location of scanLocations(root)) {
        const graph = loadGraphAt(location);
        if (!graph) continue;
        if (filter.archived !== undefined) {
          if (Boolean(graph.conversation.archivedAt) !== filter.archived) continue;
        } else if (!options?.includeArchived && graph.conversation.archivedAt) continue;
        if (filter.pinned !== undefined && graph.conversation.pinned !== filter.pinned) continue;
        if (filter.tags.some((tag) => !graph.conversation.tags.some((item) => item.toLowerCase() === tag.toLowerCase()))) continue;
        if (filter.folders.length) {
          const folderId = graph.conversation.folderId?.toLowerCase() ?? '';
          if (!filter.folders.some((folder) => folder.toLowerCase() === folderId)) continue;
        }
        const titleHit = term.length === 0 || graph.conversation.title.toLowerCase().includes(term);
        const matchedMessageIds = term.length === 0
          ? []
          : graph.messages.filter((message) => message.content.toLowerCase().includes(term)).map((message) => message.id);
        if (!titleHit && matchedMessageIds.length === 0) continue;
        results.push({ ...toSummary(graph), matchedMessageIds: matchedMessageIds.slice(0, 20) });
      }
      return results
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit);
    },
    delete: (conversationId) => {
      const location = findLocation(root, conversationId, locationIndex);
      if (!location) return;
      rmSync(location.dir, { recursive: true, force: true });
      locationIndex.delete(conversationId);
    },
    clearWorkspace: () => {
      const locations = scanLocations(root);
      for (const location of locations) rmSync(location.dir, { recursive: true, force: true });
      locationIndex.clear();
      return locations.length;
    },
    close: () => undefined,
  };
}

/** Adapts a ConversationStore into the narrow placement port workspace expects. */
export function workspaceConversationPlacement(store: ConversationStore): {
  load(conversationId: string): { folderId: string | null } | null;
  setFolder(conversationId: string, folderId: string | null): void;
  delete(conversationId: string): void;
  idsInFolders(folderIds: readonly string[]): string[];
} {
  return {
    load: (conversationId) => {
      const graph = store.load(conversationId);
      return graph ? { folderId: graph.conversation.folderId } : null;
    },
    setFolder: (conversationId, folderId) => { store.setMeta(conversationId, { folderId }); },
    delete: (conversationId) => { store.delete(conversationId); },
    idsInFolders: (folderIds) => {
      const wanted = new Set(folderIds);
      const ids: string[] = [];
      let offset = 0;
      for (;;) {
        const page = store.summaries(500, offset);
        if (!page.length) break;
        for (const item of page) if (item.folderId && wanted.has(item.folderId)) ids.push(item.id);
        if (page.length < 500) break;
        offset += page.length;
      }
      return ids;
    },
  };
}

export function conversationVaultRelativeDir(programSlug: string, conversationId: string): string {
  return normalizeVaultRelative(`${programChatsDir(programSlug)}/${conversationId}`);
}

export function conversationVaultPathHint(root: string, conversationId: string): string | null {
  const location = findLocation(root, conversationId, new Map());
  return location ? toVaultRelative(root, location.dir) : null;
}
