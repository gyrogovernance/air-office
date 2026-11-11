import snapshot from './craft-catalog.snapshot.json';
import { createServiceClient } from '../shared/service-client.hook';

/** AIR-Craft project card sourced from gyrogovernance/air-craft AIR-Craft.md. */
export interface AirCraftProject {
  domain: string;
  emoji: string;
  title: string;
  description: string;
  linkText: string;
  linkUrl: string;
  publisher?: string;
  sources?: { name: string; url: string }[];
  marketCategory?: 'mcp' | 'skill';
  marketQuery?: string;
  marketGroup?: 'News & research' | 'Government & money';
}

export interface AirCraftDomainGroup {
  domain: string;
  projects: AirCraftProject[];
}

/** Unified Scope Routes order; unknown domains append alphabetically after these. */
export const AIR_CRAFT_DOMAIN_ORDER = ['Economy', 'Employment', 'Education', 'Ecology'] as const;

const REQUIRED_FIELDS = ['emoji', 'title', 'description', 'linkText', 'linkUrl'] as const;

/** Bundled snapshot used for first paint and as the live-fetch fallback. */
export const BUNDLED_AIR_CRAFT_PROJECTS: AirCraftProject[] = snapshot.projects;

export const CURATED_EXTERNAL_PRODUCTS: AirCraftProject[] = [
  { domain: 'Employment', emoji: '🔍', title: 'Inspect', description: 'An open-source framework for building and running AI evaluations.', linkText: 'Explore Inspect', linkUrl: 'https://inspect.aisi.org.uk/', publisher: 'UK AI Security Institute and Meridian Labs' },
  { domain: 'Education', emoji: '📘', title: 'NIST AI RMF Playbook', description: 'Suggested actions for applying the AI Risk Management Framework.', linkText: 'Open the playbook', linkUrl: 'https://airc.nist.gov/airmf-resources/playbook/', publisher: 'National Institute of Standards and Technology' },
  { domain: 'Education', emoji: '📚', title: 'Research Lookup', description: 'Gather scholarly literature and prepare a research evidence packet.', linkText: 'View skill', linkUrl: 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/research-lookup', publisher: 'K-Dense', marketCategory: 'skill', marketQuery: 'Research Lookup' },
  { domain: 'Education', emoji: '📝', title: 'Scholar Evaluation', description: 'Review scholarly work with qualitative, evidence-traceable feedback.', linkText: 'View skill', linkUrl: 'https://github.com/K-Dense-AI/scientific-agent-skills/tree/main/skills/scholar-evaluation', publisher: 'K-Dense', marketCategory: 'skill', marketQuery: 'Scholar Evaluation' },
  { domain: 'Employment', emoji: '⚖️', title: 'AI Governance Reviewer', description: 'Structure governance, privacy and vendor-risk reviews of AI use cases.', linkText: 'View skill', linkUrl: 'https://github.com/lawve-ai/awesome-legal-skills/tree/main/skills/ai-governance-reviewer-carl-ditzler', publisher: 'Carl Ditzler', marketCategory: 'skill', marketQuery: 'ai-governance-reviewer' },
  { domain: 'Education', emoji: '🔬', title: 'Research sources', description: 'Find scholarly works, publication metadata and preprints.', linkText: 'Explore OpenAlex', linkUrl: 'https://openalex.org/', publisher: 'OpenAlex, Crossref and arXiv', marketCategory: 'mcp', marketGroup: 'News & research', sources: [{ name: 'OpenAlex', url: 'https://openalex.org/' }, { name: 'Crossref', url: 'https://www.crossref.org/' }, { name: 'arXiv', url: 'https://arxiv.org/' }] },
  { domain: 'Economy', emoji: '📊', title: 'Economic data', description: 'Explore comparable economic, social and development data.', linkText: 'Explore OECD Data', linkUrl: 'https://www.oecd.org/en/data.html', publisher: 'OECD, Eurostat and World Bank', marketCategory: 'mcp', marketGroup: 'Government & money', sources: [{ name: 'OECD', url: 'https://www.oecd.org/en/data.html' }, { name: 'Eurostat', url: 'https://ec.europa.eu/eurostat/' }, { name: 'World Bank', url: 'https://data.worldbank.org/' }] },
];

/**
 * Parse AIR-Craft.md: each `### Domain` block with bullet fields
 * (emoji, title, description, linkText, linkUrl) becomes one project.
 * Sections missing any required field are skipped.
 */
export function parseAirCraftMarkdown(markdown: string): AirCraftProject[] {
  const projects: AirCraftProject[] = [];
  const sections = markdown.split(/^###\s+/m).slice(1);

  for (const section of sections) {
    const newline = section.indexOf('\n');
    if (newline === -1) continue;

    const domain = section.slice(0, newline).trim();
    if (!domain) continue;

    const fields: Record<string, string> = {};
    for (const line of section.slice(newline + 1).split('\n')) {
      const match = line.match(/^\s*-\s*(\w+)\s*:\s*(.+?)\s*$/);
      if (match) fields[match[1]!] = match[2]!.trim();
    }

    if (!REQUIRED_FIELDS.every((key) => fields[key])) continue;

    projects.push({
      domain,
      emoji: fields.emoji!,
      title: fields.title!,
      description: fields.description!,
      linkText: fields.linkText!,
      linkUrl: fields.linkUrl!,
    });
  }

  return projects;
}

/**
 * Fetch and parse the remote AIR-Craft.md project list through the local
 * service (desktop CSP is loopback-only). Throws on network or parse failure.
 */
export async function fetchAirCraftProjects(signal?: AbortSignal): Promise<AirCraftProject[]> {
  const client = createServiceClient();
  const body = await client.json<{ markdown?: unknown }>('/api/v1/craft/air-craft-md', signal ? { signal } : undefined);
  const markdown = typeof body.markdown === 'string' ? body.markdown : '';
  const projects = parseAirCraftMarkdown(markdown);
  if (projects.length === 0) throw new Error('AIR-Craft.md contained no valid projects');
  return projects;
}

/** Case-insensitive title/description/domain match; empty query returns all. */
export function filterAirCraftProjects(projects: AirCraftProject[], query: string): AirCraftProject[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter((project) => `${project.title} ${project.description} ${project.domain}`.toLowerCase().includes(needle));
}

/** Group projects by domain in Unified Scope order; unknown domains follow alphabetically. */
export function groupAirCraftProjects(projects: AirCraftProject[]): AirCraftDomainGroup[] {
  const byDomain = new Map<string, AirCraftProject[]>();
  for (const project of projects) {
    const list = byDomain.get(project.domain);
    if (list) list.push(project);
    else byDomain.set(project.domain, [project]);
  }

  const known = new Set<string>(AIR_CRAFT_DOMAIN_ORDER);
  const ordered: AirCraftDomainGroup[] = [];
  for (const domain of AIR_CRAFT_DOMAIN_ORDER) {
    const group = byDomain.get(domain);
    if (group?.length) ordered.push({ domain, projects: group });
  }
  for (const domain of [...byDomain.keys()].filter((entry) => !known.has(entry)).sort((a, b) => a.localeCompare(b))) {
    ordered.push({ domain, projects: byDomain.get(domain)! });
  }
  return ordered;
}

/** Filter tab names: All, then known domains present, then unknown domains alphabetically. */
export function airCraftDomainFilters(projects: AirCraftProject[]): string[] {
  const present = new Set(projects.map((project) => project.domain));
  const known = AIR_CRAFT_DOMAIN_ORDER.filter((domain) => present.has(domain));
  const extras = [...present].filter((domain) => !(AIR_CRAFT_DOMAIN_ORDER as readonly string[]).includes(domain)).sort((a, b) => a.localeCompare(b));
  return ['All', ...known, ...extras];
}

/** Number of projects a filter tab would show. */
export function airCraftDomainCount(projects: AirCraftProject[], domain: string): number {
  return domain === 'All' ? projects.length : projects.filter((project) => project.domain === domain).length;
}
