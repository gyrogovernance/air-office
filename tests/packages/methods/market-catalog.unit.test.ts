import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarketCatalogService, createSqliteMarketSourceStore, defaultMarketSources, humanizeCatalogTitle, migrateMarketSources, parseLegalCatalog, parseLibrarySkill, parseMarketSources, parseScientificCatalog, parseStandaloneSkill, selectCanonicalSkillPaths } from '../../../packages/methods/src/market-catalog.service';
import { createVaultMethodsStore } from '../../../packages/methods/src/methods.service.public';

const skill = '---\nname: example\ndescription: >\n  Check the supplied evidence.\n  Explain uncertainty.\nlicense: Complete terms in LICENSE.txt\n---\n# Review\n\nRead the supplied evidence.';
test('legal catalog titles prefer the README blurb over kebab slugs', () => {
  expect(humanizeCatalogTitle('eu-ai-act-quick-assessment-oliver-schmidt-prietz', 'Fast triage for preliminary AI Act classification and compliance assessment.')).toBe('Fast triage for preliminary AI Act classification and compliance assessment.');
  const entries = parseLegalCatalog('## AI Governance\n\n- 🇬🇧 [eu-ai-act-quick-assessment-oliver-schmidt-prietz](<skills/eu-ai-act-quick-assessment-oliver-schmidt-prietz>) - Fast triage for preliminary AI Act classification.\n');
  expect(entries).toEqual([expect.objectContaining({
    id: 'legal-skills:skills/eu-ai-act-quick-assessment-oliver-schmidt-prietz/SKILL.md',
    name: 'Fast triage for preliminary AI Act classification.',
    category: 'AI Governance'
  })]);
});
test('tree catalogs keep one canonical skill and ignore agent-tool mirrors', () => {
  expect(selectCanonicalSkillPaths([
    '.agents/skills/genai-security-advisor/SKILL.md',
    '.claude/skills/genai-security-advisor/SKILL.md',
    'SKILL.md',
    'skills/genai-security-advisor/SKILL.md'
  ])).toEqual(['SKILL.md']);
  expect(selectCanonicalSkillPaths(['skills/alpha/SKILL.md', '.claude/skills/alpha/SKILL.md', 'skills/beta/SKILL.md'])).toEqual(['skills/alpha/SKILL.md', 'skills/beta/SKILL.md']);
});
test('library skill metadata rejects relative path pointers used by tool mirrors', () => {
  expect(() => parseLibrarySkill('../../SKILL.md')).toThrow('path pointer');
  expect(() => parseLibrarySkill('../../../SKILL.md\n')).toThrow('path pointer');
});
test('standalone adapter retains instructions and folded metadata and rejects dependency declarations', () => {
  expect(parseStandaloneSkill(skill)).toEqual({ description: 'Check the supplied evidence. Explain uncertainty.', instructions: '# Review\n\nRead the supplied evidence.' });
  expect(() => parseStandaloneSkill(skill.replace('name: example', 'name: example\ndependencies: scripts/run.py'))).toThrow('metadata or dependencies');
  expect(() => parseStandaloneSkill('plain arbitrary file')).toThrow('frontmatter');
});
test('library skill metadata is read as literal frontmatter fields', () => {
  expect(parseLibrarySkill('---\nname: "example skill"\ndescription: Reads community metadata\n---\n# Instructions')).toEqual({
    name: 'example skill',
    description: 'Reads community metadata',
    instructions: '# Instructions'
  });
});
test('skill frontmatter handles CRLF and repeated non-closing delimiters', () => {
  expect(parseLibrarySkill('---\r\nname: sample\r\ndescription: safe\r\n---\r\nUse it.')).toEqual({ name: 'sample', description: 'safe', instructions: 'Use it.' });
  const malformed = '---\nname: a\n' + '---a\n'.repeat(20_000);
  expect(() => parseStandaloneSkill(malformed)).toThrow('frontmatter');
});
test('source configuration persists empty catalogs and rejects unknown URLs, prompts and duplicates', () => {
  const root = mkdtempSync(join(tmpdir(), 'market-sources-'));
  const path = join(root, 'market.sqlite');
  let store = createSqliteMarketSourceStore(path);
  try {
    expect(store.list()).toEqual([...defaultMarketSources]);
    expect(() => store.replace([{ ...defaultMarketSources[0], url: 'http://127.0.0.1/secrets' }])).toThrow('Unsupported');
    expect(() => parseMarketSources([{ ...defaultMarketSources[0], kind: 'prompt' }])).toThrow('Unsupported');
    expect(() => parseMarketSources([defaultMarketSources[0], { ...defaultMarketSources[0], id: 'duplicate' }])).toThrow('once');
    store.replace([]); store.close(); store = createSqliteMarketSourceStore(path);
    expect(store.list()).toEqual([]);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('a stored skill exchange is replaced by the subject libraries', () => {
  const legacy = parseMarketSources([{ id: 'agent-skill-exchange', kind: 'skill', name: 'Agent Skill Exchange', url: 'https://github.com/agentskillexchange/skills', format: 'agent-skill-exchange-v1', enabled: true }, defaultMarketSources.find((source) => source.kind === 'automation')]);
  expect(migrateMarketSources(legacy).map((source) => source.id)).toEqual(['scientific-skills', 'legal-skills', 'native-automations']);
  expect(parseScientificCatalog('## Databases\n\n- **[Database Lookup](../skills/database-lookup/SKILL.md)** - Queries public databases.\n').map((entry) => [entry.category, entry.id])).toEqual([['Databases', 'scientific-skills:skills/database-lookup/SKILL.md']]);
  const retired = parseMarketSources([
    { id: 'ai-governance-toolkit', kind: 'skill', name: 'AI governance toolkit', url: 'https://github.com/musaabhasan/ai-security-governance-toolkit', format: 'github-skill-library-v1', enabled: true },
    { id: 'owasp-genai-advisor', kind: 'skill', name: 'OWASP GenAI Security Advisor', url: 'https://github.com/GenAI-Security-Project/GenAI-Security-Advisor', format: 'github-skill-library-v1', enabled: true },
    defaultMarketSources.find((source) => source.kind === 'automation')
  ]);
  expect(migrateMarketSources(retired).map((source) => source.id)).toEqual(['scientific-skills', 'legal-skills', 'native-automations']);
});
test('disabled sources never download or install and unreadable catalogs stay explicit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'market-skills-'));
  process.env.AIR_VAULT_ROOT = root;
  const sources = createSqliteMarketSourceStore(join(root, 'market.sqlite'));
  const methods = createVaultMethodsStore(root);
  let calls = 0;
  const catalog = createMarketCatalogService({ sources, methods, fetch: async (url, init) => { calls++; expect(url.startsWith('https://')).toBe(true); expect(init.redirect).toBe('error'); expect(init.signal).toBeDefined(); return new Response('not a catalog'); } });
  try {
    const result = await catalog.catalog('skill');
    expect(result.entries).toHaveLength(0); expect(result.sources[0]?.state).toBe('error');
    expect(result.sources[0]?.error).toContain('skill index'); expect(calls).toBe(2);
    expect(methods.list()).toHaveLength(0);
    sources.replace(defaultMarketSources.map((source) => ({ ...source, enabled: false })));
    expect((await catalog.catalog('skill')).entries).toHaveLength(0);
    await expect(catalog.installSkill('scientific-skills:skills/example/SKILL.md')).rejects.toThrow('Enable');
    expect(calls).toBe(2);
  } finally { sources.close(); methods.close(); rmSync(root, { recursive: true, force: true }); }
});
test.skipIf(!process.env.MARKET_LIVE_SKILLS)('audited upstream snapshot installs text with provenance and full licenses through Methods', async () => {
  const root = mkdtempSync(join(tmpdir(), 'market-upstream-'));
  process.env.AIR_VAULT_ROOT = root;
  const sources = createSqliteMarketSourceStore(join(root, 'market.sqlite'));
  const methods = createVaultMethodsStore(root);
  const catalog = createMarketCatalogService({ sources, methods });
  try {
    const result = await catalog.catalog('skill');
    expect(result.entries.length).toBeGreaterThan(100);
    expect(result.entries.some((entry) => entry.id.startsWith('exchange:'))).toBe(false);
    expect(new Set(result.entries.map((entry) => entry.library)).size).toBeGreaterThan(1);
    expect(result.sources.every((source) => source.state === 'ready')).toBe(true);
    const entry = result.entries[0]!;
    const installed = await catalog.installSkill(entry.id);
    expect(installed.kind).toBe('skill');
    expect(installed.value.id).not.toBe(entry.id);
    expect(installed.value.instructions).toContain(entry.sourceUrl);
    expect(installed.value.instructions).toContain(entry.sourceUrl);
    expect(methods.list()).toHaveLength(1);
  } finally { sources.close(); methods.close(); rmSync(root, { recursive: true, force: true }); }
});

test('oversized files and failed downloads report bounded source failures', async () => {
  const sources = { list: () => structuredClone([...defaultMarketSources]), replace: parseMarketSources, close() {} };
  for (const response of [new Response('x'.repeat(64001)), new Response('unavailable', { status: 503 })]) {
    const catalog = createMarketCatalogService({ sources, methods: { save: () => { throw new Error('unexpected save'); } }, fetch: async () => response.clone() });
    const result = await catalog.catalog('skill');
    expect(result.entries).toHaveLength(0); expect(result.sources[0]?.state).toBe('error');
  }
});

test('a library catalog lists skills without downloading each file', async () => {
  const scientific = defaultMarketSources.find((source) => source.id === 'scientific-skills')!;
  const sources = { list: () => [{ ...scientific }], replace: parseMarketSources, close() {} };
  const index = '## Databases\n\n- **[Database Lookup](../skills/database-lookup/SKILL.md)** - Queries public databases.\n- **[Skipped](not-a-skill)** - no\n';
  let calls = 0;
  const catalog = createMarketCatalogService({ sources, methods: { save: (definition) => definition }, fetch: async (url) => { calls++; return new Response(url.endsWith('/docs/skills.md') ? index : '---\nname: "Database Lookup"\ndescription: "Queries public databases."\n---\n# Lookup\n\nUse the named source.'); } });
  const result = await catalog.catalog('skill');
  expect(result.entries.map((entry) => entry.id)).toEqual(['scientific-skills:skills/database-lookup/SKILL.md']);
  expect(result.entries[0]?.category).toBe('Databases');
  expect(result.entries[0]?.instructions).toBe('');
  expect(calls).toBe(1);
  const installed = await catalog.installSkill('scientific-skills:skills/database-lookup/SKILL.md');
  expect(installed.kind).toBe('skill');
  expect(installed.value.instructions).toContain('# Lookup');
  expect(installed.value.instructions).toContain('Library: Scientific skills');
  expect(installed.value.instructions).toContain('Category: Databases');
  expect(calls).toBe(2);
});
