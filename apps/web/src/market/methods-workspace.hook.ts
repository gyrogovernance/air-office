import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MethodDefinition, MethodVersion, MethodsBundle } from '@office/methods/domain';
import { createServiceClient } from '../shared/service-client.hook';

export interface MethodsWorkspaceState {
  definitions: MethodDefinition[];
  history: MethodVersion[];
  status: string;
  error: string;
  refresh: () => Promise<void>;
  save: (definition: MethodDefinition) => Promise<MethodDefinition | null>;
  loadHistory: (definitionId: string) => Promise<void>;
  restore: (versionId: string) => Promise<void>;
  exportBundle: () => Promise<string | null>;
  importBundle: (raw: string) => Promise<boolean>;
}

/**
 * Methods workspace hook. It reads reusable presets, prompts, and skills from
 * the local service, keeps their version history, and moves portable definition
 * bundles in and out. Applying a definition to a conversation happens in the
 * workspace shell, which composes the effective instructions from the current
 * selection; this hook only owns persistence and transfer.
 */
export function useMethodsWorkspace(): MethodsWorkspaceState {
  const client = useMemo(() => createServiceClient(), []);
  const [definitions, setDefinitions] = useState<MethodDefinition[]>([]);
  const [history, setHistory] = useState<MethodVersion[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const loaded = await client.json<{ definitions: MethodDefinition[] }>('/api/v1/methods');
      setDefinitions(loaded.definitions);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reusable definitions could not be loaded.');
    }
  }, [client]);

  useEffect(() => {
    // createServiceClient waits for service readiness; agents appear once methods load.
    void refresh();
  }, [refresh]);

  const save = useCallback(async (definition: MethodDefinition) => {
    try {
      setError('');
      const stored = await client.json<{ definition: MethodDefinition }>('/api/v1/methods', { method: 'POST', body: JSON.stringify(definition) });
      setStatus(`Saved ${stored.definition.value.name}.`);
      await refresh();
      return stored.definition;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The definition could not be saved.');
      return null;
    }
  }, [client, refresh]);

  const loadHistory = useCallback(async (definitionId: string) => {
    setHistory([]);
    try {
      const loaded = await client.json<{ history: MethodVersion[] }>(`/api/v1/methods/${encodeURIComponent(definitionId)}/history`);
      setHistory(loaded.history);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Version history could not be loaded.');
    }
  }, [client]);

  const restore = useCallback(async (versionId: string) => {
    const definitionId = history.find((version) => version.id === versionId)?.definitionId;
    if (!definitionId) return;
    try {
      await client.json(`/api/v1/methods/${encodeURIComponent(definitionId)}`, { method: 'PATCH', body: JSON.stringify({ versionId }) });
      setStatus('Restored an earlier definition version.');
      await loadHistory(definitionId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The version could not be restored.');
    }
  }, [client, history, loadHistory, refresh]);

  const exportBundle = useCallback(async () => {
    try {
      const loaded = await client.json<{ bundle: MethodsBundle }>('/api/v1/methods/export');
      return JSON.stringify(loaded.bundle, null, 2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The bundle could not be exported.');
      return null;
    }
  }, [client]);

  const importBundle = useCallback(async (raw: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { setError('That file is not valid JSON.'); return false; }
    try {
      const result = await client.json<{ imported: number; conflicts: { id: string }[] }>('/api/v1/methods/import', { method: 'POST', body: JSON.stringify(parsed) });
      setStatus(`Imported ${result.imported} definition(s). ${result.conflicts.length} existing definition(s) preserved because their identities matched.`);
      await refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The bundle does not match the supported format and version.');
      return false;
    }
  }, [client, refresh]);

  return { definitions, history, status, error, refresh, save, loadHistory, restore, exportBundle, importBundle };
}
