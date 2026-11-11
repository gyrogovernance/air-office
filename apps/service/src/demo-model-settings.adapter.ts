import type { ModelConnectionSettings } from '@office/providers/service';

/** Explicit demo identities keep normal connections on their real adapters. */
export function demoModelSettings(settings: ModelConnectionSettings): ModelConnectionSettings {
  return {
    ...settings,
    check: async (id, signal) => {
      if (!id.startsWith('demo-')) return settings.check(id, signal);
      settings.get(id);
      return { state: 'reachable', message: 'Demo connection ready.' };
    },
    discover: async (id, signal) => {
      if (!id.startsWith('demo-')) return settings.discover(id, signal);
      const connection = settings.get(id);
      return { connection, discovered: connection.models.length, empty: connection.models.length === 0 };
    },
  };
}
