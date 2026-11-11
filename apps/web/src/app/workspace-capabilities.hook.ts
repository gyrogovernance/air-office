import { useEffect, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';

const CAPABILITIES_CHANGED = 'air-office:capabilities-changed';
export function notifyCapabilitiesChanged() { window.dispatchEvent(new Event(CAPABILITIES_CHANGED)); }

export interface WorkspaceCapabilities {
  webSearch: { configured: boolean; provider: string | null; endpoint?: string | null };
  codeInterpreter: { languages: string[] };
  memory: { enabled: boolean };
  providers: { id: string; imageGeneration: boolean }[];
}

/**
 * The capabilities the service actually has. A tool can be switched on and
 * still have nothing behind it, so the workspace reports what is configured
 * and the user is told the truth about it.
 */
export function useWorkspaceCapabilities(client: ServiceClient): WorkspaceCapabilities | null {
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let revision = 0;
    const refresh = () => {
      const requestRevision = ++revision;
      void client.json<WorkspaceCapabilities>('/api/v1/capabilities', { signal: controller.signal })
        .then((value) => { if (alive && requestRevision === revision) setCapabilities(value); })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener(CAPABILITIES_CHANGED, refresh);
    return () => { alive = false; controller.abort(); window.removeEventListener(CAPABILITIES_CHANGED, refresh); };
  }, [client]);
  return capabilities;
}
