import { useEffect, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';
import type { AutomationDefinition } from '@office/automations/domain';
import { MarbleBeamAvatar } from '../app/marble-beam-avatar.component';
import { Avatar, Button, Modal, SearchField, Tag, TagGroup } from '@heroui/react';
import { SelectField } from '../shared/select-field.component';
import { Streamdown } from 'streamdown';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';

type CatalogEntry = {
  id: string;
  kind: 'skill' | 'automation';
  name: string;
  description: string;
  instructions?: string;
  sourceUrl: string;
  license: string;
  category?: string;
  library?: string;
  definition?: AutomationDefinition;
};

export function MarketResourceCatalog({ kind, client, onInstalled, topic = '', initialCategories = [], initialQuery = '' }: {
  kind: 'skill' | 'automation';
  topic?: string;
  initialCategories?: string[];
  initialQuery?: string;
  client: ServiceClient;
  onInstalled: () => void;
}) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [library, setLibrary] = useState(topic);
  const [category, setCategory] = useState(initialCategories.length === 1 ? initialCategories[0]! : '');
  const [topicCategories, setTopicCategories] = useState(initialCategories);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ description: string; instructions: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const initialCategoryKey = initialCategories.join('|');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSelected(null); setNotice('');
    void client.json<{ entries: CatalogEntry[] }>(`/api/v1/market/catalog?kind=${kind}`).then((result) => {
      if (active) setEntries(result.entries);
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'The catalog could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, kind]);

  useEffect(() => {
    setLibrary(topic);
    setTopicCategories(initialCategories);
    setCategory(initialCategories.length === 1 ? initialCategories[0]! : '');
  }, [topic, initialCategoryKey]);

  useEffect(() => {
    if (!selected || selected.kind !== 'skill') return;
    let active = true;
    setPreview(null); setPreviewError(''); setPreviewLoading(true);
    void client.json<{ description: string; instructions: string }>(`/api/v1/market/skills/preview?id=${encodeURIComponent(selected.id)}`)
      .then((content) => { if (active) setPreview(content); })
      .catch((reason: unknown) => { if (active) setPreviewError(reason instanceof Error ? reason.message : 'Skill preview unavailable.'); })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [client, selected]);

  async function install(entry: CatalogEntry) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (entry.kind === 'skill') {
        await client.json('/api/v1/market/skills/install', { method: 'POST', body: JSON.stringify({ id: entry.id }) });
        setNotice(`${entry.name} added to Skills as an editable copy.`);
      } else {
        if (!entry.definition) throw new Error('This automation has no installable definition.');
        const now = new Date().toISOString();
        await client.json('/api/v1/calendar/import', { method: 'POST', body: JSON.stringify({ bundle: { schema_version: 1, calendars: [], events: [], automations: [{ ...entry.definition, id: crypto.randomUUID(), enabled: false, createdAt: now, updatedAt: now }] } }) });
        setNotice(`${entry.name} added paused. Review its schedule and settings before enabling it.`);
      }
      setInstalled((current) => [...current, entry.id]);
      onInstalled();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This resource could not be added.');
    } finally { setBusy(false); }
  }

  const libraries = kind === 'skill' ? [...new Set(entries.map((entry) => entry.library).filter((name): name is string => Boolean(name)))] : [];
  const inLibrary = entries.filter((entry) => !library || entry.library === library);
  const scoped = topicCategories.length ? inLibrary.filter((entry) => entry.category && topicCategories.includes(entry.category)) : inLibrary;
  const categories = kind === 'skill' ? [...new Set(scoped.map((entry) => entry.category).filter((name): name is string => Boolean(name)))].sort((left, right) => left.localeCompare(right)) : [];
  const visible = scoped.filter((entry) => (!category || entry.category === category) && `${entry.name} ${entry.description} ${entry.category ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <section aria-label={kind === 'skill' ? 'Skills catalog' : 'Automations catalog'}>
    <div className="market-filters"><SearchField aria-label={kind === 'skill' ? 'Search Skills' : 'Search Automations'} value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Search this catalog..." /><SearchField.ClearButton /></SearchField.Group></SearchField></div>
    {libraries.length > 0 && <TagGroup aria-label="Skill libraries" selectionMode="single" disallowEmptySelection selectedKeys={[library || 'all']} onSelectionChange={(keys) => { if (keys !== 'all') { const next = String([...keys][0] ?? 'all'); setLibrary(next === 'all' ? '' : next); setCategory(''); } }}>
      <TagGroup.List className="market-category-bar"><Tag id="all">All libraries</Tag>{libraries.map((name) => <Tag id={name} key={name}>{name}</Tag>)}</TagGroup.List>
    </TagGroup>}
    {categories.length > 1 && <label className="market-category-label">Category
      <SelectField aria-label="Skill category" value={category} onValueChange={setCategory}>
        <option value="">All categories</option>
        {categories.map((name) => <option key={name} value={name}>{name}</option>)}
      </SelectField>
    </label>}
    {loading && <p role="status">Loading catalog...</p>}
    <ul className="market-list">
      {visible.map((entry) => <li key={entry.id} className={`market-row market-row-${kind} market-resource-row`}>
          {kind === 'skill' && <Avatar size="sm" aria-hidden="true"><Avatar.Fallback><MarbleBeamAvatar name={entry.name} size={32} shape="app"/></Avatar.Fallback></Avatar>}
          <span className="market-row-copy"><strong>{entry.name}</strong><span>{entry.description}</span><small>{entry.license}{installed.includes(entry.id) ? ' · Added' : ''}</small></span>
          <Button variant="secondary" size="sm" onPress={() => { setSelected(entry); setError(''); setNotice(''); }}>View details<span className="sr-only"> for {entry.name}</span></Button>
      </li>)}
    </ul>
    {!loading && !error && visible.length === 0 && <p>No matching resources in the configured sources.</p>}
    {!selected && error && <p role="alert">{error}</p>}
    {selected && <Modal.Backdrop isOpen onOpenChange={(open) => { if (!open && !busy) setSelected(null); }}><Modal.Container><Modal.Dialog className="market-skill-dialog" aria-labelledby="market-catalog-title">
        <Modal.Header><Modal.Heading id="market-catalog-title">{selected.name}</Modal.Heading></Modal.Header>
        <Modal.Body><p>{preview?.description || selected.description}</p>
        {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
        <p>{selected.license}</p>
        {selected.kind === 'skill' ? <>{previewLoading && <p role="status">Loading skill instructions...</p>}{previewError && <p role="alert">{previewError}</p>}{preview && <section aria-label="Skill instructions"><h3>Instructions</h3><div className="market-content-preview prose"><Streamdown components={MARKDOWN_COMPONENTS} mode="static" parseIncompleteMarkdown={false} controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{preview.instructions}</Streamdown></div></section>}</> : <section aria-label="Automation definition"><h3>Definition</h3><div className="market-content-preview prose"><Streamdown components={MARKDOWN_COMPONENTS} mode="static" parseIncompleteMarkdown={false} controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{JSON.stringify(selected.definition, null, 2)}</Streamdown></div></section>}
        {selected.kind === 'automation' && <p>Installs paused. Choose the provider and review the schedule in Schedules before enabling.</p>}
        {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" isDisabled={busy} onPress={() => setSelected(null)}>Close</Button>
          <Button isDisabled={busy || installed.includes(selected.id) || (selected.kind === 'skill' && !preview)} onPress={() => void install(selected)}>{installed.includes(selected.id) ? 'Added' : busy ? 'Adding...' : 'Add to workspace'}</Button>
        </Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>}
  </section>;
}
