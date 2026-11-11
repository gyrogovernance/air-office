import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Button, Checkbox, Input, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { GlobeIcon } from '@hugeicons/core-free-icons';
import { createServiceClient } from '../shared/service-client.hook';
import { notifyCapabilitiesChanged } from '../app/workspace-capabilities.hook';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { SelectField } from '../shared/select-field.component';
import { effectiveFlagValue, setSettingsValue, INSTANCE_SETTINGS_KEY } from './settings.store';
import { WEB_SEARCH_REGIONS } from './settings.policy';
import { ensureWindowsNetworkAccess } from '../shared/windows-network-access.adapter';

/**
 * Records the loader options as advanced settings, so the searchable settings
 * list and this panel never disagree about what the search service does.
 */
function writeSearchFlags(options: { timeoutMs: number; maxConcurrentRequests: number; verifySsl: boolean; bypassWebLoader: boolean; trustProxyEnvironment: boolean; region: string }): void {
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.timeout', options.timeoutMs);
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.max-concurrent-requests', options.maxConcurrentRequests);
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.verify-ssl', options.verifySsl);
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.bypass-web-loader', options.bypassWebLoader);
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.trust-proxy-environment', options.trustProxyEnvironment);
  setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.region', options.region);
}

interface WebSearchState {
  configured: boolean;
  enabled: boolean;
  provider: string | null;
  endpoint: string | null;
  builtIn: boolean;
  reachable: boolean | null;
  reason: 'ok' | 'disabled' | 'unreachable' | 'unreadable' | null;
  detail: string | null;
  timeoutMs?: number;
  verifySsl?: boolean;
  maxConcurrentRequests?: number;
  bypassWebLoader?: boolean;
  trustProxyEnvironment?: boolean;
  region?: string;
}

type WebSearchCheck = WebSearchState & { reachable: boolean; reason: 'ok' | 'disabled' | 'unreachable' | 'unreadable'; detail: string | null };

/**
 * Sets the search engine this workspace uses.
 *
 * The built-in engine needs no API key and no service the user has to run,
 * so web search works out of the box. A search service the user runs, such
 * as a local SearXNG instance, takes its place when its address is set.
 */
