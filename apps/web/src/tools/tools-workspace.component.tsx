import { Button, Card, Checkbox, Input, Separator, TextArea } from '@heroui/react';
import { ConnectorCatalog } from './connector-catalog.component';
import { CONNECTOR_PRESETS, matchesConnector } from './connector-catalog.policy';
import { notifyToolsChanged, useToolConnections } from './tool-connections.hook';
import { useWorkspaceCapabilities } from '../app/workspace-capabilities.hook';
import { SelectField } from '../shared/select-field.component';
import { WebSearchSettings } from '../settings/web-search-settings.component';
import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlugSocketIcon, Wrench01Icon } from '@hugeicons/core-free-icons';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import { createServiceClient } from '../shared/service-client.hook';
import { useAppDialogs } from '../shared/app-dialogs.component';
import { sortTools, toolPresentation } from './tool-presentation.policy';

export function ToolsWorkspace() {
  const client = useMemo(() => createServiceClient(), []);
  const dialogs = useAppDialogs();
  const { connections, definitions, loading, error: loadError, refresh: reload } = useToolConnections(client);
  const capabilities = useWorkspaceCapabilities(client);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [kind, setKind] = useState<'openapi' | 'mcp'>('openapi');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  async function refresh() { notifyToolsChanged(); await reload(); }
  const customConnections = connections.filter((connection) => !CONNECTOR_PRESETS.some((preset) => matchesConnector(preset, connection)));
  async function addConnection() {
    try {
      await client.json('/api/v1/tools/connections', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), name, endpoint, kind }) });
      setName(''); setEndpoint(''); setStatus('Connection saved. Discover its tools before enabling any of them.'); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The connection could not be saved.'); }
  }
  async function toggle(definition: ToolDefinition) {
    try {
      await client.json('/api/v1/tools/enable', { method: 'POST', body: JSON.stringify({ id: definition.id, enabled: !definition.enabled }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The tool setting could not be changed.'); }
  }
  async function discover(connection: ToolConnection) {
    try {
      const result = await client.json<{ definitions: ToolDefinition[] }>(`/api/v1/tools/connections/${encodeURIComponent(connection.id)}/discover`, { method: 'POST' });
      setStatus(`Found ${result.definitions.length} tools. Turn on each tool you want to use.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Tools could not be discovered.'); }
  }
  async function toggleConnection(connection: ToolConnection) {
    try { await client.json(`/api/v1/tools/connections/${encodeURIComponent(connection.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !connection.enabled }) }); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The connection setting could not be changed.'); }
  }
  async function saveSecret(connection: ToolConnection) {
    const secret = secrets[connection.id] ?? '';
    if (!secret) return;
    try {
      await client.json(`/api/v1/tools/connections/${encodeURIComponent(connection.id)}/credential`, { method: 'PUT', body: JSON.stringify({ secret }) });
      setSecrets((current) => ({ ...current, [connection.id]: '' })); setStatus('Connection secret saved securely.'); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The connection secret could not be saved.'); }
  }
  async function invoke(definition: ToolDefinition) {
    let input: unknown;
    try { input = JSON.parse(inputs[definition.id] ?? '{}'); }
    catch { setError('Enter valid JSON for this tool.'); return; }
    const confirmed = definition.effect !== 'mutate' || await dialogs.confirm({ title: `Run ${toolPresentation(definition).name}?`, message: 'This connected tool may change data in its own service. Review the inputs before continuing.', confirmLabel: 'Run tool' });
    if (!confirmed) return;
    try {
      const result = await client.json<{ invocation: unknown }>('/api/v1/tools/invoke', { method: 'POST', body: JSON.stringify({ id: definition.id, input, confirmed }) });
      setResults((current) => ({ ...current, [definition.id]: result.invocation })); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The tool could not run.'); }
  }
  return <div className="slice-workspace">
    <Card variant="secondary" className="rounded-2xl gap-3 p-3" render={(props) => <section {...props} />} aria-label="Services"><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={PlugSocketIcon} size={18} aria-hidden="true" />Services</Card.Title></Card.Header><Separator /><ConnectorCatalog client={client} initialFilter="Configured" showIntro={false} /></Card>
    <div className="connector-custom"><Card variant="secondary" className="rounded-2xl gap-3 p-3" render={(props) => <section {...props} />} aria-label="Tool connections">
      <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={PlugSocketIcon} size={18} aria-hidden="true" />Connections</Card.Title></Card.Header><Separator />
      {!loading && !error && connections.length === 0 && <p className="slice-empty">Add an OpenAPI or MCP server to discover its tools.</p>}
      {customConnections.map((connection) => <div className="slice-tool" key={connection.id}><div className="slice-row"><span><strong>{connection.name}</strong><small>{connection.kind} · {connection.discoveredAt ? 'Tools discovered' : 'Tools not discovered'}</small></span>{connection.kind !== 'builtin' && <><Button variant="tertiary" size="sm" onPress={() => void discover(connection)}>Discover tools</Button><Checkbox aria-label={`Enable connection ${connection.name}`} isSelected={connection.enabled} onChange={() => void toggleConnection(connection)}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></>}</div>{connection.kind !== 'builtin' && <div className="slice-credential"><label>Optional bearer token<Input type="password" autoComplete="off" value={secrets[connection.id] ?? ''} onChange={(event) => setSecrets((current) => ({ ...current, [connection.id]: event.target.value }))} /></label><Button variant="tertiary" size="sm" isDisabled={!(secrets[connection.id] ?? '')} onPress={() => void saveSecret(connection)}>Save secret</Button></div>}</div>)}
      <div className="slice-form">
        <label>Connection name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Type<SelectField value={kind} onValueChange={(selectedValue) => setKind(selectedValue === 'mcp' ? 'mcp' : 'openapi')}><option value="openapi">OpenAPI</option><option value="mcp">MCP</option></SelectField></label>
        <label className="form-field-wide">Server address<Input type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://example.com" /></label>
        <div className="form-actions"><Button size="sm" aria-label="Add connection" isDisabled={!name.trim() || !endpoint.trim()} onPress={() => void addConnection()}>Add</Button></div>
      </div>
    </Card>
    {(!loading && (!error || definitions.length > 0)) && <Card variant="secondary" className="rounded-2xl gap-3 p-3" aria-label="Available tools" render={(props) => <section {...props} />}><Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Wrench01Icon} size={18} aria-hidden="true" />Available tools</Card.Title></Card.Header><Separator />{capabilities && capabilities.webSearch && !capabilities.webSearch.configured && <p className="slice-empty" role="status">Web search is switched on as a tool, but this workspace has no search provider, so a search will fail. Set the search service address below.</p>}{definitions.length === 0 && <p className="slice-empty">No tools are available. Add a connection and discover its operations.</p>}{sortTools(definitions).map((definition) => <div className="slice-tool" key={definition.id}><div className="slice-row"><span><strong>{toolPresentation(definition).name}</strong><small>{toolPresentation(definition).description}</small><small>{definition.effect === 'mutate' ? 'May change data. AIR Office asks before running it.' : 'Read only'}</small></span><Checkbox aria-label={`Enable ${toolPresentation(definition).name}`} isSelected={definition.enabled} onChange={() => void toggle(definition)}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></div><Button variant="tertiary" size="sm" aria-expanded={expanded.includes(definition.id)} onPress={() => setExpanded((current) => current.includes(definition.id) ? current.filter((id) => id !== definition.id) : [...current, definition.id])}>{expanded.includes(definition.id) ? 'Hide fields' : 'Review fields and run'}</Button>{expanded.includes(definition.id) && <div><pre>{JSON.stringify(definition.inputSchema, null, 2)}</pre><label>Input JSON<TextArea aria-label={`${toolPresentation(definition).name} input`} value={inputs[definition.id] ?? '{}'} onChange={(event) => setInputs((current) => ({ ...current, [definition.id]: event.target.value }))} /></label><Button variant="secondary" size="sm" isDisabled={!definition.enabled} onPress={() => void invoke(definition)}>Run tool</Button>{results[definition.id] !== undefined && <pre aria-label={`${toolPresentation(definition).name} result`}>{JSON.stringify(results[definition.id], null, 2)}</pre>}</div>}</div>)}</Card>}
        <WebSearchSettings />
    </div>
    {loadError && <p role="alert">{loadError}</p>}
    {loading && <p className="method-hint" role="status">Loading tools…</p>}
    {status && <p className="slice-feedback" role="status">{status}</p>}{error && <div className="slice-feedback is-error" role="alert"><p>{error}</p><Button variant="tertiary" size="sm" onPress={() => void refresh()}>Retry</Button></div>}
  </div>;
}
