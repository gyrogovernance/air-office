import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import type { ServiceClient } from '../shared/service-client.hook';
import { notifyToolsChanged, useToolConnections } from '../tools/tool-connections.hook';
import { MEGA_PACK_GROUPS, MEGA_PACK_SERVERS, megaPackConnectionId, megaPackEndpoint, megaPackInstalled, type MegaPackGroup, type MegaPackServer } from './mcp-mega-pack.policy';
import { Button, SearchField, Tag, TagGroup } from '@heroui/react';

/**
 * The cyanheads mega pack: one publisher's fleet of public-data MCP servers,
 * hosted and keyless. Adding a server creates a disabled connection and
 * discovers its tools, so the reader reviews what a server can do before any
 * of it reaches a conversation.
 */
export function McpMegaPack({ client, onInstalled, initialGroup = 'All' }: { client: ServiceClient; onInstalled: () => void; initialGroup?: MegaPackGroup | 'All' }) {
  const { connections, definitions, loading, error: loadError, refresh } = useToolConnections(client);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<MegaPackGroup | 'All'>(initialGroup);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MEGA_PACK_SERVERS.filter((server) => (group === 'All' || server.group === group)
      && `${server.name} ${server.description} ${server.source}`.toLowerCase().includes(needle));
  }, [query, group]);

  async function add(server: MegaPackServer) {
    setBusy(server.id); setError(''); setNotice('');
    try {
      const id = megaPackConnectionId(server);
      await client.json('/api/v1/tools/connections', {
        method: 'POST',
        body: JSON.stringify({ id, name: server.name, kind: 'mcp', endpoint: megaPackEndpoint(server) })
      });
      const result = await client.json<{ definitions: unknown[] }>(`/api/v1/tools/connections/${encodeURIComponent(id)}/discover`, { method: 'POST' });
      notifyToolsChanged();
      await refresh();
      onInstalled();
      setNotice(`${server.name} added with ${result.definitions.length} tools, all off. Review them in Settings → Tools and enable only what you need.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${server.name} could not be added.`);
    } finally { setBusy(null); }
  }

  return <section className="mega-pack" aria-label="Mega pack">
    <header className="market-section-heading">
      <div>
        <h2>Mega pack · {MEGA_PACK_SERVERS.length} public-data servers</h2>
        <p className="market-category-description">One publisher’s hosted fleet. Every server is keyless and reads a public dataset, so adding one needs no account.</p>
      </div>
    </header>
    <div className="mega-pack-toolbar">
      <div className="connector-search">
        <SearchField aria-label="Search the mega pack" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon><HugeiconsIcon icon={Search01Icon} size={17} /></SearchField.SearchIcon><SearchField.Input placeholder="Search servers or datasets..." /><SearchField.ClearButton /></SearchField.Group></SearchField>
      </div>
      <TagGroup aria-label="Filter mega pack" selectionMode="single" disallowEmptySelection selectedKeys={[group]} onSelectionChange={(keys) => {
        if (keys === 'all') return;
        const next = (['All', ...MEGA_PACK_GROUPS] as const).find((value) => keys.has(value));
        if (next) setGroup(next);
      }}>
        <TagGroup.List className="flex flex-wrap gap-1">
          {(['All', ...MEGA_PACK_GROUPS] as const).map((value) => <Tag id={value} key={value}>{value}</Tag>)}
        </TagGroup.List>
      </TagGroup>
    </div>
    {loading && <p role="status">Loading your connections...</p>}
    {loadError && <p role="alert">{loadError}</p>}
    <ul className="market-list" aria-label="Mega pack servers">
      {visible.map((server) => {
        const installed = megaPackInstalled(server, connections);
        const count = definitions.filter((tool) => tool.connectionId === installed?.id).length;
        return <li key={server.id} className="market-row mega-pack-row">
          <div className="market-row-copy">
            <strong>{server.name}</strong>
            <span>{server.description}</span>
            <small>{server.group} · {server.source}{count > 0 ? ` · ${count} tools` : ''}</small>
          </div>
          <Button
            variant={installed ? 'secondary' : undefined}
            size="sm"
            className="market-add-button"
            isDisabled={busy !== null || loading || Boolean(loadError) || Boolean(installed)}
            onPress={() => void add(server)}
          >
            {installed ? 'Added' : busy === server.id ? 'Adding...' : 'Add'}
          </Button>
        </li>;
      })}
    </ul>
    {!loading && visible.length === 0 && <p className="connector-empty">No servers match this search.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
