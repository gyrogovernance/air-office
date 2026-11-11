import { useEffect, useState } from 'react';
import type { ServiceClient } from '../../shared/service-client.hook';

export type InstalledLocalModel = { id: string; labels: string[] };

/**
 * The models the local runtime holds, with the labels that say what each can
 * do. The list is read once and refreshed when the workspace announces that
 * the models changed, so a chat action knows which local model can speak.
 */
export function useInstalledLocalModels(client: ServiceClient): InstalledLocalModel[] {
  const [models, setModels] = useState<InstalledLocalModel[]>([]);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const load = () => {
      void client.json<{ result: unknown }>('/api/v1/local-ai/operations', { method: 'POST', body: JSON.stringify({ operation: 'installed-models' }), signal: controller.signal })
        .then(({ result }) => {
          if (!alive) return;
          const rows = Array.isArray(result) ? result : result && typeof result === 'object' && 'data' in result && Array.isArray((result as { data: unknown[] }).data) ? (result as { data: unknown[] }).data : [];
          setModels(rows.flatMap((row): InstalledLocalModel[] => {
            if (!row || typeof row !== 'object') return [];
            const item = row as { id?: unknown; name?: unknown; model_name?: unknown; labels?: unknown };
            const id = item.id ?? item.name ?? item.model_name;
            if (typeof id !== 'string' || !id) return [];
            const labels = Array.isArray(item.labels) ? item.labels.filter((label): label is string => typeof label === 'string') : [];
            return [{ id, labels }];
          }));
        })
        .catch(() => undefined);
    };
    load();
    const changed = () => load();
    window.addEventListener('office-models-changed', changed);
    window.addEventListener('air-office-bootstrap', changed);
    return () => { alive = false; controller.abort(); window.removeEventListener('office-models-changed', changed); window.removeEventListener('air-office-bootstrap', changed); };
  }, [client]);
  return models;
}
