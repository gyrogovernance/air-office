import { useCallback, useEffect, useState } from 'react';
import type { ToolConnection, ToolDefinition } from '@office/contracts/tool';
import type { ServiceClient } from '../shared/service-client.hook';

const TOOLS_CHANGED = 'air-office:tools-changed';
export function notifyToolsChanged() { window.dispatchEvent(new Event(TOOLS_CHANGED)); }

export function useToolConnections(client: ServiceClient) {
  const [connections, setConnections] = useState<ToolConnection[]>([]);
  const [definitions, setDefinitions] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const result = await client.json<{ connections: ToolConnection[]; definitions: ToolDefinition[] }>('/api/v1/tools');
      setConnections(result.connections); setDefinitions(result.definitions); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Tools could not be loaded.'); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => {
    const changed = () => { void refresh(); };
    changed(); window.addEventListener(TOOLS_CHANGED, changed);
    return () => window.removeEventListener(TOOLS_CHANGED, changed);
  }, [refresh]);
  return { connections, definitions, loading, error, refresh };
}