export function WebSearchSettings() {
  const client = useMemo(() => createServiceClient(), []);
  const [state, setState] = useState<WebSearchState | null>(null);
  const [endpoint, setEndpoint] = useState('');
  // The loader options carry their own defaults, so a control is never empty
  // before the setting has been read. The advanced flags hold the same
  // defaults, so both surfaces start from the same value.
  const [timeoutMs, setTimeoutMs] = useState(() => String(effectiveFlagValue('web-search.timeout') ?? 15000));
  const [maxConcurrentRequests, setMaxConcurrentRequests] = useState(() => String(effectiveFlagValue('web-search.max-concurrent-requests') ?? 1));
  const [verifySsl, setVerifySsl] = useState(() => effectiveFlagValue('web-search.verify-ssl') !== false);
  const [bypassWebLoader, setBypassWebLoader] = useState(() => effectiveFlagValue('web-search.bypass-web-loader') === true);
  const [trustProxyEnvironment, setTrustProxyEnvironment] = useState(() => effectiveFlagValue('web-search.trust-proxy-environment') !== false);
  const [region, setRegion] = useState(() => {
    const stored = effectiveFlagValue('web-search.region');
    return typeof stored === 'string' && WEB_SEARCH_REGIONS.some((entry) => entry.value === stored) ? stored : 'wt-wt';
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const value = await client.json<WebSearchState>('/api/v1/web-search');
      setState(value);
      setEndpoint(value.endpoint ?? '');
      setTimeoutMs(String(value.timeoutMs ?? 15000));
      setMaxConcurrentRequests(String(value.maxConcurrentRequests ?? 1));
      setVerifySsl(value.verifySsl !== false);
      setBypassWebLoader(value.bypassWebLoader === true);
      setTrustProxyEnvironment(value.trustProxyEnvironment !== false);
      setRegion(value.region ?? 'wt-wt');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The search setting could not be read.'); }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setStatus(''); setError('');
    try {
      const value = await client.json<WebSearchState>('/api/v1/web-search', { method: 'PUT', body: JSON.stringify({
        endpoint: endpoint.trim() || null,
        timeoutMs: Number(timeoutMs),
        maxConcurrentRequests: Number(maxConcurrentRequests),
        verifySsl,
        bypassWebLoader,
        trustProxyEnvironment,
        region
      }) });
      setState(value);
      notifyCapabilitiesChanged();
      // The loader options are also advanced settings, so a change made here
      // is visible in the searchable list and a change made there is the
      // value this panel starts from.
      writeSearchFlags({ timeoutMs: Number(timeoutMs), maxConcurrentRequests: Number(maxConcurrentRequests), verifySsl, bypassWebLoader, trustProxyEnvironment, region });
      setStatus(value.configured ? 'Search engine saved. Web search is available to the assistant.' : 'Search engine saved, but no engine could be built for it.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The search engine could not be saved.'); }
    finally { setBusy(false); }
  }

  async function useBuiltIn() {
    setBusy(true); setStatus(''); setError('');
    try {
      const value = await client.json<WebSearchState>('/api/v1/web-search', { method: 'PUT', body: JSON.stringify({ endpoint: null }) });
      setState(value); setEndpoint('');
      notifyCapabilitiesChanged();
      setStatus('Free search is in use.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The built-in search engine could not be selected.'); }
    finally { setBusy(false); }
  }

  async function toggle() {
    setBusy(true); setStatus(''); setError('');
    try {
      const next = !(state?.enabled ?? true);
      if (next) {
        const network = await ensureWindowsNetworkAccess().catch(() => null);
        if (network && !network.prepared) setStatus(network.detail);
      }
      const value = await client.json<WebSearchState>('/api/v1/web-search', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      setState(value);
      notifyCapabilitiesChanged();
      setStatus(next ? 'Web search is switched on. Network access is prepared for the built-in search helper.' : 'Web search is switched off.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Web search could not be switched.'); }
    finally { setBusy(false); }
  }

  /** The region is a preference, not a connection detail, so it saves as soon as it is chosen. */
  async function saveRegion(next: string) {
    setRegion(next);
    setBusy(true); setError('');
    try {
      const value = await client.json<WebSearchState>('/api/v1/web-search', { method: 'PUT', body: JSON.stringify({ region: next }) });
      setState(value);
      // Only this flag moves here; the other advanced fields keep whatever the
      // panel currently shows and are written together by Save settings.
      setSettingsValue(INSTANCE_SETTINGS_KEY, 'web-search.region', next);
      notifyCapabilitiesChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The search region could not be saved.'); }
    finally { setBusy(false); }
  }

  async function check() {
    setBusy(true); setStatus(''); setError('');
    try {
      const network = await ensureWindowsNetworkAccess().catch(() => null);
      const value = await client.json<WebSearchCheck>('/api/v1/web-search/check', { method: 'POST' });
      setState(value);
      if (value.reachable) { setStatus(network?.elevated ? `${network.detail} Search is working.` : 'Search is working.'); return; }
      // The reason decides the fix, so it is shown rather than a generic
      // "it did not answer".
      if (value.reason === 'disabled') { setError('Web search is switched off for this workspace.'); return; }
      if (value.reason === 'unreadable') { setError(value.detail ?? 'The search engine answered with no readable results.'); return; }
      setError(value.detail ?? 'Search is temporarily unavailable. Try again shortly.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The search engine could not be checked.'); }
    finally { setBusy(false); }
  }

  const enabled = state?.enabled !== false;
  const statusLabel = !enabled ? 'Off' : state?.reachable === true ? 'Ready' : state?.reachable === false ? 'Temporarily unavailable' : 'Not tested yet';
  return <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Web search">
    <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={GlobeIcon} size={18} aria-hidden="true"/>Web search</Card.Title></Card.Header><Separator />
    <p className="settings-pref-help">Let your assistant search the web and open pages for up-to-date answers. Free search is included. No account or API key needed. On Windows, turning search on or testing it registers Firewall access once so chat is not interrupted by a system prompt. On Mac, search uses the system network stack—no Firewall registration step.</p>
    <div className="settings-pref-row">
      <span className="settings-pref-copy"><span className="settings-pref-label">Search the web</span><span className="settings-pref-help">{state?.builtIn === false && state.endpoint ? 'Your search service' : 'Free search · Automatic'}</span></span>
      <Checkbox aria-label="Search the web" isSelected={enabled} isDisabled={busy || !state} onChange={() => void toggle()}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
    </div>
    <label className="settings-pref-row">
      <span className="settings-pref-copy"><span className="settings-pref-label">Search region</span><span className="settings-pref-help">Which country's results the free search favours. Worldwide avoids a country bias.</span></span>
      <SelectField className="settings-select" aria-label="Search region" value={region} disabled={busy || !state} onValueChange={(value) => void saveRegion(value)}>
        {WEB_SEARCH_REGIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </SelectField>
    </label>
    <div className="settings-pref-row"><span className="settings-pref-label">{statusLabel}</span>
      <Button variant="secondary" size="sm" isDisabled={busy || !state?.configured} onPress={() => void check()}>{busy ? 'Working…' : 'Test search'}</Button>
    </div>
    {state?.builtIn === false && <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void useBuiltIn()}>Use free search</Button>}
    <CollapsibleSection className="settings-block-nested" title="Advanced options">
      <p className="settings-pref-help">The included engine uses DDGS to choose search providers automatically. Change these only if you run your own search service or need different connection settings.</p>
      <label className="settings-pref-row"><span className="settings-pref-copy"><span className="settings-pref-label">Your search service</span></span><Input className="settings-input-wide" type="url" aria-label="Self-hosted search service address" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:8888/search"/></label>
      <label className="settings-pref-row"><span className="settings-pref-copy"><span className="settings-pref-label">Request timeout (ms)</span></span><Input type="number" min={1000} max={120000} step={1000} aria-label="Search request timeout" value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)}/></label>
      <label className="settings-pref-row"><span className="settings-pref-copy"><span className="settings-pref-label">Concurrent requests</span></span><Input type="number" min={1} max={8} step={1} aria-label="Search concurrent requests" value={maxConcurrentRequests} onChange={(event) => setMaxConcurrentRequests(event.target.value)}/></label>
      <div className="settings-pref-row"><span className="settings-pref-copy"><span className="settings-pref-label">Verify certificates</span></span><Checkbox aria-label="Verify certificates" isSelected={verifySsl} onChange={setVerifySsl}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></div>
      <div className="settings-pref-row"><span className="settings-pref-copy"><span className="settings-pref-label">Use proxy environment</span></span><Checkbox aria-label="Use proxy environment" isSelected={trustProxyEnvironment} onChange={setTrustProxyEnvironment}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox></div>
      <Button size="sm" isDisabled={busy} onPress={() => void save()}>Save settings</Button>
    </CollapsibleSection>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
