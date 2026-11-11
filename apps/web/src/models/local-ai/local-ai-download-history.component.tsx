import { useEffect, useState } from 'react';
import { Button, Card } from '@heroui/react';
import type { ServiceClient } from '../../shared/service-client.hook';

type Activity = { id: string; instanceId: string; generation: number; jobId: string; kind: string; state: string; percent: number | null; running: boolean | null; observedAt: string; lastAction: string | null };

export function LocalAiDownloadHistory({ client }: { client: ServiceClient }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await client.json<{ activities: Activity[] }>('/api/v1/local-ai/download-history', { signal: controller.signal });
        if (!controller.signal.aborted) { setActivities(result.activities); setError(''); }
      } catch { if (!controller.signal.aborted) setError('Local AI download history could not be loaded.'); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [client, revision]);
  return <section className="model-setup-panel" aria-label="Local AI download history">
    <h3>History</h3>
    <Button variant="secondary" size="sm" onPress={() => { setLoading(true); setRevision((value) => value + 1); }}>Refresh</Button>
    {loading && <p role="status">Loading…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && activities.length === 0 && <p>No downloads recorded.</p>}
    <ul className="model-job-list" aria-label="Recorded Local AI downloads">{activities.map((item) => <Card key={item.id} render={(props) => {
        const { ref, ...rest } = props;
        return <li {...(rest as React.LiHTMLAttributes<HTMLLIElement>)} />;
      }}>
      <strong>{item.kind === 'backend' ? 'Backend' : 'Model'} · {item.state}</strong>
      <span>{item.jobId}</span>
      <span>generation {item.generation}</span>
      {item.percent !== null && <span>{Math.round(item.percent)}%</span>}
      {item.lastAction && <span>Last requested action: {item.lastAction}</span>}
      <small>{new Date(item.observedAt).toLocaleString()}</small>
    </Card>)}</ul>
  </section>;
}
