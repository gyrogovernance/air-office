import { parseModelConnection, type ModelConnection } from './providers.domain.public';
import { listConnectionModels, outcomeForResult } from './model-discovery.adapter';
import type { CredentialStore, ProviderCredentials } from './provider-credentials.port';

export interface ModelConnectionSettingsOptions {
  store: { list(): ModelConnection[]; put(value: ModelConnection): unknown; remove(id: string): unknown; clearPersonalData(): void };
  credentials: ProviderCredentials;
  credentialStore: CredentialStore;
  reload(): void;
}

export class ModelConnectionSettingsError extends Error {
  constructor(readonly code: 'invalid' | 'missing' | 'conflict' | 'credential-write' | 'credential-delete' | 'discovery', message: string, readonly connection?: ModelConnection, readonly saved = false) { super(message); }
}

/** Settings mutations and observation publication share one owner. Key slots are immutable so a replacement cannot rebind an in-flight endpoint to another destination's credential. */
export function createModelConnectionSettings(options: ModelConnectionSettingsOptions) {
  const pending = new Map<string, Promise<unknown>>();
  const attempts = new Map<string, symbol>();
  const find = (id: string) => options.store.list().find((item) => item.id === id);
  const requireConnection = (id: string) => { const connection = find(id); if (!connection) throw new ModelConnectionSettingsError('missing', 'Unknown model connection.'); return connection; };
  const publish = (connection: ModelConnection) => { options.store.put(connection); options.reload(); };
  const serial = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const previous = pending.get(id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(work);
    pending.set(id, operation);
    try { return await operation; } finally { if (pending.get(id) === operation) pending.delete(id); }
  };
  const reference = (connection: ModelConnection) => connection.credentialId === undefined ? connection.id : connection.credentialId;
  const credential = (connection: ModelConnection) => { const id = reference(connection); return id === null ? Promise.resolve(null) : options.credentials.resolve(id); };
  const configured = async (connection: ModelConnection) => { const id = reference(connection); return id !== null && await options.credentialStore.configured(id); };
  const save = async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ModelConnectionSettingsError('invalid', 'A connection is required.');
    const record = input as Record<string, unknown>;
    let parsed: ModelConnection;
    try { parsed = parseModelConnection(record.connection ?? input); } catch { throw new ModelConnectionSettingsError('invalid', 'Enter valid connection settings and model IDs.'); }
    const hasSecret = Object.hasOwn(record, 'secret');
    if (hasSecret && (typeof record.secret !== 'string' || record.secret.length < 1 || record.secret.length > 10_000)) throw new ModelConnectionSettingsError('invalid', 'Enter an API key between 1 and 10000 characters, or leave it unchanged.');
    return serial(parsed.id, async () => {
      const existing = find(parsed.id);
      const targetChanged = existing !== undefined && (existing.baseUrl !== parsed.baseUrl || existing.kind !== parsed.kind);
      const listingChanged = targetChanged || existing !== undefined && ['deployment', 'apiVersion', 'region', 'headers'].some((field) => JSON.stringify(existing[field as keyof ModelConnection]) !== JSON.stringify(parsed[field as keyof ModelConnection]));
      const oldReference = existing ? reference(existing) : null;
      const retired = new Set(existing?.retiredCredentialIds ?? []);
      if (retired.size >= 126) throw new ModelConnectionSettingsError('conflict', 'Remove saved keys to clean up inactive credentials before replacing another key.');
      // Observation and credential references are service facts, never caller-supplied settings.
      const { credentialId: ignoredId, retiredCredentialIds: ignoredRetired, revision: ignoredRevision, ...intent } = parsed;
      void ignoredId; void ignoredRetired; void ignoredRevision;
      const next: ModelConnection = {
        ...intent,
        observedModels: !listingChanged && existing ? existing.observedModels : [],
        observedAt: !listingChanged && existing ? existing.observedAt : null,
        discovery: !listingChanged && existing ? existing.discovery : 'unknown',
        discoveryError: !listingChanged && existing ? existing.discoveryError : null,
        credentialId: targetChanged ? null : oldReference,
        retiredCredentialIds: [...retired], revision: crypto.randomUUID()
      };
      if (targetChanged && oldReference) retired.add(oldReference);
      if (hasSecret) {
        const slot = `model-key-${crypto.randomUUID()}`;
        // Persist ownership before touching the OS store. A crash or failed commit leaves
        // the staged slot discoverable for cleanup, while the previous binding stays active.
        const stage: ModelConnection = { ...(existing ?? next), retiredCredentialIds: [...new Set([...(existing?.retiredCredentialIds ?? []), slot])], revision: crypto.randomUUID() };
        publish(stage);
        try { await options.credentialStore.store(slot, record.secret as string); }
        catch { throw new ModelConnectionSettingsError('credential-write', 'The replacement key could not be stored. Existing connection settings and credentials were preserved; a new connection remains without an active key.', stage, existing === undefined); }
        if (oldReference) retired.add(oldReference);
        next.credentialId = slot;
        next.observedModels = []; next.observedAt = null; next.discovery = 'unknown'; next.discoveryError = null;
      }
      next.retiredCredentialIds = [...retired];
      publish(next);
      return { connection: next, saved: true, credentialSaved: hasSecret ? true : null };
    });
  };
  const forget = (id: string) => serial(id, async () => {
    const connection = requireConnection(id);
    const active = reference(connection);
    const references = [...new Set([...(active ? [active] : []), ...(connection.retiredCredentialIds ?? [])])];
    const failed: string[] = [];
    let activeRemoved = active === null;
    let anyRemoved = false;
    for (const slot of references) {
      const result = await options.credentialStore.forget(slot).catch(() => 'failed' as const);
      if (result === 'failed') failed.push(slot);
      else { if (slot === active) activeRemoved = true; if (result === 'removed') anyRemoved = true; }
    }
    const updated: ModelConnection = {
      ...connection, credentialId: activeRemoved ? null : active,
      retiredCredentialIds: failed.filter((slot) => slot !== active), revision: crypto.randomUUID(),
      ...(activeRemoved && active !== null ? { observedModels: [], observedAt: null, discovery: 'unknown' as const, discoveryError: null } : {})
    };
    publish(updated);
    if (failed.length) throw new ModelConnectionSettingsError('credential-delete', 'Some saved keys could not be removed. The connection and remaining cleanup references were kept; retry key removal.', updated);
    return { connection: updated, credentialRemoval: anyRemoved ? 'removed' as const : 'absent' as const, credentialConfigured: await configured(updated) };
  });
  const remove = async (id: string) => {
    const forgotten = await forget(id);
    return serial(id, async () => {
      const connection = requireConnection(id);
      if (connection.revision !== forgotten.connection.revision || reference(connection) !== null || connection.retiredCredentialIds?.length) throw new ModelConnectionSettingsError('conflict', 'The connection changed during deletion. Retry deletion.');
      options.store.remove(id); options.reload();
      return { removed: id };
    });
  };
  const discover = async (id: string, signal?: AbortSignal) => {
    const connection = requireConnection(id);
    const stamp = JSON.stringify(connection);
    const attempt = Symbol(id); attempts.set(id, attempt);
    const listed = await listConnectionModels({ ...connection, credential: () => credential(connection), ...(signal ? { signal } : {}) });
    try {
      return await serial(id, async () => {
        const current = find(id);
        if (!current || JSON.stringify(current) !== stamp || attempts.get(id) !== attempt) throw new ModelConnectionSettingsError('conflict', 'Connection settings changed during discovery. Refresh and retry.');
        const updated: ModelConnection = listed.ok
          ? { ...current, observedModels: listed.models, observedAt: new Date().toISOString(), discovery: outcomeForResult(listed), discoveryError: null }
          : { ...current, discovery: 'failed', discoveryError: listed.message };
        publish(updated);
        if (!listed.ok) throw new ModelConnectionSettingsError('discovery', listed.message, updated);
        return { connection: updated, discovered: listed.models.length, empty: listed.empty };
      });
    } finally { if (attempts.get(id) === attempt) attempts.delete(id); }
  };
  const check = async (id: string, signal?: AbortSignal) => {
    const connection = requireConnection(id);
    const result = await listConnectionModels({ ...connection, credential: () => credential(connection), ...(signal ? { signal } : {}) });
    if (JSON.stringify(find(id)) !== JSON.stringify(connection)) throw new ModelConnectionSettingsError('conflict', 'Connection settings changed during the check. Retry.');
    return result.ok
      ? { state: 'reachable' as const, message: 'Connection successful.' }
      : { state: result.reason === 'auth' ? 'auth-required' as const : result.reason === 'not-found' ? 'unsupported' as const : result.reason === 'network' || result.reason === 'timeout' ? 'unreachable' as const : 'failed' as const, message: result.message };
  };
  const forgetAll = async () => options.credentialStore.forgetAll();
  return { get: requireConnection, list: options.store.list, credential, configured, save, forget, forgetAll, remove, discover, check, clearPersonalData: () => { options.store.clearPersonalData(); options.reload(); } };
}

export type ModelConnectionSettings = ReturnType<typeof createModelConnectionSettings>;
