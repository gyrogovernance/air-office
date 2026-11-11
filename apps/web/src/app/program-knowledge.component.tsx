import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import type { ServiceClient } from '../shared/service-client.hook';

interface ScopeKnowledge {
  collectionId: string;
  sources: { id: string; name: string }[];
  status: { chunks?: number; current: unknown; rebuildRequired: boolean };
  syncing: boolean;
}
export function ProgramKnowledge({ scopeId, client, disabled = false }: { scopeId: string; client: ServiceClient; disabled?: boolean }) {
  const [value, setValue] = useState<ScopeKnowledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/v1/workspace/scopes/${encodeURIComponent(scopeId)}/knowledge`;
  useEffect(() => {
    let active = true;
    const refresh = () => { void client.json<ScopeKnowledge>(endpoint).then((result) => { if (active) { setValue(result); setError(''); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Source status is unavailable.'); }); };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [client, endpoint]);
  async function sync() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.json<{ imported: string[]; skipped: { name: string; reason: string }[] }>(endpoint, { method: 'POST' });
      setValue(await client.json<ScopeKnowledge>(endpoint));
      setNotice(`${result.imported.length} sources refreshed.${result.skipped.length ? ` ${result.skipped.length} files were not added to search.` : ''}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The sources could not be refreshed.'); }
    finally { setBusy(false); }
  }
  return <section className="programs-material" aria-label="Searchable sources"><header><div><h3>Searchable sources</h3><p className="programs-muted">Refresh notes and linked folders for use in this scope’s chats. Project chats also use the Program’s shared sources.</p></div><Button variant="secondary" size="sm" isDisabled={busy || disabled || !!value?.syncing} onPress={() => void sync()}>{busy ? 'Refreshing…' : 'Refresh sources'}</Button></header>{value && <p className="programs-muted">{value.sources.length} sources · {value.status.chunks ?? 0} indexed passages{value.status.rebuildRequired ? ' · Index needs rebuilding' : !value.status.current && value.sources.length ? ' · Waiting for indexing. Choose an embedding model in Settings → Knowledge if none is configured.' : ''}</p>}{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</section>;
}
