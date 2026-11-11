import { useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { createServiceClient } from '../shared/service-client.hook';

export function CacheManagement() {
  const client = useMemo(() => createServiceClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function clear() {
    if (!window.confirm('Clear temporary extraction and indexing files? Your documents, models, and workspace will remain unchanged.')) return;
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await client.json<{ cleared: number }>('/api/v1/data/cache', { method: 'DELETE', body: JSON.stringify({ confirmed: true }) });
      setMessage(`${result.cleared} temporary folder${result.cleared === 1 ? '' : 's'} cleared.`);
    } catch { setError('Temporary files could not be cleared. Try again after current indexing or extraction work finishes.'); }
    finally { setBusy(false); }
  }
  return <div className="settings-pref-row">
    <div className="settings-pref-copy">{message && <span role="status">{message}</span>}{error && <span role="alert">{error}</span>}</div>
    <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => void clear()}>{busy ? 'Clearing...' : 'Clear cache'}</Button>
  </div>;
}
