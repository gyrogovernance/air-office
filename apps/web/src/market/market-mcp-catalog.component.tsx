import { notifyToolsChanged } from '../tools/tool-connections.hook';
import { useEffect, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';
import { Button, SearchField } from '@heroui/react';

type McpEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  sourceUrl: string;
  endpoint: string | null;
  transport: string;
  supported: boolean;
};

export function MarketMcpCatalog({ client, onInstalled, initialSearch = '' }: { client: ServiceClient; onInstalled: () => void; initialSearch?: string }) {
  const [entries, setEntries] = useState<McpEntry[]>([]);
  const [query, setQuery] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ search });
    if (cursor) params.set('cursor', cursor);
    void client.json<{ entries: McpEntry[]; nextCursor: string | null }>(`/api/v1/market/mcp?${params}`).then((result) => {
      if (active) { setEntries((current) => cursor ? [...current, ...result.entries.filter((entry) => !current.some((existing) => existing.id === entry.id))] : result.entries); setNextCursor(result.nextCursor); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'The MCP registry could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, search, cursor]);

  async function add(entry: McpEntry) {
    if (!entry.endpoint || !entry.supported) return;
    setBusy(entry.id); setError(''); setNotice('');
    try {
      await client.json('/api/v1/tools/connections', { method: 'POST', body: JSON.stringify({ id: `market-mcp-${crypto.randomUUID()}`, name: entry.name, kind: 'mcp', endpoint: entry.endpoint }) });
      setAdded((current) => [...current, entry.id]);
      setNotice(`${entry.name} added as a disabled connection. Review credentials and discover its tools in Settings → Tools before enabling it.`);
      notifyToolsChanged();
      onInstalled();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This connection could not be added.'); }
    finally { setBusy(null); }
  }

  return <section aria-label="MCP registry">
    <form className="market-filters" onSubmit={(event) => { event.preventDefault(); setEntries([]); setCursor(null); setSearch(query.trim()); }}>
      <SearchField aria-label="Search MCP servers" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon /><SearchField.Input placeholder="Find an MCP server..." /><SearchField.ClearButton /></SearchField.Group></SearchField>
      <Button type="submit" variant="secondary" size="sm" isDisabled={loading}>Search</Button>
    </form>
    <ul className="market-list">
      {entries.map((entry) => <li key={entry.id} className="market-row">
        <div className="market-row-copy"><strong>{entry.name}</strong><span>{entry.description}</span><small>{entry.version} · {entry.transport}</small>
          {entry.sourceUrl && <a href={entry.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
          {entry.endpoint && <small>{entry.endpoint}</small>}
          {!entry.supported && <small>This server has no supported remote HTTP connection.</small>}
        </div>
        <Button size="sm" isDisabled={busy !== null || added.includes(entry.id) || !entry.supported} onPress={() => void add(entry)}>{added.includes(entry.id) ? 'Added' : busy === entry.id ? 'Adding...' : 'Add connection'}</Button>
      </li>)}
    </ul>
    {loading && <p role="status">Loading MCP servers...</p>}
    {!loading && !error && entries.length === 0 && <p>No matching MCP servers.</p>}
    {nextCursor && <Button variant="secondary" size="sm" isDisabled={loading} onPress={() => setCursor(nextCursor)}>Load more</Button>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
