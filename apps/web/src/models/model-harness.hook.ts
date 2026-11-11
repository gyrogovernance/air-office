import { useCallback, useEffect, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';

export type ModelHarnessPreference = {
  providerId: string;
  modelId: string;
  fullHarness: boolean;
};

const changedEvent = 'office-model-harness-changed';

/**
 * Per-local-model Full harness preference. Default off = lean local path.
 * Cloud models ignore this flag and always use Copilot.
 */
export function useModelHarness(client: ServiceClient) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const keyFor = (providerId: string, modelId: string) => `${providerId}:${modelId}`;

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const result = await client.json<{ models: ModelHarnessPreference[] }>('/api/v1/model-harness', { signal });
      const next: Record<string, boolean> = {};
      for (const item of result.models) next[keyFor(item.providerId, item.modelId)] = item.fullHarness;
      setEnabled(next);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Harness preferences could not be loaded.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const onChanged = () => { void refresh(); };
    window.addEventListener(changedEvent, onChanged);
    return () => {
      controller.abort();
      window.removeEventListener(changedEvent, onChanged);
    };
  }, [refresh]);

  function isFullHarness(providerId: string, modelId: string): boolean {
    return enabled[keyFor(providerId, modelId)] === true;
  }

  async function setFullHarness(providerId: string, modelId: string, fullHarness: boolean) {
    setError('');
    const preference = await client.json<{ preference: ModelHarnessPreference }>('/api/v1/model-harness', {
      method: 'PUT',
      body: JSON.stringify({ providerId, modelId, fullHarness })
    });
    setEnabled((current) => {
      const next = { ...current };
      const key = keyFor(preference.preference.providerId, preference.preference.modelId);
      if (preference.preference.fullHarness) next[key] = true;
      else delete next[key];
      return next;
    });
    window.dispatchEvent(new Event(changedEvent));
    return preference.preference;
  }

  return { loading, error, isFullHarness, setFullHarness, refresh };
}
