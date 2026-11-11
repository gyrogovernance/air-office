import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Button, Card, Checkbox, Input, Modal, SearchField, Separator, Switch, Tag, TagGroup } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';
import type { ToolConnection } from '@office/contracts/tool';
import type { ServiceClient } from '../shared/service-client.hook';
import { CONNECTOR_PRESETS, connectorStatus, matchesConnector, type ConnectorPreset } from './connector-catalog.policy';
import { notifyToolsChanged, useToolConnections } from './tool-connections.hook';
import { ConnectorBrand } from './connector-brand.component';
import { openConnectorSignIn } from './connector-browser.adapter';
import { sortTools, toolPresentation } from './tool-presentation.policy';

type OAuthProgress = { connectionId: string; sessionId: string; authorizationUrl: string };
type OAuthStatus = { status?: string; state?: string; error?: string | null; message?: string };
type LocalStatus = { installed: boolean; running: boolean; package: string };
const localCatalogId = (preset: ConnectorPreset) => preset.id === 'atomicmail' ? 'atomic-mail' : preset.id;
const connectionPath = (id: string) => `/api/v1/tools/connections/${encodeURIComponent(id)}`;

export function ConnectorCatalog({ client, onChanged, showIntro = true, initialFilter = 'All' }: { client: ServiceClient; onChanged?: () => void; showIntro?: boolean; initialFilter?: 'All' | 'Configured' }) {
  const descriptionId = useId();
  const { connections, definitions, loading, error: loadError, refresh } = useToolConnections(client);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>(initialFilter);
  const [selected, setSelected] = useState<ConnectorPreset | null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [oauth, setOauth] = useState<OAuthProgress | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [localApproval, setLocalApproval] = useState(false);
  const popup = useRef<Window | null>(null);
  const changed = async () => { notifyToolsChanged(); await refresh(); onChanged?.(); };
  const connection = selected ? connections.find((item) => matchesConnector(selected, item)) : undefined;
  const tools = definitions.filter((item) => item.connectionId === connection?.id);

  useEffect(() => {
    if (!oauth) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await client.json<OAuthStatus>(`${connectionPath(oauth.connectionId)}/oauth/status?sessionId=${encodeURIComponent(oauth.sessionId)}`);
        if (!active) return;
        const state = result.status ?? result.state ?? 'failed';
        if (['authorized', 'connected', 'complete', 'completed', 'success'].includes(state)) {
          setOauth(null); setAuthorized(true); setNotice('Sign-in complete. Discover the available tools, then choose which to enable.');
          popup.current?.close(); popup.current = null; notifyToolsChanged(); return;
        }
        if (['failed', 'error', 'cancelled', 'canceled', 'expired', 'disconnected'].includes(state)) {
          setOauth(null); setError(result.error ?? result.message ?? `Sign-in ${state}. Start again when you are ready.`); return;
        }
        timer = setTimeout(() => void poll(), 1500);
      } catch (reason) {
        if (active) { setOauth(null); setError(reason instanceof Error ? reason.message : 'Sign-in status could not be checked.'); }
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [client, oauth]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The connection could not be updated.'); }
    finally { setBusy(false); }
  }
  async function ensureConnection(preset: ConnectorPreset): Promise<string> {
    const existing = connections.find((item) => matchesConnector(preset, item));
    if (existing) return existing.id;
    if (!preset.endpoint && preset.auth !== 'local') throw new Error('This connector has no supported server address.');
    const id = `connector-${preset.id}`;
    const configuration = preset.auth === 'local' ? { local: { catalogId: localCatalogId(preset) }, endpoint: null } : { endpoint: preset.endpoint };
    await client.json('/api/v1/tools/connections', { method: 'POST', body: JSON.stringify({ id, name: preset.name, kind: 'mcp', ...configuration }) });
    await changed(); return id;
  }
  async function discover(id: string) {
    const result = await client.json<{ definitions: unknown[] }>(`${connectionPath(id)}/discover`, { method: 'POST' });
    await changed(); setNotice(`Found ${result.definitions.length} tools. Review each tool before enabling it.`);
  }
  function open(preset: ConnectorPreset) { setSelected(preset); setSecret(''); setError(''); setNotice(''); setAuthorized(false); setLocalStatus(null); setLocalApproval(false); }
  useEffect(() => {
    if (selected?.auth !== 'local' || !connection) return;
    let active = true;
    void client.json<{ status: LocalStatus }>(`${connectionPath(connection.id)}/local/status`).then((result) => { if (active) setLocalStatus(result.status); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Local status is unavailable.'); });
    return () => { active = false; };
  }, [client, selected?.id, connection?.id]);
  async function localAction(action: 'install' | 'start' | 'stop') {
    if (!selected || (action !== 'stop' && !localApproval)) return;
    const id = await ensureConnection(selected);
    if (action === 'start' && !connection?.enabled) await client.json(connectionPath(id), { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
    await client.json(`${connectionPath(id)}/local/${action}`, { method: 'POST', body: JSON.stringify(action === 'stop' ? {} : { approved: true }) });
    setLocalApproval(false);
    setLocalStatus((await client.json<{ status: LocalStatus }>(`${connectionPath(id)}/local/status`)).status);
    await changed(); setNotice(action === 'install' ? 'Package installed. Review and approve starting it when ready.' : action === 'start' ? 'Local process started. Review its tools before enabling them.' : 'Local process stopped.');
  }
  async function cancelSignIn() {
    if (!oauth) return;
    await client.json(`${connectionPath(oauth.connectionId)}/oauth/cancel`, { method: 'POST', body: JSON.stringify({ sessionId: oauth.sessionId }) });
    popup.current?.close(); popup.current = null; setOauth(null);
  }
  async function close() {
    await run(async () => { await cancelSignIn(); setSecret(''); setSelected(null); });
  }
  function startSignIn(preset: ConnectorPreset) {
    // Reserve a browser window during the click so asynchronous setup does not trigger popup blocking.
    popup.current = window.airDesktop ? null : window.open('about:blank', '_blank');
    if (popup.current) popup.current.opener = null;
    void run(async () => {
      try {
        const id = await ensureConnection(preset);
        const result = await client.json<{ authorizationUrl: string; sessionId: string }>(`${connectionPath(id)}/oauth/start`, { method: 'POST' });
        setOauth({ connectionId: id, ...result });
        try { await openConnectorSignIn(result.authorizationUrl, popup.current); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Open the sign-in page to continue.'); }
      } catch (reason) { popup.current?.close(); popup.current = null; throw reason; }
    });
  }
  async function toggleConnection(item: ToolConnection) {
    await client.json(connectionPath(item.id), { method: 'PATCH', body: JSON.stringify({ enabled: !item.enabled }) }); await changed();
  }

  const visible = CONNECTOR_PRESETS.filter((preset) => (filter === 'All' || filter === 'Configured' && connections.some((item) => matchesConnector(preset, item)) || preset.category === filter) && `${preset.name} ${preset.description} ${preset.category}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="connector-catalog" aria-label="Connectors">
    {showIntro && <header className="connector-heading"><div><h2>Connect your everyday tools</h2><p>Bring context and actions into AIR Office. You choose which tools are available.</p></div><span className="connector-count">{CONNECTOR_PRESETS.length} connectors</span></header>}
    <div className="connector-toolbar"><div className="connector-search"><SearchField aria-label="Search connectors" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon><HugeiconsIcon icon={Search01Icon} size={17} /></SearchField.SearchIcon><SearchField.Input placeholder="Search connectors…" /><SearchField.ClearButton /></SearchField.Group></SearchField></div><TagGroup aria-label="Filter connectors" selectionMode="single" disallowEmptySelection selectedKeys={[filter]} onSelectionChange={(keys) => { if (keys !== 'all') { const value = Array.from(keys)[0]; if (typeof value === 'string') setFilter(value); } }}><TagGroup.List className="connector-filters">{['All', 'Configured', 'Research', 'Productivity', 'Development', 'Business'].map((value) => <Tag key={value} id={value}>{value}</Tag>)}</TagGroup.List></TagGroup></div>
    {loading && <p role="status">Loading your connections…</p>}
    {loadError && <div role="alert"><p>{loadError}</p><Button variant="secondary" size="sm" onPress={() => void refresh()}>Retry connections</Button></div>}
    <div className="connector-grid">{visible.map((preset) => {
      const installed = connections.find((item) => matchesConnector(preset, item));
      const count = definitions.filter((tool) => tool.connectionId === installed?.id).length;
      return <Card key={preset.id} className="connector-card" data-connector={preset.id} render={(props) => <article {...props} />}>
        <Card.Header className="connector-card-header">
          <div className="connector-card-top"><span className="connector-mark" style={{ '--connector-color': preset.color } as CSSProperties} aria-hidden="true"><ConnectorBrand id={preset.id} name={preset.name} /></span><div className="connector-card-name"><Card.Title>{preset.name}</Card.Title><span className="connector-category">{preset.category}</span></div></div>
          <Card.Description>{preset.description}</Card.Description>
        </Card.Header>
        <Separator />
        <Card.Footer className="connector-card-actions"><div className="connector-state"><span className={`connector-status${installed?.discoveredAt ? ' is-discovered' : ''}`}>{preset.auth === 'local' && !installed ? 'Local setup required' : connectorStatus(installed)}</span>{count > 0 && <span>{count} tools</span>}</div><div className="connector-card-controls"><Button variant={installed ? 'secondary' : 'tertiary'} size="sm" isDisabled={loading || Boolean(loadError) || busy || Boolean(oauth)} onPress={() => open(preset)} aria-label={`${installed ? 'Manage' : 'Set up'} ${preset.name}`}>{installed ? 'Manage' : preset.auth === 'local' ? 'View setup' : 'Connect'}</Button>{installed && <Switch isSelected={installed.enabled} isDisabled={busy || Boolean(oauth)} onChange={() => void run(() => toggleConnection(installed))}><Switch.Content aria-label={`Enable connection ${preset.name}`}><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch>}</div></Card.Footer>
      </Card>;
    })}</div>
    {visible.length === 0 && <p className="connector-empty">{filter === 'Configured' && !query ? 'No services connected.' : 'No connectors match this search. Try another name or category.'}</p>}
    {!selected && error && <p role="alert">{error}</p>}
    <Modal.Backdrop isOpen={selected !== null} isDismissable={false} onOpenChange={(value) => { if (!value && !busy) void close(); }} className="connector-dialog-backdrop"><Modal.Container placement="center"><Modal.Dialog className="connector-dialog" aria-describedby={descriptionId}>
      {selected && <><header className="connector-dialog-heading"><div><Modal.Heading>{selected.name}</Modal.Heading><p id={descriptionId}>{selected.description}</p></div><Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void close()}>Close</Button></header>
        <a href={selected.docs} target="_blank" rel="noreferrer">Provider documentation ↗</a>
        {selected.auth === 'local' ? <div className="connector-guidance"><h3>Run a local connector</h3><p>Installing downloads the curated package with npm. Starting runs third-party code on this computer with your user account’s access. Node.js and npm must be installed. Stop the process when you finish.</p>{localStatus && <p role="status">{localStatus.running ? 'Running' : localStatus.installed ? 'Installed · Stopped' : 'Not installed'}<small className="connector-endpoint">{localStatus.package}</small></p>}<Checkbox className="connector-approval" isSelected={localApproval} onChange={setLocalApproval}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>I approve downloading or running this provider’s local package.</Checkbox.Content></Checkbox><div className="connector-local-actions"><Button variant="secondary" size="sm" isDisabled={busy || !localApproval || localStatus?.running} onPress={() => void run(() => localAction('install'))}>Install package</Button><Button size="sm" isDisabled={busy || !localApproval || !localStatus?.installed || localStatus.running} onPress={() => void run(() => localAction('start'))}>Enable and start connector</Button><Button variant="secondary" size="sm" isDisabled={busy || !connection} onPress={() => void run(() => localAction('stop'))}>Stop connector</Button></div></div> : <>
          <div className="connector-guidance"><h3>{connection ? 'Connection settings' : 'Set up your connection'}</h3><p>{selected.auth === 'oauth' ? 'Sign in on the provider’s website and review the access requested. Return here to discover and review tools.' : selected.auth === 'key' ? 'Create an API key in your provider account, then save it securely to the AIR Office service. Your key is cleared from this form after saving.' : 'Add this remote service, discover its tools and choose what to enable.'}</p><small className="connector-endpoint">{selected.endpoint}</small></div>
        </>}
          {(selected.auth === 'key' || selected.id === 'resend') && <form className="connector-key-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const id = await ensureConnection(selected); await client.json(`${connectionPath(id)}/credential`, { method: 'PUT', body: JSON.stringify({ secret: secret.trim() }) }); setSecret(''); await changed(); setNotice('API key saved securely. Discover tools to verify access.'); }); }}><a href={selected.keyUrl ?? 'https://resend.com/api-keys'} target="_blank" rel="noreferrer">Get an API key ↗</a><label>API key<Input type="password" autoComplete="off" spellCheck={false} value={secret} onChange={(event) => setSecret(event.target.value)} /></label><Button type="submit" size="sm" isDisabled={busy || !secret.trim()}>Save API key</Button></form>}
          {selected.auth === 'oauth' && <div className="connector-oauth">{oauth ? <><p role="status">Waiting for sign-in in your browser…</p><Button variant="tertiary" size="sm" onPress={() => void run(() => openConnectorSignIn(oauth.authorizationUrl))}>Open sign-in page ↗</Button><Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void run(cancelSignIn)}>Cancel sign-in</Button></> : <Button size="sm" isDisabled={busy} onPress={() => startSignIn(selected)}>{authorized ? 'Sign in again' : 'Sign in with browser'}</Button>}{connection && !oauth && <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void run(async () => { await client.json(`${connectionPath(connection.id)}/oauth/disconnect`, { method: 'POST' }); setAuthorized(false); await changed(); setNotice('Sign-in removed. Sign in again to restore access.'); })}>Remove sign-in</Button>}</div>}
          <div className="connector-review-heading"><h3>Available tools</h3>{selected.auth !== 'local' && <Button variant="secondary" size="sm" isDisabled={busy || Boolean(oauth)} onPress={() => void run(async () => { await discover(await ensureConnection(selected)); })}>{busy ? 'Working…' : 'Discover tools'}</Button>}</div>
          {tools.length === 0 && <p className="connector-help">{selected.auth === 'local' ? 'Start the connector to discover its tools, then enable only the tools you want to use.' : 'Discover tools to check access. Connections and individual tools remain off until you enable them.'}</p>}
          {sortTools(tools).map((tool) => <div className="connector-tool" key={tool.id}><span><strong>{toolPresentation(tool).name}</strong><span>{toolPresentation(tool).description}</span><small>{tool.effect === 'mutate' ? 'May change data; confirmation required when running.' : 'Read only'}</small></span><Checkbox aria-label={`Enable ${toolPresentation(tool).name}`} isSelected={tool.enabled} isDisabled={busy || Boolean(oauth)} onChange={() => void run(async () => { await client.json('/api/v1/tools/enable', { method: 'POST', body: JSON.stringify({ id: tool.id, enabled: !tool.enabled }) }); await changed(); })}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></div>)}
          {connection && <div className="connector-enable-row"><span>Enable this connection<small>Only the tools you select are available to conversations.</small></span><Switch isSelected={connection.enabled} isDisabled={busy || Boolean(oauth)} onChange={() => void run(() => toggleConnection(connection))}><Switch.Content aria-label={`Enable connection ${selected.name} in dialog`}><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div>}
        {notice && <p role="status" className="connector-notice">{notice}</p>}{error && <p role="alert" className="connector-error">{error}</p>}
      </>}
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </section>;
}
