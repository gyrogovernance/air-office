import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CraftPackage, CraftRecord, MethodDefinition } from '@office/methods/domain';
import { parseCraftPackage } from '@office/methods/domain';
import {
  applyLabAppOverride,
  buildShippedSkill,
  DEFAULT_APP_ICONS,
  GADGET_AGENT_SYSTEM,
  buildDefaultLabKnowledgeFeed,
  buildGlossaryEntries,
  buildLabMethodDefinitions,
  catalogGadgets,
  DEFAULT_LAB_KNOWLEDGE_FEED_ID,
  documentIdForFeedEntry,
  frameworkFileSpecs,
  frameworkDocumentId,
  gadgetSystemPrompt,
  isAllowedFeedUrl,
  labMethodLedgerKeys,
  metaEvaluationReferenceFile,
  parseKnowledgeFeed,
  parseLabAppOverride,
  type FrameworkFileSpec,
  type FrameworkManifest,
  type GlossaryEntry,
  type KnowledgeFeed,
  type KnowledgeFeedEntry,
  type LabAppOverride,
  type LabGadget,
  type ShippedSkillSpec,
  type ShippedSkills,
  type StudioGadgets,
  type StudioWorkspace,
} from './lab-pack.domain.public';

export type LabAppDescriptor = Pick<LabGadget, 'id' | 'name' | 'description' | 'prompts'> & { system: string; runPrompts: string[]; edited: boolean; icon: string; custom: boolean };

const bundledPackRoot = join(process.env.OFFICE_RESOURCE_ROOT ?? join(dirname(process.execPath), 'resources'), 'lab-pack', 'data');
const packRoot = process.env.OFFICE_LAB_PACK_ROOT ?? (existsSync(join(bundledPackRoot, 'workspace-v1.json')) ? bundledPackRoot : join(dirname(fileURLToPath(import.meta.url)), '..', 'data'));

export type LabPackLedger = { version: string; installed: string[] };

export type MethodsSeedTarget = {
  get(id: string): MethodDefinition | null;
  save(definition: MethodDefinition): MethodDefinition;
};

export type KnowledgeSeedTarget = {
  hasCollection(id: string): boolean;
  createCollection(id: string, name: string): void;
  hasDocument(documentId: string): boolean;
  /**
   * True when the document exists and every one of its versions carries
   * extracted text. A document that is present but not extracted is not
   * installed, because without its text a search over the collection cannot
   * find anything.
   */
  isIndexed(documentId: string): boolean;
  ingest(input: { documentId: string; name: string; collectionId: string; bytes: Uint8Array }): { versionId: string; created: boolean };
  /**
   * Extracts the text of the source and stores it. The document is usable
   * once this succeeded, because a full-text search can reach it.
   */
  extract?(input: { collectionId: string; versionId: string; absolutePath: string; filename: string; bytes: Uint8Array }): Promise<void>;
  /**
   * Adds the source to the embedding index. This needs a selected embedding
   * model, so it can fail while the document itself is perfectly installed.
   */
  index?(input: { collectionId: string; versionId: string }): Promise<void>;
};

export type LabPackSeedResult = {
  methodsAdded: string[];
  knowledgeAdded: string[];
  skipped: string[];
  errors: string[];
  /**
   * The pending knowledge install, when the caller asked for it to run in the
   * background. Extracting the shipped PDFs takes seconds, and a caller that
   * answers a request must not wait for it.
   */
  knowledgeTask: Promise<void> | null;
};

export type FrameworkFile = FrameworkFileSpec & { absolutePath: string };

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(packRoot, name), 'utf8')) as T;
}

function readLedger(path: string): LabPackLedger {
  if (!existsSync(path)) return { version: 'v1', installed: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as LabPackLedger).installed)) return { version: 'v1', installed: [] };
    return { version: 'v1', installed: [...new Set((raw as LabPackLedger).installed.filter((item): item is string => typeof item === 'string'))] };
  } catch {
    return { version: 'v1', installed: [] };
  }
}

