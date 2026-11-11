import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Store01Icon } from '@hugeicons/core-free-icons';
import { KnowledgeFeedsSettings } from '../knowledge/knowledge-feeds-settings.component';
import { createServiceClient } from '../shared/service-client.hook';
import { Card, Separator, Button, Checkbox, Input } from '@heroui/react';

type MarketSource = {
  id: string;
  kind: 'skill' | 'automation';
  name: string;
  url: string;
  format: 'github-skill-library-v1' | 'air-office-native-v1';
  enabled: boolean;
};

const supportedSources: readonly MarketSource[] = [
  { id: 'scientific-skills', kind: 'skill', name: 'Scientific skills', url: 'https://github.com/K-Dense-AI/scientific-agent-skills', format: 'github-skill-library-v1', enabled: true },
  { id: 'legal-skills', kind: 'skill', name: 'Legal and governance skills', url: 'https://github.com/lawve-ai/awesome-legal-skills', format: 'github-skill-library-v1', enabled: true },
  { id: 'native-automations', kind: 'automation', name: 'AIR Office templates', url: 'air-office:native-automations', format: 'air-office-native-v1', enabled: true },
];

/** Source configuration lives in Settings; catalog browsing belongs to Market. */
export function MarketSettings({ kind }: { kind?: MarketSource['kind'] }) {
  const client = useMemo(() => createServiceClient(), []);
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    void client.json<{ sources: MarketSource[] }>('/api/v1/market/sources')
      .then((result) => { if (active) { setSources(result.sources); setLoaded(true); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Market sources could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);

  async function saveSources(next: MarketSource[], message: string) {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await client.json<{ sources: MarketSource[] }>('/api/v1/market/sources', { method: 'PUT', body: JSON.stringify({ sources: next }) });
      setSources(result.sources);
      setStatus(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Market sources could not be saved.');
    } finally { setBusy(false); }
  }

  async function refreshCatalog(kind: MarketSource['kind']) {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await client.json<{ sources: (MarketSource & { state: string; error?: string })[] }>(`/api/v1/market/catalog?kind=${kind}`);
      const failures = result.sources.filter((source) => source.state === 'error');
      if (failures.length) throw new Error(failures.map((source) => source.error ?? `${source.name} could not be loaded.`).join(' '));
      setStatus(kind === 'skill' ? 'Skill catalog checked.' : 'Automation catalog checked.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The catalog could not be loaded.');
    } finally { setBusy(false); }
  }

  return <div className="settings-blocks" aria-label="Market source settings">
    {!kind && <KnowledgeFeedsSettings />}
    <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label={kind === 'skill' ? 'Skill sources' : kind === 'automation' ? 'Action sources' : 'Skill and automation sources'} aria-busy={loading || busy}>
      <Card.Header><Card.Title className="flex items-center gap-2" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={Store01Icon} size={18} aria-hidden="true" />{kind === 'skill' ? 'Skill sources' : kind === 'automation' ? 'Action sources' : 'Skill and automation sources'}</Card.Title></Card.Header><Separator />
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void saveSources(sources, 'Market sources saved.'); }}>
        {loading ? <p role="status">Loading Market sources...</p> : loaded && sources.filter((source) => !kind || source.kind === kind).length === 0 ? <p className="method-hint">No sources configured.</p> : sources.filter((source) => !kind || source.kind === kind).map((source) => <Card variant="tertiary" className="rounded-xl p-3 gap-2" key={source.id}>
          <div className="settings-pref-copy min-w-0">
            <label className="settings-pref-label">{source.kind === 'skill' ? 'Skill source name' : 'Automation source name'}
              <Input className="settings-source-name" aria-label={`Source name ${source.id}`} value={source.name} required maxLength={120} disabled={busy} onChange={(event) => setSources((current) => current.map((item) => item.id === source.id ? { ...item, name: event.target.value } : item))} />
            </label>
            <span className="settings-pref-help break-all">{source.url} · {source.format}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox aria-label={`Enable source ${source.id}`} isSelected={source.enabled} isDisabled={busy} onChange={(checked) => setSources((current) => current.map((item) => item.id === source.id ? { ...item, enabled: checked } : item))}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Enabled</Checkbox.Content></Checkbox>
            <Button variant="tertiary" size="sm" aria-label={`Refresh source ${source.id}`} isDisabled={busy} onPress={() => void refreshCatalog(source.kind)}>Refresh</Button>
            <Button variant="tertiary" size="sm" aria-label={`Remove source ${source.id}`} isDisabled={busy} onPress={() => void saveSources(sources.filter((item) => item.id !== source.id), 'Market source removed.')}>Remove</Button>
          </div>
        </Card>)}
        {loaded && <Button variant="secondary" size="sm" type="submit" isDisabled={busy || sources.some((source) => !source.name.trim())}>Save sources</Button>}
      </form>
      {loaded && supportedSources.filter((supported) => (!kind || supported.kind === kind) && !sources.some((source) => source.kind === supported.kind && source.url === supported.url)).map((supported) => <Card variant="tertiary" className="rounded-xl p-3" key={supported.id}>
        <div className="flex flex-wrap items-center gap-3">
        <div className="settings-pref-copy min-w-0 flex-1"><span className="settings-pref-label">{supported.name}</span><span className="settings-pref-help break-all">{supported.url} · {supported.format}</span></div>
        <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => {
          let id = supported.id;
          let suffix = 1;
          while (sources.some((source) => source.id === id)) id = `${supported.id}-${suffix++}`;
          void saveSources([...sources, { ...supported, id }], 'Market source added.');
        }}>Add {supported.name}</Button>
        </div>
      </Card>)}
      <p className="method-hint">Refresh checks the saved source configuration; recently loaded skills may use the service cache. Save changes before refreshing.</p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </Card>
  </div>;
}
