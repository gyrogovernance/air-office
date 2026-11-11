import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MethodsStore } from './methods.service.public';
import { splitSkillFrontmatter } from './methods.domain.public';

export type MarketKind = 'skill' | 'automation';
export type MarketSourceFormat = 'github-skill-library-v1' | 'agent-skill-exchange-v1' | 'anthropic-standalone-v1' | 'air-office-native-v1';
export type MarketSource = { id: string; kind: MarketKind; name: string; url: string; format: MarketSourceFormat; enabled: boolean };
export type MarketSkillEntry = { id: string; kind: 'skill'; name: string; description: string; instructions: string; sourceUrl: string; license: string; licenseText: string; licenseUrl: string; revision: string; category: string; library: string; fileUrl: string };
export type MarketSourceStatus = MarketSource & { state: 'ready' | 'disabled' | 'error'; error?: string };
const anthropicRepository = 'https://github.com/anthropics/skills';
const exchangeRepository = 'https://github.com/agentskillexchange/skills';
type SkillLibrary = { id: string; name: string; url: string; owner: string; repo: string; license: string; licenseUrl: string; index: 'scientific' | 'legal' };
/** Former Market sources: empty governance templates, and the single-skill OWASP advisor. Governance and security Discover tiles use Legal categories instead. */
const retiredSkillUrls = new Set([
  'https://github.com/musaabhasan/ai-security-governance-toolkit',
  'https://github.com/GenAI-Security-Project/GenAI-Security-Advisor'
]);
const retiredSkillIds = new Set(['ai-governance-toolkit', 'owasp-genai-advisor']);
const skillLibraries: readonly SkillLibrary[] = [
  { id: 'scientific-skills', name: 'Scientific skills', url: 'https://github.com/K-Dense-AI/scientific-agent-skills', owner: 'K-Dense-AI', repo: 'scientific-agent-skills', license: 'MIT', licenseUrl: 'https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/LICENSE', index: 'scientific' },
  { id: 'legal-skills', name: 'Legal and governance skills', url: 'https://github.com/lawve-ai/awesome-legal-skills', owner: 'lawve-ai', repo: 'awesome-legal-skills', license: 'See each skill', licenseUrl: 'https://github.com/lawve-ai/awesome-legal-skills', index: 'legal' }
];
const libraryUrls = new Set(skillLibraries.map((library) => library.url));
const skillLibrarySources: MarketSource[] = skillLibraries.map((library) => ({ id: library.id, kind: 'skill', name: library.name, url: library.url, format: 'github-skill-library-v1', enabled: true }));
export const defaultMarketSources: readonly MarketSource[] = [
  ...skillLibrarySources,
  { id: 'native-automations', kind: 'automation', name: 'AIR Office templates', url: 'air-office:native-automations', format: 'air-office-native-v1', enabled: true }
];
export class MarketCatalogError extends Error {}
export interface MarketSourceStore { list(): MarketSource[]; replace(sources: unknown): MarketSource[]; close(): void }
export function parseMarketSources(value: unknown): MarketSource[] {
  if (!Array.isArray(value) || value.length > 8) throw new MarketCatalogError('Provide at most eight Market sources.');
  const ids = new Set<string>();
  const identities = new Set<string>();
  return value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarketCatalogError('Invalid Market source.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['id', 'kind', 'name', 'url', 'format', 'enabled'].includes(key)) || typeof item.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || typeof item.enabled !== 'boolean') throw new MarketCatalogError('Use unique source IDs, a name and an enabled flag.');
    const listed = item.kind === 'skill' && item.format === 'github-skill-library-v1' && typeof item.url === 'string' && libraryUrls.has(item.url);
    const legacy = item.kind === 'skill' && (item.format === 'agent-skill-exchange-v1' && item.url === exchangeRepository || item.format === 'anthropic-standalone-v1' && item.url === anthropicRepository);
    const retired = item.kind === 'skill' && item.format === 'github-skill-library-v1' && typeof item.url === 'string' && retiredSkillUrls.has(item.url);
    const native = item.kind === 'automation' && item.format === 'air-office-native-v1' && item.url === 'air-office:native-automations';
    if (!listed && !legacy && !retired && !native) throw new MarketCatalogError('Unsupported source URL or format. Supported libraries are scientific skills, legal and governance skills, and AIR Office native automations.');
    const identity = `${item.kind}:${item.url}`;
    if (identities.has(identity)) throw new MarketCatalogError('Each source may be configured once per category.');
    identities.add(identity); ids.add(item.id);
    return { id: item.id, kind: item.kind, name: item.name.trim(), url: item.url, format: item.format, enabled: item.enabled } as MarketSource;
  });
}
function legacySkillSource(source: MarketSource): boolean {
  return source.kind === 'skill' && (source.format === 'agent-skill-exchange-v1' || source.format === 'anthropic-standalone-v1' || source.url === exchangeRepository || source.url === anthropicRepository);
}
function retiredSkillSource(source: MarketSource): boolean {
  return source.kind === 'skill' && (retiredSkillUrls.has(source.url) || retiredSkillIds.has(source.id));
}
/** Drop retired or mixed skill sources and install the subject libraries in their place. */
export function migrateMarketSources(sources: MarketSource[]): MarketSource[] {
  const hadLegacy = sources.some(legacySkillSource);
  const hadRetired = sources.some(retiredSkillSource);
  const kept = sources.filter((source) => !legacySkillSource(source) && !retiredSkillSource(source));
  const additions = hadLegacy || hadRetired ? skillLibrarySources.filter((library) => !kept.some((source) => source.kind === 'skill' && source.url === library.url)) : [];
  const merged = [...additions, ...kept].slice(0, 8);
  const ids = new Set<string>();
  const identities = new Set<string>();
  return merged.filter((source) => {
    const identity = `${source.kind}:${source.url}`;
    if (ids.has(source.id) || identities.has(identity)) return false;
    ids.add(source.id); identities.add(identity);
    return true;
  });
}
export function createSqliteMarketSourceStore(path: string): MarketSourceStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec('CREATE TABLE IF NOT EXISTS market_sources (id INTEGER PRIMARY KEY CHECK (id = 1), value_json TEXT NOT NULL)');
  db.query('INSERT OR IGNORE INTO market_sources (id, value_json) VALUES (1, ?)').run(JSON.stringify(defaultMarketSources));
  return {
    list: () => {
      const stored = parseMarketSources(JSON.parse((db.query('SELECT value_json FROM market_sources WHERE id = 1').get() as { value_json: string }).value_json));
      const sources = migrateMarketSources(stored);
      if (JSON.stringify(sources) !== JSON.stringify(stored)) db.query('UPDATE market_sources SET value_json = ? WHERE id = 1').run(JSON.stringify(sources));
      return sources;
    },
    replace: (value) => { const sources = migrateMarketSources(parseMarketSources(value)); db.query('UPDATE market_sources SET value_json = ? WHERE id = 1').run(JSON.stringify(sources)); return sources; },
    close: () => db.close()
  };
}
export type MarketFetch = (url: string, init: RequestInit) => Promise<Response>;
async function boundedText(fetcher: MarketFetch, url: string, signal: AbortSignal, limit = 64_000): Promise<string> {
  const response = await fetcher(url, { redirect: 'error', signal, headers: { Accept: 'text/plain, text/markdown, application/json, application/vnd.github+json', 'User-Agent': 'air-office' } });
  if (!response.ok || !response.body) throw new MarketCatalogError('The community source is unavailable. Retry later.');
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new MarketCatalogError('The upstream file exceeds the size limit.'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new MarketCatalogError('The upstream file exceeds the size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function clip(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}
function rawFile(library: SkillLibrary, path: string): string {
  return `https://raw.githubusercontent.com/${library.owner}/${library.repo}/main/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}
function blobFile(library: SkillLibrary, path: string): string {
  return `https://github.com/${library.owner}/${library.repo}/blob/main/${path.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}
function safePath(path: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
}
function titleFromPath(path: string): string {
  const stem = (path.split('/').pop() ?? path).replace(/\.md$/i, '');
  return humanizeSlugTitle(stem);
}
function looksLikeSkillSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value.trim());
}
/** Turn kebab slugs into short titles for Market rows and installs. */
export function humanizeSlugTitle(value: string): string {
  const cleaned = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
/** Prefer the README blurb as a human title when the link text is only a slug. */
export function humanizeCatalogTitle(linkText: string, description: string): string {
  const link = clip(linkText, 120);
  const blurb = clip(description, 2000);
  if (!looksLikeSkillSlug(link)) return link || humanizeSlugTitle(blurb) || 'Community skill';
  if (blurb.length >= 16) {
    if (blurb.length <= 88) return blurb;
    const cut = blurb.slice(0, 88);
    const at = cut.lastIndexOf(' ');
    return `${(at > 40 ? cut.slice(0, at) : cut).trim()}…`;
  }
  return humanizeSlugTitle(link);
}
function skillEntry(library: SkillLibrary, path: string, name: string, description: string, category: string): MarketSkillEntry | null {
  const id = `${library.id}:${path}`;
  if (id.length > 400 || !safePath(path)) return null;
  const displayName = clip(name, 120) || titleFromPath(path);
  return { id, kind: 'skill', name: displayName, description: clip(description, 2000) || displayName, instructions: '', sourceUrl: blobFile(library, path), license: library.license, licenseText: '', licenseUrl: library.licenseUrl, revision: 'main', category: clip(category, 80) || 'General', library: library.name, fileUrl: rawFile(library, path) };
}
export function parseScientificCatalog(text: string, library: SkillLibrary = skillLibraries[0]!): MarketSkillEntry[] {
  let category = 'Science';
  const entries: MarketSkillEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    const subheading = /^###\s+(.+)$/.exec(line);
    if (heading) { category = heading[1]!.replace(/[*_`]/g, '').trim(); continue; }
    if (subheading) { category = subheading[1]!.replace(/[*_`]/g, '').trim(); continue; }
    const item = /^- \*\*\[([^\]]+)\]\(\.\.\/(skills\/([a-z0-9-]+)\/SKILL\.md)\)\*\* - (.+)$/.exec(line);
    if (!item || seen.has(item[3]!)) continue;
    seen.add(item[3]!);
    const entry = skillEntry(library, `skills/${item[3]}/SKILL.md`, item[1]!, item[4]!, category);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) throw new MarketCatalogError('The community catalog is not a skill index.');
  return entries;
}
export function parseLegalCatalog(text: string, library: SkillLibrary = skillLibraries[1]!): MarketSkillEntry[] {
  let category = 'Legal practice';
  const entries: MarketSkillEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) { category = heading[1]!.replace(/[*_`]/g, '').trim(); continue; }
    const item = /^- .*\[([^\]]+)\]\(<?skills\/([a-z0-9-]+)>?\)(?:\s+-\s+(.*))?$/.exec(line);
    if (!item || seen.has(item[2]!)) continue;
    seen.add(item[2]!);
    const blurb = item[3] || item[1]!;
    const entry = skillEntry(library, `skills/${item[2]}/SKILL.md`, humanizeCatalogTitle(item[1]!, blurb), blurb, category);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) throw new MarketCatalogError('The community catalog is not a skill index.');
  return entries;
}
/** Skip agent-tool mirror folders (.claude, .agents, .github, …) that republish the same SKILL.md. */
function isToolMirrorPath(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.'));
}
function skillTreeSlug(path: string): string {
  if (path === 'SKILL.md') return '__root__';
  const skills = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i.exec(path);
  if (skills) return skills[1]!.toLowerCase();
  const parts = path.split('/');
  return (parts.length >= 2 ? parts[parts.length - 2]! : path).toLowerCase();
}
function skillTreeRank(path: string): number {
  if (path === 'SKILL.md') return 0;
  if (/^skills\/[^/]+\/SKILL\.md$/i.test(path)) return 1;
  if (isToolMirrorPath(path)) return 100;
  return 50;
}
/** Keep one installable path per skill; prefer root or skills/<name>, never tool-folder copies. */
export function selectCanonicalSkillPaths(paths: string[]): string[] {
  const skillPaths = paths.filter((path) => /(^|\/)SKILL\.md$/i.test(path));
  const chosen = new Map<string, string>();
  for (const path of skillPaths) {
    if (isToolMirrorPath(path)) continue;
    const slug = skillTreeSlug(path);
    const current = chosen.get(slug);
    if (!current || skillTreeRank(path) < skillTreeRank(current)) chosen.set(slug, path);
  }
  // Single-skill repos often ship root SKILL.md plus skills/<name>/SKILL.md as a relative pointer.
  if (chosen.has('__root__') && chosen.size === 2) return [chosen.get('__root__')!];
  return [...chosen.values()].sort((left, right) => left.localeCompare(right));
}
function isRelativeSkillPointer(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length < 120 && /^\.\.?\/[A-Za-z0-9._/-]+$/.test(trimmed) && !trimmed.includes('\n');
}
export function parseLibrarySkill(text: string): { name: string; description: string; instructions: string } {
  if (isRelativeSkillPointer(text)) throw new MarketCatalogError('This skill file is a path pointer, not installable instructions.');
  const match = splitSkillFrontmatter(text);
  const instructions = (match ? match.body : text).trim();
  if (!instructions) throw new MarketCatalogError('This skill has no installable instructions.');
  if (isRelativeSkillPointer(instructions)) throw new MarketCatalogError('This skill file is a path pointer, not installable instructions.');
  const frontmatter = match?.frontmatter ?? '';
  const field = (key: 'name' | 'description'): string => {
    const line = frontmatter.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`));
    if (!line) return '';
    const value = line.slice(key.length + 1).trimStart();
    if (!value.startsWith('"')) return value;
    const closingQuote = value.indexOf('"', 1);
    return closingQuote < 0 ? '' : value.slice(1, closingQuote);
  };
  const description = clip(field('description'), 2000) || clip(instructions.split('\n').find((line) => line.trim() && !line.startsWith('#')), 500) || 'Community skill';
  const rawName = clip(field('name'), 120);
  return { name: looksLikeSkillSlug(rawName) ? humanizeSlugTitle(rawName) : rawName, description, instructions: instructions.slice(0, 60_000) };
}
export function parseStandaloneSkill(text: string): { description: string; instructions: string } {
  const match = splitSkillFrontmatter(text);
  if (!match || !match.body) throw new MarketCatalogError('Unsupported SKILL.md frontmatter.');
  const frontmatter = match.frontmatter;
  if (!/^name: [a-z0-9-]+\r?$/m.test(frontmatter) || !/^license: Complete terms in LICENSE\.txt\r?$/m.test(frontmatter) || /^(?!name:|description:|license:|[ \t]|\r?$)\S/m.test(frontmatter)) throw new MarketCatalogError('Unsupported skill metadata or dependencies.');
  const descriptionMatch = /^description: (.+)((?:\r?\n[ \t]+[^\r\n]*)*)/m.exec(frontmatter);
  if (!descriptionMatch) throw new MarketCatalogError('A skill description is required.');
  const description = (descriptionMatch[1] === '>' ? descriptionMatch[2]! : `${descriptionMatch[1]}${descriptionMatch[2]}`).replace(/\s+/g, ' ').trim();
  if (!description || description.length > 2000) throw new MarketCatalogError('Unsupported skill description.');
  return { description, instructions: match.body.trim() };
}
function libraryFor(source: MarketSource): SkillLibrary {
  const library = skillLibraries.find((candidate) => candidate.url === source.url);
  if (!library || source.format !== 'github-skill-library-v1') throw new MarketCatalogError('Unsupported skill library.');
  return library;
}
export function createMarketCatalogService(options: { sources: MarketSourceStore; methods: Pick<MethodsStore, 'save'>; fetch?: MarketFetch }) {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const caches = new Map<string, { expires: number; entries: MarketSkillEntry[] }>();
  const indexLibrary = async (source: MarketSource): Promise<MarketSkillEntry[]> => {
    const library = libraryFor(source);
    const hit = caches.get(library.id);
    if (hit && hit.expires > Date.now()) return hit.entries;
    const signal = AbortSignal.timeout(20000);
    const indexUrl = library.index === 'scientific'
      ? `https://raw.githubusercontent.com/${library.owner}/${library.repo}/main/docs/skills.md`
      : `https://raw.githubusercontent.com/${library.owner}/${library.repo}/main/README.md`;
    const text = await boundedText(fetcher, indexUrl, signal, 400_000);
    const entries = library.index === 'scientific' ? parseScientificCatalog(text, library) : parseLegalCatalog(text, library);
    caches.set(library.id, { expires: Date.now() + 15 * 60_000, entries });
    return entries;
  };
  const loadEnabled = async (): Promise<{ entries: MarketSkillEntry[]; sources: MarketSourceStatus[] }> => {
    const sources = options.sources.list().filter((source) => source.kind === 'skill');
    const loaded = await Promise.all(sources.map(async (source) => {
      if (!source.enabled) return { source: { ...source, state: 'disabled' as const }, entries: [] as MarketSkillEntry[] };
      try { return { source: { ...source, state: 'ready' as const }, entries: await indexLibrary(source) }; }
      catch (error) { return { source: { ...source, state: 'error' as const, error: error instanceof MarketCatalogError ? error.message : 'Community download failed. Retry later.' }, entries: [] as MarketSkillEntry[] }; }
    }));
    const entries = loaded.flatMap((item) => item.entries).sort((left, right) => left.library.localeCompare(right.library) || left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
    return { entries, sources: loaded.map((item) => item.source) };
  };
  const loadSkill = async (id: string) => {
    if (!options.sources.list().some((source) => source.kind === 'skill' && source.enabled && source.format === 'github-skill-library-v1')) throw new MarketCatalogError('Enable a skill source in Settings → Market first.');
    const { entries } = await loadEnabled();
    const entry = entries.find((candidate) => candidate.id === id);
    const library = skillLibraries.find((candidate) => entry?.fileUrl.startsWith(`https://raw.githubusercontent.com/${candidate.owner}/${candidate.repo}/main/`));
    if (!entry || !library || !options.sources.list().some((source) => source.enabled && source.url === library.url)) throw new MarketCatalogError('Choose a supported skill from the catalog.');
    const text = await boundedText(fetcher, entry.fileUrl, AbortSignal.timeout(12000));
    const content = parseLibrarySkill(text);
    if (!content.instructions.trim()) throw new MarketCatalogError('This skill has no installable instructions.');
    return { entry, content };
  };
  return {
    sources: () => options.sources.list(),
    saveSources: (value: unknown) => { const result = options.sources.replace(value); caches.clear(); return result; },
    async catalog(kind: MarketKind): Promise<{ entries: MarketSkillEntry[]; sources: MarketSourceStatus[] }> {
      if (kind !== 'skill') {
        const sources: MarketSourceStatus[] = options.sources.list().filter((source) => source.kind === kind).map((source) => ({ ...source, state: source.enabled ? 'ready' : 'disabled' }));
        return { entries: [], sources };
      }
      return loadEnabled();
    },
    async previewSkill(id: string) {
      const { content } = await loadSkill(id);
      return content;
    },
    async installSkill(id: string) {
      const { entry, content } = await loadSkill(id);
      const name = content.name || entry.name;
      return options.methods.save({ kind: 'skill', value: { id: crypto.randomUUID(), name: looksLikeSkillSlug(name) ? humanizeSlugTitle(name) : name, description: content.description.slice(0, 500), instructions: `${content.instructions}\n\n## Source\n\nImported from ${entry.sourceUrl}\nLibrary: ${entry.library}\nCategory: ${entry.category}\nLicense: ${entry.license}`, updatedAt: new Date().toISOString() } });
    }
  };
}
export type MarketCatalogService = ReturnType<typeof createMarketCatalogService>;