function writeLedger(path: string, ledger: LabPackLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: ledger.version, installed: [...ledger.installed].sort() }, null, 2)}\n`, 'utf8');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadLabMethodDefinitions(updatedAt = new Date().toISOString()): MethodDefinition[] {
  return buildLabMethodDefinitions(loadJson<StudioWorkspace>('workspace-v1.json'), loadJson<StudioGadgets>('gadgets-v1.json'), updatedAt);
}

/**
 * The skills that ship with the application, read from their manifest and
 * their SKILL.md bodies. They are installed like any other skill, so the user
 * can edit them, and they are installed again after a workspace reset.
 */
export function loadShippedSkillDefinitions(updatedAt = new Date().toISOString()): MethodDefinition[] {
  const manifest = loadJson<ShippedSkills>('skills-v1.json');
  return manifest.skills.map((spec) => {
    const path = join(packRoot, 'skills', spec.source);
    if (!existsSync(path)) throw new Error(`Missing shipped skill ${spec.id}.`);
    return buildShippedSkill(spec, readFileSync(path, 'utf8'), updatedAt);
  });
}

export function labFrameworkFiles(): FrameworkFile[] {
  return frameworkFileSpecs(loadJson<FrameworkManifest>('frameworks-v1.json')).map((file) => ({
    ...file,
    absolutePath: join(packRoot, 'frameworks', file.filename),
  }));
}

export function labPackDataRoot(): string {
  return packRoot;
}

export const OWASP_SECURE_AGENT_PLAYBOOK_CRAFT_ID = 'owasp-secure-agent-playbook';
export const NGO_PLAYBOOK_CRAFT_ID = 'ngo-playbook';

/** Optional composition Standards shipped under lab-pack/data/crafts/, Off until enabled. */
export function loadBundledCompositionCraftPackages(): CraftPackage[] {
  const craftsDir = join(packRoot, 'crafts');
  if (!existsSync(craftsDir)) return [];
  return readdirSync(craftsDir)
    .filter((name) => name.endsWith('.craft.json'))
    .sort()
    .map((name) => parseCraftPackage(readFileSync(join(craftsDir, name), 'utf8')));
}

export function seedBundledCompositionCrafts(store: { list(): CraftRecord[]; save(record: CraftRecord): CraftRecord }): CraftRecord[] {
  const seeded: CraftRecord[] = [];
  for (const craft of loadBundledCompositionCraftPackages()) {
    const existing = store.list().find((item) => item.package.id === craft.id);
    if (!existing) {
      seeded.push(store.save({ package: craft, bindings: {}, enabled: false }));
      continue;
    }
    if (JSON.stringify(existing.package) === JSON.stringify(craft)) continue;
    seeded.push(store.save({ ...existing, package: craft }));
  }
  return seeded;
}

export function readLabFrameworkText(filename: string): string {
  const path = join(packRoot, 'frameworks', filename);
  if (!existsSync(path)) throw new Error(`Missing Lab reference ${filename}.`);
  return readFileSync(path, 'utf8');
}

export function loadLabGadgets(): LabGadget[] {
  return catalogGadgets(loadJson<StudioGadgets>('gadgets-v1.json'));
}

export type LabAppOverrides = Record<string, LabAppOverride>;

/**
 * Apps catalog. `prompts` is the editable step text (base Studio text plus any
 * operator edit). `runPrompts` adds the meta-evaluation reference documents the
 * model needs at run time; the UI never displays it.
 */
export function loadLabApps(options: { overrides?: LabAppOverrides } = {}): LabAppDescriptor[] {
  const overrides = options.overrides ?? {};
  const builtins = loadLabGadgets().map((gadget) => {
    const merged = applyLabAppOverride(gadget, overrides[gadget.id]);
    return {
      ...gadget,
      name: merged.name,
      description: merged.description,
      prompts: merged.prompts,
      edited: merged.edited,
      custom: false,
      icon: overrides[gadget.id]?.icon ?? DEFAULT_APP_ICONS[gadget.id] ?? '✨',
      system: gadgetSystemPrompt(gadget.id),
      runPrompts: merged.prompts.map((base, index) => {
        if (gadget.id !== 'meta-evaluation') return base;
        const filename = metaEvaluationReferenceFile(index);
        if (!filename) return base;
        return `${base}\n\nReference document:\n${readLabFrameworkText(filename)}`;
      }),
    };
  });
  const custom = Object.entries(overrides).filter(([id]) => /^custom-[a-z0-9-]+$/.test(id)).map(([id, item]): LabAppDescriptor => ({ ...item, id, icon: item.icon ?? '✨', custom: true, edited: true, system: GADGET_AGENT_SYSTEM, runPrompts: [...item.prompts] }));
  return [...builtins, ...custom];
}

export function defaultLabAppOverridesPath(runtimeRoot: string): string {
  return join(runtimeRoot, 'lab-apps.overrides.json');
}

export function readLabAppOverrides(path: string): LabAppOverrides {
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return {};
    const overrides: LabAppOverrides = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      try {
        overrides[id] = parseLabAppOverride(value);
      } catch {
        // A malformed stored override falls back to the built-in Studio text.
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function writeLabAppOverride(path: string, appId: string, override: LabAppOverride): void {
  const overrides = readLabAppOverrides(path);
  overrides[appId] = override;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, ...overrides }, null, 2)}\n`, 'utf8');
}

