import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Link, Separator } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { BookOpen01Icon } from '@hugeicons/core-free-icons';
import { createServiceClient } from '../shared/service-client.hook';

type KnowledgeFeedListing = {
  id: string;
  name: string;
  description: string;
  homepage: string | null;
  source: 'bundled' | 'remote';
  url: string | null;
  lastError: string | null;
  entries: unknown[];
};

export function KnowledgeFeedsSettings() {
  const client = useMemo(() => createServiceClient(), []);
  const [feeds, setFeeds] = useState<KnowledgeFeedListing[]>([]);
  const [feedUrl, setFeedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    const result = await client.json<{ feeds: KnowledgeFeedListing[] }>('/api/v1/knowledge-feeds');
    setFeeds(result.feeds);
    setLoaded(true);
  }

  useEffect(() => {
    let active = true;
    void client.json<{ feeds: KnowledgeFeedListing[] }>('/api/v1/knowledge-feeds')
      .then((result) => { if (active) { setFeeds(result.feeds); setLoaded(true); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Knowledge catalogs could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);

  async function addFeed() {
    if (!feedUrl.trim()) return;
    setBusy(true); setError(''); setStatus('');
    try {
      await client.json('/api/v1/knowledge-feeds', { method: 'POST', body: JSON.stringify({ url: feedUrl.trim() }) });
      setFeedUrl('');
      await refresh();
      setStatus('Knowledge catalog added.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This catalog could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function removeFeed(feedId: string) {
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await client.request(`/api/v1/knowledge-feeds/${encodeURIComponent(feedId)}`, { method: 'DELETE' });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'This catalog could not be removed.';
        throw new Error(detail);
      }
      await refresh();
      setStatus('Knowledge catalog removed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This catalog could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshFeed(feedId: string) {
    setBusy(true); setError(''); setStatus('');
    try {
      await client.json(`/api/v1/knowledge-feeds/${encodeURIComponent(feedId)}/refresh`, { method: 'POST', body: '{}' });
      await refresh();
      setStatus('Knowledge catalog refreshed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This catalog could not be refreshed.');
    } finally {
      setBusy(false);
    }
  }

  return <Card variant="secondary" className="knowledge-feeds-settings rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Knowledge catalogs" aria-busy={loading || busy}>
    <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={BookOpen01Icon} size={18} aria-hidden="true" />Sources</Card.Title></Card.Header>
    <Separator />
    <p className="method-hint">HTTPS catalogs of documents available in Market. The Lab catalog is built in.</p>
    <form className="settings-pref-row knowledge-feed-add" onSubmit={(event) => { event.preventDefault(); void addFeed(); }}>
      <label className="settings-pref-copy">Catalog URL
        <Input type="url" required value={feedUrl} disabled={busy || loading} placeholder="https://example.com/knowledge.json" onChange={(event) => setFeedUrl(event.target.value)} aria-label="Knowledge catalog URL" />
      </label>
      <Button type="submit" variant="secondary" size="sm" isDisabled={busy || loading || !feedUrl.trim()}>Add catalog</Button>
    </form>
    {loading ? <p role="status">Loading knowledge catalogs...</p> : loaded && feeds.length === 0 ? <p className="method-hint">No knowledge catalogs yet.</p> : feeds.map((feed) => (
      <div className="settings-pref-row" key={feed.id}>
        <div className="settings-pref-copy">
          <span className="settings-pref-label">{feed.name}</span>
          <span className="settings-pref-help">{feed.source === 'bundled' ? 'Built-in Lab catalog' : feed.url} · {feed.entries.length} documents{feed.lastError ? ' · error' : ''}</span>
          {feed.lastError && <span role="alert">{feed.lastError}</span>}
        </div>
        <div className="team-actions">
          <Button variant="tertiary" size="sm" aria-label={`Refresh knowledge catalog ${feed.name}`} isDisabled={busy} onPress={() => void refreshFeed(feed.id)}>Refresh</Button>
          {feed.homepage && <Link href={feed.homepage} target="_blank" rel="noreferrer">Homepage</Link>}
          {feed.source === 'remote' && <Button variant="tertiary" size="sm" aria-label={`Remove knowledge catalog ${feed.name}`} isDisabled={busy} onPress={() => void removeFeed(feed.id)}>Remove</Button>}
        </div>
      </div>
    ))}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </Card>;
}
