import { useCallback, useState } from 'react';
import type { ServiceClient } from '../shared/service-client.hook';

export type NoteDriftState =
  | { kind: 'ok' }
  | { kind: 'markdown-drift'; expectedHash: string; actualHash: string }
  | { kind: 'missing-markdown' }
  | { kind: 'missing-json' }
  | { kind: 'invalid-json'; message: string };

/**
 * Minimal Apply / Discard helpers for markdown projection drift.
 * Does not own editor chrome; callers decide when to surface controls.
 */
export function useNoteProjectionDrift(client: Pick<ServiceClient, 'json'>, noteId: string | null) {
  const [drift, setDrift] = useState<NoteDriftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!noteId) {
      setDrift(null);
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await client.json<{ drift: NoteDriftState }>(`/api/v1/rich-documents/${encodeURIComponent(noteId)}/drift`);
      setDrift(response.drift);
      return response.drift;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Drift status is unavailable.';
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [client, noteId]);

  const apply = useCallback(async (markdown?: string) => {
    if (!noteId) return null;
    setBusy(true);
    setError(null);
    try {
      const response = await client.json<{ document: unknown; warnings: string[] }>(
        `/api/v1/rich-documents/${encodeURIComponent(noteId)}/apply-markdown`,
        { method: 'POST', body: JSON.stringify(markdown === undefined ? {} : { markdown }) },
      );
      await refresh();
      return response;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Markdown could not be applied.';
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [client, noteId, refresh]);

  const discard = useCallback(async () => {
    if (!noteId) return null;
    setBusy(true);
    setError(null);
    try {
      const response = await client.json<{ document: unknown }>(
        `/api/v1/rich-documents/${encodeURIComponent(noteId)}/discard-markdown`,
        { method: 'POST', body: '{}' },
      );
      await refresh();
      return response.document;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Markdown could not be discarded.';
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [client, noteId, refresh]);

  return { drift, busy, error, refresh, apply, discard };
}
