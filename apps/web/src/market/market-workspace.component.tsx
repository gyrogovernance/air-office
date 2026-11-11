import { MarketKnowledgeCatalog, type KnowledgeCatalogEntry, type KnowledgeCatalogFeed } from './market-knowledge-catalog.component';
import { HugeiconsIcon } from '@hugeicons/react';
import { Atom01Icon, Shield01Icon, AiBrain01Icon, JusticeScale01Icon, ArrowUpRight01Icon, Calendar03Icon, BookOpen01Icon, Search01Icon, CodeIcon, Database01Icon, Briefcase01Icon } from '@hugeicons/core-free-icons';
import { ConnectorCatalog } from '../tools/connector-catalog.component';
import { MarketMcpCatalog } from './market-mcp-catalog.component';
import { McpMegaPack } from './mcp-mega-pack.component';
import { MarketResourceCatalog } from './market-resource-catalog.component';
import { MarketAutomationsCatalog } from './market-automations-catalog.component';
import { LocalModelsMarket } from '../models/local-ai/local-models-market.component';
import { useEffect, useState } from 'react';
import { Button, Card, Tabs } from '@heroui/react';
import type { ServiceClient } from '../shared/service-client.hook';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { WorkspaceHero } from '../shared/workspace-hero.component';

type MarketCategory = 'all' | 'models' | 'skill' | 'automation' | 'knowledge' | 'mcp';

const CATEGORY_TABS: { value: MarketCategory; label: string }[] = [
  { value: 'all', label: 'Discover' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'mcp', label: 'Tools' },
  { value: 'skill', label: 'Skills' },
  { value: 'automation', label: 'Actions' },
  { value: 'models', label: 'Models' },
];

const SKILL_TOPICS = [
  { label: 'Science', library: 'Scientific skills', categories: [] as string[], icon: Atom01Icon, detail: 'Explore, analyse, discover', tone: 'science' },
  { label: 'AI governance', library: 'Legal and governance skills', categories: ['AI Governance', 'AI Oversight'], icon: AiBrain01Icon, detail: 'Put responsible AI into practice', tone: 'governance' },
  { label: 'AI security', library: 'Legal and governance skills', categories: ['Cybersecurity'], icon: Shield01Icon, detail: 'Build with safety in mind', tone: 'security' },
  { label: 'Law and privacy', library: 'Legal and governance skills', categories: [] as string[], icon: JusticeScale01Icon, detail: 'Navigate rights and obligations', tone: 'law' },
] as const;
const MCP_TOPICS = [{ label: 'Search & research', icon: Search01Icon }, { label: 'Developer tools', icon: CodeIcon }, { label: 'Data & analytics', icon: Database01Icon }, { label: 'Productivity', icon: Briefcase01Icon }] as const;
const CATEGORY_INTROS: Record<Exclude<MarketCategory, 'all'>, string> = {
  models: 'Find models to download and use in your workspace.',
  skill: 'Find reusable instructions and preview each skill before adding it.',
  automation: 'Choose a prompt and schedule to adapt for your work. Templates are added paused.',
  mcp: 'Connect tools and services, then choose which capabilities are available.',
  knowledge: 'Find source documents and add them to your knowledge collections.',
};