export function removeLabAppOverride(path: string, appId: string): boolean {
  const overrides = readLabAppOverrides(path);
  if (!(appId in overrides)) return false;
  delete overrides[appId];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, ...overrides }, null, 2)}\n`, 'utf8');
  return true;
}

export function loadLabGlossary(): GlossaryEntry[] {
  const terms = readFileSync(join(packRoot, 'frameworks', 'THM_Terms.md'), 'utf8');
  const grammar = readFileSync(join(packRoot, 'frameworks', 'THM_Grammar.md'), 'utf8');
  return buildGlossaryEntries({ termsMarkdown: terms, grammarMarkdown: grammar });
}

/**
 * Installs missing Lab pack methods and knowledge once. Ledger keys prevent
 * reinstall after intentional deletion. Existing matching identities are left alone.
 *
 * `reinstall` ignores the ledger. A workspace reset removes the content the
 * ledger describes, so the ledger is cleared with it and the shipped defaults
 * are installed again from the packaged sources.
 *
 * `knowledgeInBackground` returns the knowledge install as a pending task
 * instead of awaiting it. Extracting the shipped PDFs takes seconds, and a
 * caller that answers a request must not wait for it. The methods are always
 * installed before the answer, because they are immediate.
 */
export async function seedLabPack(input: {
  ledgerPath: string;
  methods: MethodsSeedTarget;
  knowledge?: KnowledgeSeedTarget;
  enabled?: boolean;
  reinstall?: boolean;
  knowledgeInBackground?: boolean;
}): Promise<LabPackSeedResult> {
  const result: LabPackSeedResult = { methodsAdded: [], knowledgeAdded: [], skipped: [], errors: [], knowledgeTask: null };
  if (input.enabled === false) return result;

  const ledger = readLedger(input.ledgerPath);
  const installed = input.reinstall ? new Set<string>() : new Set(ledger.installed);
  // The shipped skills join the Lab methods, so they are installed by the same
  // path and are reinstalled after a workspace reset.
  const definitions = [...loadLabMethodDefinitions(), ...loadShippedSkillDefinitions()];

  for (const definition of definitions) {
    const key = `method:${definition.value.id}`;
    if (installed.has(key)) {
      result.skipped.push(key);
      continue;
    }
    if (input.methods.get(definition.value.id)) {
      installed.add(key);
      continue;
    }
    try {
      input.methods.save(definition);
      installed.add(key);
      result.methodsAdded.push(definition.value.id);
    } catch (reason) {
      result.errors.push(reason instanceof Error ? reason.message : `Could not install ${definition.value.id}.`);
    }
  }

  if (input.knowledge) {
    const files = labFrameworkFiles().filter((file) => file.installByDefault !== false);
    // The ledger records what was installed once. It survives a workspace
    // reset and a manual delete, so it cannot be the only proof that a
    // document is still there. The store is asked instead: a document that is
    // gone, or that carries no extracted text, is installed again.
    const pending = files.filter((file) => !(installed.has(`knowledge:${file.collectionId}:${file.filename}`) && input.knowledge!.isIndexed(frameworkDocumentId(file))));
    for (const file of files) {
      const key = `knowledge:${file.collectionId}:${file.filename}`;
      if (!pending.includes(file)) result.skipped.push(key);
    }
    const install = async () => {
      for (const file of pending) {
        const key = `knowledge:${file.collectionId}:${file.filename}`;
        try {
          const outcome = await installFrameworkFile(input.knowledge!, file);
          installed.add(key);
          result.knowledgeAdded.push(`${file.collectionId}/${file.filename}`);
          // The document is installed. The embedding index may still be
          // missing, which is reported apart from the install so the user
          // knows the document is there and only the vector search is not
          // ready.
          if (outcome.indexError) result.errors.push(outcome.indexError);
        } catch (reason) {
          result.errors.push(reason instanceof Error ? reason.message : `Could not install ${file.filename}.`);
        }
      }
      writeLedger(input.ledgerPath, { version: 'v1', installed: [...installed] });
    };
    if (input.knowledgeInBackground) {
      result.knowledgeTask = install().catch(() => undefined);
    } else {
      await install();
    }
  }

  for (const key of labMethodLedgerKeys(definitions)) {
    if (input.methods.get(key.slice('method:'.length))) installed.add(key);
  }

  writeLedger(input.ledgerPath, { version: 'v1', installed: [...installed] });
  return result;
}

/**
 * Installs one shipped framework file.
 *
 * The text is extracted first, so the document is installed and reachable by
 * a full-text search. The embedding index is built second and may fail, for
 * instance when no embedding model is selected. That failure is reported
 * apart from the install, because the document is present either way.
 */
async function installFrameworkFile(knowledge: KnowledgeSeedTarget, file: FrameworkFile): Promise<{ indexError: string | null }> {
  if (!existsSync(file.absolutePath)) throw new Error(`Missing framework file ${file.filename}.`);
  const bytes = new Uint8Array(readFileSync(file.absolutePath));
  const digest = sha256(bytes);
  if (digest !== file.sha256) throw new Error(`Framework file ${file.filename} failed its recorded SHA-256 check.`);
  if (!knowledge.hasCollection(file.collectionId)) knowledge.createCollection(file.collectionId, file.collectionName);
  const documentId = frameworkDocumentId(file);
  if (knowledge.hasDocument(documentId) && knowledge.isIndexed(documentId)) return { indexError: null };
  // The document is missing, or it is present without extracted text. In
  // either case the source is ingested again; ingesting the same bytes is
  // idempotent, so an existing version is reused and only the extraction and
  // the index are redone.
  const { versionId } = knowledge.ingest({ documentId, name: file.filename, collectionId: file.collectionId, bytes });
  if (knowledge.extract) await knowledge.extract({ collectionId: file.collectionId, versionId, absolutePath: file.absolutePath, filename: file.filename, bytes });
  if (!knowledge.index) return { indexError: null };
  try {
    await knowledge.index({ collectionId: file.collectionId, versionId });
  } catch (reason) {
    return { indexError: `${file.filename} was installed but not added to the embedding index: ${reason instanceof Error ? reason.message : 'the index could not be built'}.` };
  }
  return { indexError: null };
}

export function defaultLabPackLedgerPath(runtimeRoot: string): string {
  return join(runtimeRoot, 'lab-pack.ledger.json');
}

export function defaultKnowledgeFeedRegistryPath(runtimeRoot: string): string {
  return join(runtimeRoot, 'knowledge-feeds.json');
}

export type KnowledgeFeedListingEntry = KnowledgeFeedEntry & { installed: boolean; documentId: string };

export type KnowledgeFeedListing = {
  id: string;
  name: string;
  description: string;
  homepage: string | null;
  source: 'bundled' | 'remote';
  url: string | null;
  updatedAt: string | null;
  lastError: string | null;
  entries: KnowledgeFeedListingEntry[];
};

type StoredRemoteFeed = {
  id: string;
  url: string;
  addedAt: string;
  refreshedAt: string | null;
  catalog: KnowledgeFeed | null;
  lastError: string | null;
};

type FeedRegistryFile = { version: 1; remotes: StoredRemoteFeed[] };

const FEED_JSON_LIMIT = 1_000_000;
const FEED_BYTES_LIMIT = 20_000_000;

function readFeedRegistry(path: string): FeedRegistryFile {
  if (!existsSync(path)) return { version: 1, remotes: [] };
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as FeedRegistryFile).remotes)) return { version: 1, remotes: [] };
    return { version: 1, remotes: (raw as FeedRegistryFile).remotes.filter((item) => item && typeof item.id === 'string' && typeof item.url === 'string') };
  } catch {
    return { version: 1, remotes: [] };
  }
}

function writeFeedRegistry(path: string, registry: FeedRegistryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

export function loadDefaultLabKnowledgeFeed(): KnowledgeFeed {
  return buildDefaultLabKnowledgeFeed(loadJson<FrameworkManifest>('frameworks-v1.json'), '2026-10-24T00:00:00.000Z');
}

export type KnowledgeFeedRegistry = {
  list(installedDocumentIds: ReadonlySet<string>): KnowledgeFeedListing[];
  addRemote(url: string, fetchText?: (url: string) => Promise<string>): Promise<KnowledgeFeedListing>;
  removeRemote(feedId: string): boolean;
  refresh(feedId: string, fetchText?: (url: string) => Promise<string>): Promise<KnowledgeFeedListing>;
  install(input: {
    feedId: string;
    entryId: string;
    knowledge: KnowledgeSeedTarget;
    fetchBytes?: (url: string) => Promise<Uint8Array>;
  }): Promise<{ documentId: string; versionId: string; created: boolean; alreadyInstalled: boolean }>;
};

async function fetchFeedBytes(url: string, limit: number): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Feed URL returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('Feed URL returned an empty body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw new Error('Feed response exceeds the download size limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function defaultFetchText(url: string): Promise<string> {
  return new TextDecoder().decode(await fetchFeedBytes(url, FEED_JSON_LIMIT));
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  return fetchFeedBytes(url, FEED_BYTES_LIMIT);
}

function listingFromCatalog(input: {
  catalog: KnowledgeFeed;
  source: 'bundled' | 'remote';
  url: string | null;
  lastError: string | null;
  installedDocumentIds: ReadonlySet<string>;
}): KnowledgeFeedListing {
  return {
    id: input.catalog.id,
    name: input.catalog.name,
    description: input.catalog.description,
    homepage: input.catalog.homepage,
    source: input.source,
    url: input.url,
    updatedAt: input.catalog.updatedAt,
    lastError: input.lastError,
    entries: input.catalog.entries.map((entry) => {
      const documentId = documentIdForFeedEntry(input.catalog.id, entry);
      return { ...entry, documentId, installed: input.installedDocumentIds.has(documentId) };
    }),
  };
}

export function createKnowledgeFeedRegistry(registryPath: string): KnowledgeFeedRegistry {
  const bundled = loadDefaultLabKnowledgeFeed();

  function list(installedDocumentIds: ReadonlySet<string>): KnowledgeFeedListing[] {
    const registry = readFeedRegistry(registryPath);
    return [
      listingFromCatalog({ catalog: bundled, source: 'bundled', url: null, lastError: null, installedDocumentIds }),
      ...registry.remotes.map((remote) => {
        if (!remote.catalog) {
          return {
            id: remote.id,
            name: remote.url,
            description: 'This feed has not been refreshed yet.',
            homepage: null,
            source: 'remote' as const,
            url: remote.url,
            updatedAt: remote.refreshedAt,
            lastError: remote.lastError,
            entries: [],
          };
        }
        return listingFromCatalog({
          catalog: remote.catalog,
          source: 'remote',
          url: remote.url,
          lastError: remote.lastError,
          installedDocumentIds,
        });
      }),
    ];
  }

  async function loadRemoteCatalog(url: string, fetchText: (url: string) => Promise<string>): Promise<KnowledgeFeed> {
    if (!isAllowedFeedUrl(url)) throw new Error('Use an HTTPS feed URL, or HTTP on localhost.');
    const text = await fetchText(url);
    const catalog = parseKnowledgeFeed(JSON.parse(text) as unknown);
    if (catalog.id === DEFAULT_LAB_KNOWLEDGE_FEED_ID) throw new Error('The default Lab feed is already built in. Choose a different feed id.');
    return catalog;
  }

  return {
    list,
    async addRemote(url, fetchText = defaultFetchText) {
      const catalog = await loadRemoteCatalog(url.trim(), fetchText);
      const registry = readFeedRegistry(registryPath);
      if (registry.remotes.some((remote) => remote.url === url.trim() || remote.id === catalog.id)) {
        throw new Error('This feed is already registered.');
      }
      const now = new Date().toISOString();
      registry.remotes.push({ id: catalog.id, url: url.trim(), addedAt: now, refreshedAt: now, catalog, lastError: null });
      writeFeedRegistry(registryPath, registry);
      return listingFromCatalog({ catalog, source: 'remote', url: url.trim(), lastError: null, installedDocumentIds: new Set() });
    },
    removeRemote(feedId) {
      if (feedId === DEFAULT_LAB_KNOWLEDGE_FEED_ID) return false;
      const registry = readFeedRegistry(registryPath);
      const next = registry.remotes.filter((remote) => remote.id !== feedId);
      if (next.length === registry.remotes.length) return false;
      writeFeedRegistry(registryPath, { version: 1, remotes: next });
      return true;
    },
    async refresh(feedId, fetchText = defaultFetchText) {
      if (feedId === DEFAULT_LAB_KNOWLEDGE_FEED_ID) {
        return listingFromCatalog({ catalog: bundled, source: 'bundled', url: null, lastError: null, installedDocumentIds: new Set() });
      }
      const registry = readFeedRegistry(registryPath);
      const remote = registry.remotes.find((item) => item.id === feedId);
      if (!remote) throw new Error('Unknown knowledge feed.');
      try {
        const catalog = await loadRemoteCatalog(remote.url, fetchText);
        remote.id = catalog.id;
        remote.catalog = catalog;
        remote.refreshedAt = new Date().toISOString();
        remote.lastError = null;
        writeFeedRegistry(registryPath, registry);
        return listingFromCatalog({ catalog, source: 'remote', url: remote.url, lastError: null, installedDocumentIds: new Set() });
      } catch (reason) {
        remote.lastError = reason instanceof Error ? reason.message : 'This feed could not be refreshed.';
        writeFeedRegistry(registryPath, registry);
        throw reason;
      }
    },
    async install({ feedId, entryId, knowledge, fetchBytes = defaultFetchBytes }) {
      const registry = readFeedRegistry(registryPath);
      const catalog = feedId === DEFAULT_LAB_KNOWLEDGE_FEED_ID
        ? bundled
        : registry.remotes.find((remote) => remote.id === feedId)?.catalog;
      if (!catalog) throw new Error('Unknown knowledge feed.');
      const entry = catalog.entries.find((item) => item.id === entryId);
      if (!entry) throw new Error('Unknown feed entry.');
      const documentId = documentIdForFeedEntry(feedId, entry);
      if (knowledge.hasDocument(documentId) && knowledge.isIndexed(documentId)) {
        return { documentId, versionId: '', created: false, alreadyInstalled: true };
      }
      let bytes: Uint8Array;
      if (feedId === DEFAULT_LAB_KNOWLEDGE_FEED_ID) {
        const file = labFrameworkFiles().find((item) => item.collectionId === entry.collectionId && item.filename === entry.filename);
        if (!file) throw new Error(`Bundled Lab file ${entry.filename} is missing.`);
        bytes = new Uint8Array(readFileSync(file.absolutePath));
      } else {
        if (!entry.downloadUrl || !isAllowedFeedUrl(entry.downloadUrl)) throw new Error('This feed entry has no downloadable URL.');
        bytes = await fetchBytes(entry.downloadUrl);
      }
      const digest = sha256(bytes);
      if (digest !== entry.sha256) throw new Error(`${entry.filename} failed its recorded SHA-256 check.`);
      if (!knowledge.hasCollection(entry.collectionId)) knowledge.createCollection(entry.collectionId, entry.collectionName);
      const { versionId, created } = knowledge.ingest({ documentId, name: entry.filename, collectionId: entry.collectionId, bytes });
      const absolutePath = feedId === DEFAULT_LAB_KNOWLEDGE_FEED_ID
        ? labFrameworkFiles().find((item) => item.filename === entry.filename)!.absolutePath
        : join(dirname(registryPath), 'feed-cache', `${digest}${entry.mediaType === 'application/pdf' ? '.pdf' : entry.mediaType === 'text/markdown' ? '.md' : '.txt'}`);
      if (feedId !== DEFAULT_LAB_KNOWLEDGE_FEED_ID) {
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, bytes);
      }
      // The text is extracted first and on its own, so the document is usable
      // even when the embedding index cannot be built yet.
      if (knowledge.extract) await knowledge.extract({ collectionId: entry.collectionId, versionId, absolutePath, filename: entry.filename, bytes });
      if (knowledge.index) {
        try { await knowledge.index({ collectionId: entry.collectionId, versionId }); }
        catch (reason) { throw new Error(`${entry.filename} was installed but not added to the embedding index: ${reason instanceof Error ? reason.message : 'the index could not be built'}.`); }
      }
      return { documentId, versionId, created, alreadyInstalled: false };
    },
  };
}

export {
  readVaultActions,
  readVaultActionByPath,
  writeCustomVaultAction,
  removeCustomVaultAction,
  forkPackActionToCustom,
  ensurePackActionsSeeded,
  toVaultLabAppDescriptor,
  loadVaultLabApps,
  resolveActionPath,
  parseActionMarkdown,
  serializeActionMarkdown,
} from './actions-vault.adapter';
export type { VaultActionDocument, VaultLabAppDescriptor } from './actions-vault.adapter';
