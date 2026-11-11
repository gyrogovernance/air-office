import { useId, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookOpen01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { Button, Checkbox, SearchField } from '@heroui/react';
import { SelectField } from '../shared/select-field.component';

export type KnowledgeCatalogEntry = {
  id: string;
  collectionId: string;
  collectionName: string;
  category?: string;
  filename: string;
  title: string;
  description: string;
  publisher: string;
  edition: string;
  sourceUrl: string;
  rights: string;
  rightsUrl: string;
  mediaType: string;
  installed: boolean;
};

export type KnowledgeCatalogFeed = {
  id: string;
  name: string;
  description: string;
  lastError: string | null;
  entries: KnowledgeCatalogEntry[];
};

function sourceLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch { return undefined; }
}

export function MarketKnowledgeCatalog({ feed, busy, selected, onSelectionChange, onInstall }: {
  feed: KnowledgeCatalogFeed;
  busy: boolean;
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
  onInstall: (entries: KnowledgeCatalogEntry[]) => void;
}) {
  const idPrefix = useId();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [availability, setAvailability] = useState('all');
  const [showSources, setShowSources] = useState(false);
  const categoryOf = (entry: KnowledgeCatalogEntry) => entry.category || entry.collectionName;
  const categories = [...new Set(feed.entries.map(categoryOf))];
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const visible = feed.entries.filter((entry) => {
    const text = `${entry.title} ${entry.description} ${entry.collectionName} ${categoryOf(entry)} ${entry.publisher} ${entry.edition} ${entry.filename}`.toLocaleLowerCase();
    return (!category || categoryOf(entry) === category)
      && (availability === 'all' || entry.installed === (availability === 'installed'))
      && words.every((word) => text.includes(word));
  });
  const available = visible.filter((entry) => !entry.installed);
  const chosen = feed.entries.filter((entry) => !entry.installed && selected.includes(entry.id));
  const allVisibleSelected = available.length > 0 && available.every((entry) => selected.includes(entry.id));
  const groups = categories.map((name) => ({ id: name, name, entries: visible.filter((entry) => categoryOf(entry) === name) })).filter((group) => group.entries.length > 0);

  return <div className="knowledge-catalog">
    <div className="knowledge-catalog-filters">
      <div className="knowledge-catalog-search"><SearchField fullWidth aria-label="Search Knowledge" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon><HugeiconsIcon icon={Search01Icon} size={18} aria-hidden="true" /></SearchField.SearchIcon><SearchField.Input placeholder="Search documents, topics or publishers" /><SearchField.ClearButton /></SearchField.Group></SearchField></div>
      <label className="knowledge-catalog-filter"><span>Category</span><SelectField aria-label="Category" value={category} onValueChange={setCategory}><option value="">All categories</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</SelectField></label>
      <label className="knowledge-catalog-filter"><span>Show</span><SelectField aria-label="Show" value={availability} onValueChange={setAvailability}><option value="all">All documents</option><option value="available">Not added</option><option value="installed">Added</option></SelectField></label>
      <Checkbox className="knowledge-source-toggle" isSelected={showSources} onChange={setShowSources}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Source details</Checkbox.Content></Checkbox>
    </div>

    <div className="knowledge-catalog-selection">
      <Checkbox className="market-entry-select-all" aria-label="Select visible documents not added" isSelected={allVisibleSelected} isIndeterminate={!allVisibleSelected && available.some((entry) => selected.includes(entry.id))} isDisabled={busy || available.length === 0} onChange={(checked) => onSelectionChange(checked ? [...new Set([...selected, ...available.map((entry) => entry.id)])] : selected.filter((id) => !available.some((entry) => entry.id === id)))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span>{chosen.length ? `${chosen.length} selected` : visible.length === feed.entries.length ? `${visible.length} documents` : `${visible.length} of ${feed.entries.length} documents`}</span></Checkbox.Content></Checkbox>
      <div className="knowledge-catalog-actions">
        {chosen.length > 0 && <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => onSelectionChange([])}>Clear</Button>}
        <Button size="sm" className="market-add-button" isDisabled={busy || chosen.length === 0} onPress={() => onInstall(chosen)}>{busy ? 'Adding…' : chosen.length ? `Add ${chosen.length} to Knowledge` : 'Add selected'}</Button>
      </div>
    </div>

    {groups.map((group) => {
      const publishers = [...new Set(group.entries.map((entry) => entry.publisher))];
      return <section className="knowledge-collection" key={group.id} aria-label={group.name}>
        <header className="knowledge-collection-heading"><span className="knowledge-collection-icon" aria-hidden="true"><HugeiconsIcon icon={BookOpen01Icon} size={20} /></span><div><h2>{group.name}</h2>{publishers.length === 1 && <p>{publishers[0]}</p>}</div><span className="knowledge-collection-count">{group.entries.length} docs</span></header>
        <ul className="knowledge-document-list">
          {group.entries.map((entry) => <li className="knowledge-document" key={entry.id}>
            <div className="knowledge-document-main">
              <Checkbox id={`${idPrefix}-${entry.id}`} aria-label={`Select ${entry.title}`} isSelected={entry.installed || selected.includes(entry.id)} isDisabled={busy || entry.installed} onChange={(checked) => onSelectionChange(checked ? [...new Set([...selected, entry.id])] : selected.filter((id) => id !== entry.id))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
              <div className="knowledge-document-copy"><h3>{sourceLink(entry.sourceUrl) ? <a href={sourceLink(entry.sourceUrl)} target="_blank" rel="noreferrer">{entry.title}<span aria-hidden="true"> ↗</span></a> : <label htmlFor={`${idPrefix}-${entry.id}`}>{entry.title}</label>}</h3>{entry.description && entry.description !== entry.title && <p>{entry.description}</p>}</div>
              <span className={`knowledge-document-state${entry.installed ? ' is-installed' : ''}`}>{entry.installed ? 'Added' : entry.mediaType === 'application/pdf' ? 'PDF' : 'Text'}</span>
            </div>
            {showSources && <div className="knowledge-document-details"><p>{entry.publisher} · {entry.edition}</p><p>{entry.rights}</p>{sourceLink(entry.rightsUrl) && <a href={sourceLink(entry.rightsUrl)} target="_blank" rel="noreferrer">Reuse terms ↗</a>}</div>}
          </li>)}
        </ul>
      </section>;
    })}
    {visible.length === 0 && <div className="community-empty"><HugeiconsIcon icon={Search01Icon} size={28} aria-hidden="true" /><h2>No matching documents</h2><p>Try another search or clear your filters.</p><Button variant="secondary" size="sm" onPress={() => { setQuery(''); setCategory(''); setAvailability('all'); }}>Clear filters</Button></div>}
  </div>;
}