export function MarketWorkspace({ onOpenKnowledge, client, appearance: _appearance, onInstalled, onModelSetup, onUseModel, onOpenSchedules, initialCategory = 'all', focus }: {
  onOpenKnowledge: () => void;
  client: ServiceClient;
  appearance: 'light' | 'dark';
  onInstalled: () => void;
  onModelSetup: () => void;
  onOpenSchedules?: () => void;
  onUseModel?: (model: string) => void;
  initialCategory?: string;
  focus?: { id: number; category: 'skill' | 'mcp'; query?: string; group?: 'News & research' | 'Government & money' };
}) {
  const [category, setCategory] = useState<MarketCategory>(CATEGORY_TABS.some((tab) => tab.value === initialCategory) ? initialCategory as MarketCategory : 'all');
  const [topic, setTopic] = useState('');
  const [skillCategories, setSkillCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [feeds, setFeeds] = useState<KnowledgeCatalogFeed[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);

  useEffect(() => {
    const target = CATEGORY_TABS.find(tab => tab.value === initialCategory);
    if (target) setCategory(target.value);
  }, [initialCategory]);

  useEffect(() => {
    if (focus) { setCategory(focus.category); setTopic(''); setSkillCategories([]); }
  }, [focus]);

  useEffect(() => {
    if (category !== 'knowledge') return;
    let active = true;
    setLoadingFeeds(true);
    void client.json<{ feeds: KnowledgeCatalogFeed[] }>('/api/v1/knowledge-feeds').then((result) => {
      if (!active) return;
      setFeeds(result.feeds);
      setSelectedFeedId((current) => current && result.feeds.some((feed) => feed.id === current) ? current : result.feeds[0]?.id ?? null);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Knowledge catalogs could not be loaded.'); }).finally(() => { if (active) setLoadingFeeds(false); });
    return () => { active = false; };
  }, [client, category]);

  function selectCategory(next: string) {
    const value = CATEGORY_TABS.some((tab) => tab.value === next) ? next as MarketCategory : 'all';
    setCategory(value);
    setTopic('');
    setSkillCategories([]);
    setSelectedEntries([]);
    setError('');
    setNotice('');
  }

  function openSkillTopic(item: (typeof SKILL_TOPICS)[number]) {
    setCategory('skill');
    setTopic(item.library);
    setSkillCategories([...item.categories]);
    setSelectedEntries([]);
    setError('');
    setNotice('');
  }

  function selectFeed(feedId: string) {
    setSelectedFeedId(feedId);
    setSelectedEntries([]);
    setError('');
    setNotice('');
  }

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  async function installFeedEntries(feedId: string, entries: KnowledgeCatalogEntry[]) {
    if (entries.length === 0) return;
    setBusy(true); setError(''); setNotice('');
    let added = 0;
    let existing = 0;
    const failures: string[] = [];
    const completed = new Set<string>();
    try {
      for (const entry of entries) {
        try {
          const result = await client.json<{ alreadyInstalled: boolean }>(`/api/v1/knowledge-feeds/${encodeURIComponent(feedId)}/entries/${encodeURIComponent(entry.id)}/install`, { method: 'POST', body: '{}' });
          if (result.alreadyInstalled) existing += 1; else added += 1;
          completed.add(entry.id);
        } catch (reason) {
          failures.push(`${entry.title}: ${reason instanceof Error ? reason.message : 'could not be installed'}`);
        }
      }
      const current = await client.json<{ feeds: KnowledgeCatalogFeed[] }>('/api/v1/knowledge-feeds');
      setFeeds(current.feeds);
      setSelectedFeedId((selected) => selected && current.feeds.some((feed) => feed.id === selected) ? selected : current.feeds[0]?.id ?? null);
      setSelectedEntries((ids) => ids.filter((id) => !completed.has(id)));
      const parts = [`${added} ${added === 1 ? 'document' : 'documents'} saved to Knowledge`];
      if (existing) parts.push(`${existing} already installed`);
      if (failures.length) parts.push(`${failures.length} could not be installed`);
      setNotice(`${parts.join('. ')}.`);
      if (failures.length) setError(failures.join('\n'));
      if (added || existing) onInstalled();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'These documents could not be installed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className={`community-workspace market-workspace workspace-hero-page${category === 'models' ? ' market-models-view' : ''}${category === 'all' ? ' market-discover-view' : ''}${category === 'knowledge' ? ' market-knowledge-view' : ''}`} data-workspace="market" aria-label="Market">
    <WorkspaceHero icon={<WorkspaceDestinationIcon name="market" size={56} />} subtitle="Bring useful tools, knowledge and capabilities into one place." />

    <div className="market-filters">
      <Tabs selectedKey={category} onSelectionChange={(key) => { if (typeof key === 'string') selectCategory(key); }}>
        <Tabs.ListContainer>
          <Tabs.List aria-label="Market category">
            {CATEGORY_TABS.map((tab) => (
              <Tabs.Tab key={tab.value} id={tab.value} className="whitespace-nowrap">{tab.label}<Tabs.Indicator /></Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </div>

    {category === 'all' && <>
      <div className="market-discover">
        <section className="market-discover-section market-discover-skills">
          <div className="market-section-heading">
            <div>
              <span className="market-section-eyebrow">A LITTLE EXPERTISE GOES A LONG WAY</span><h2>Skills for your next idea</h2>
              <p className="market-category-description">Reusable instructions for everyday work.</p>
            </div>
            <Button variant="secondary" size="sm" onPress={() => selectCategory('skill')}>Browse skills</Button>
          </div>
          <div className="market-category-grid">
            {SKILL_TOPICS.map((item) => <button type="button" className={`market-topic-card market-skill-card market-tone-${item.tone}`} key={item.label} onClick={() => openSkillTopic(item)}><span className="market-topic-art" aria-hidden="true"><HugeiconsIcon icon={item.icon} size={40} /></span><strong>{item.label}</strong><span className="market-topic-detail">{item.detail}</span><HugeiconsIcon className="market-card-arrow" icon={ArrowUpRight01Icon} size={17} aria-hidden="true" /></button>)}
          </div>
        </section>
        <section className="market-discover-section market-feature-card market-feature-automation">
          <div className="market-feature-art" aria-hidden="true"><HugeiconsIcon icon={Calendar03Icon} size={56} /><span /><span /><span /></div><div className="market-section-heading">
            <div>
              <span className="market-section-eyebrow">MAKE ROOM FOR WHAT MATTERS</span><h2>Actions</h2>
              <p className="market-category-description">Useful routines that create Calendar schedules for review.</p>
            </div>
            <Button variant="secondary" size="sm" onPress={() => selectCategory('automation')}>Browse actions</Button>
          </div>
        </section>
        <section className="market-discover-section market-discover-mcp">
          <div className="market-section-heading">
            <div>
              <span className="market-section-eyebrow">BETTER CONNECTED</span><h2>Tools</h2>
              <p className="market-category-description">Connect tools and services to your conversations.</p>
            </div>
            <Button variant="secondary" size="sm" onPress={() => selectCategory('mcp')}>Browse tools</Button>
          </div>
          <div className="market-category-grid">
            {MCP_TOPICS.map(({ label, icon }) => <button type="button" className="market-topic-card" key={label} onClick={() => { selectCategory('mcp'); setTopic(label); }}><HugeiconsIcon icon={icon} size={22} aria-hidden="true" /><strong>{label}</strong><HugeiconsIcon icon={ArrowUpRight01Icon} size={16} aria-hidden="true" /></button>)}
          </div>
        </section>
        <section className="market-discover-section market-feature-card market-feature-knowledge">
          <div className="market-feature-art" aria-hidden="true"><HugeiconsIcon icon={BookOpen01Icon} size={56} /><span /><span /><span /></div><div className="market-section-heading">
            <div>
              <span className="market-section-eyebrow">KEEP CURIOSITY CLOSE</span><h2>Knowledge</h2>
              <p className="market-category-description">Documents and reference collections.</p>
            </div>
            <Button variant="secondary" size="sm" onPress={() => selectCategory('knowledge')}>Browse knowledge</Button>
          </div>
        </section>
        <section className="market-discover-section market-feature-card market-feature-models">
          <div className="market-feature-art" aria-hidden="true"><HugeiconsIcon icon={AiBrain01Icon} size={56} /><span /><span /><span /></div><div className="market-section-heading">
            <div>
              <span className="market-section-eyebrow">FIND YOUR THINKING PARTNER</span><h2>Models</h2>
              <p className="market-category-description">Find a model to download and use on this computer.</p>
            </div>
            <Button variant="secondary" size="sm" onPress={() => selectCategory('models')}>Browse models</Button>
          </div>
        </section>
      </div>
    </>}

    {category !== 'all' && <Card variant="tertiary" className="settings-section-intro market-section-intro rounded-2xl p-3"><Card.Description>{CATEGORY_INTROS[category]}</Card.Description></Card>}
    {category === 'models' && <LocalModelsMarket client={client} onSetup={onModelSetup} onUseModel={onUseModel} />}
    {category === 'mcp' && <><ConnectorCatalog client={client} onChanged={onInstalled} showIntro={false} /><section className="connector-custom"><McpMegaPack key={focus?.id} initialGroup={focus?.category === 'mcp' ? focus.group : undefined} client={client} onInstalled={onInstalled} /></section><section className="connector-custom"><h2>Explore the MCP registry</h2><p className="market-category-description">Browse additional community servers. Review each provider before adding a connection.</p><MarketMcpCatalog key={topic} initialSearch={topic === 'Developer tools' ? 'developer' : topic === 'Data & analytics' ? 'data' : topic === 'Productivity' ? 'productivity' : topic ? 'search' : ''} client={client} onInstalled={onInstalled} /></section></>}
    {category === 'skill' && <MarketResourceCatalog key={`${topic}:${skillCategories.join('|')}:${focus?.id ?? 0}`} topic={topic} initialCategories={skillCategories} initialQuery={focus?.category === 'skill' ? focus.query : undefined} kind="skill" client={client} onInstalled={onInstalled} />}
    {category === 'automation' && <MarketAutomationsCatalog client={client} onInstalled={onInstalled} onOpenSchedules={onOpenSchedules} />}

    {category === 'knowledge' && <section className="market-feeds" aria-label="Knowledge catalogs" aria-busy={loadingFeeds}>
      {feeds.length > 1 && <div className="market-feed-list market-feed-list-inline" aria-label="Catalog sources">
        {feeds.map((feed) => <button type="button" key={feed.id} className="market-feed-item" disabled={busy} aria-pressed={feed.id === selectedFeedId} onClick={() => selectFeed(feed.id)}><strong>{feed.name}</strong><span>{feed.entries.length} documents</span></button>)}
      </div>}
      {loadingFeeds ? <p role="status">Loading reference library…</p> : selectedFeed ? <>
        {selectedFeed.lastError && <p role="alert">{selectedFeed.lastError}</p>}
        <MarketKnowledgeCatalog key={selectedFeed.id} feed={selectedFeed} busy={busy} selected={selectedEntries} onSelectionChange={setSelectedEntries} onInstall={(entries) => void installFeedEntries(selectedFeed.id, entries)} />
      </> : !error && <div className="community-empty"><h2>No catalogs available</h2><Button size="sm" variant="secondary" onPress={onOpenKnowledge}>Manage sources</Button></div>}
    </section>}

    {notice && <Card variant="secondary" className="gap-3 p-3"><p role="status">{notice}</p><Card.Footer><Button size="sm" onPress={onOpenKnowledge}>Open knowledge</Button></Card.Footer></Card>}
    {error && <p role="alert" className="market-error">{error}</p>}
  </section>;
}
