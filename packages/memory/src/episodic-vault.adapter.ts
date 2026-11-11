import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteText } from '@office/vault/atomic';
import { ensureVaultLayout, vaultPaths } from '@office/vault/service';
import { VAULT_PATHS } from '@office/vault/domain';
import { resolveUnderVault, resolveVaultRoot } from '@office/vault/host';
import {
  episodicRecordSchema,
  storedExchangeSchema,
  type EpisodicRecord,
  type EpisodicRecordView,
  type ExchangeReference,
  type StoredExchange,
} from './episodic-memory.policy';

export const reasoningFingerprint = (value: string): string => createHash('sha256').update(value).digest('hex');

const GENERATION_PATH = '.air/runtime/memory-generation';

function episodePath(root: string, recordId: string): string {
  return resolveUnderVault(root, `${VAULT_PATHS.memoryEpisodes}/${recordId}.json`);
}

function readEpisode(root: string, recordId: string): StoredExchange | null {
  const path = episodePath(root, recordId);
  if (!existsSync(path)) return null;
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return storedExchangeSchema.parse(raw);
}

function writeEpisode(root: string, record: StoredExchange): void {
  // Deleted records stay as tombstones so schedule/has can suppress recapture of the same exchange id.
  atomicWriteText(episodePath(root, record.record_id), `${JSON.stringify(record, null, 2)}\n`);
}

function listReady(root: string, conversationId?: string): EpisodicRecord[] {
  const paths = vaultPaths(root);
  if (!existsSync(paths.memoryEpisodes)) return [];
  const records: EpisodicRecord[] = [];
  for (const name of readdirSync(paths.memoryEpisodes).filter((file) => file.endsWith('.json'))) {
    const record = storedExchangeSchema.parse(JSON.parse(readFileSync(join(paths.memoryEpisodes, name), 'utf8')));
    if (record.state !== 'ready') continue;
    if (conversationId && record.conversation_id !== conversationId) continue;
    records.push(record);
  }
  return records.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.record_id.localeCompare(right.record_id));
}

/** Vault-backed episodic records: one JSON object per `memory/episodes/<id>.json`. */
export function createVaultEpisodicStore(root = resolveVaultRoot()) {
  ensureVaultLayout(root);
  mkdirSync(vaultPaths(root).memoryEpisodes, { recursive: true });

  const list = (conversationId?: string): EpisodicRecord[] => listReady(root, conversationId);

  return {
    list,
    save: (record: StoredExchange, _previousId?: string | null) => {
      const parsed = storedExchangeSchema.parse(record);
      writeEpisode(root, parsed);
    },
    catalog: (conversationId?: string): ExchangeReference[] => listReady(root, conversationId).map((record, index, all) => ({
      record_id: record.record_id,
      conversation_id: record.conversation_id,
      branch_id: record.branch_id,
      created_at: record.created_at,
      indexed: record.indexed,
      previous_record_id: index > 0 ? all[index - 1]!.record_id : null,
      snapshot_ids: record.sources.map((source) => reasoningFingerprint(JSON.stringify([record.conversation_id, source.message_id, source.role, record.messages[record.sources.indexOf(source)]?.content ?? '']))),
      message_ids: record.sources.map((source) => source.message_id),
    })),
    has: (id: string) => existsSync(episodePath(root, id)),
    updateIndex: (id: string, indexed: boolean, error: string | null) => {
      const current = readEpisode(root, id);
      if (!current || current.state !== 'ready') return false;
      writeEpisode(root, { ...current, indexed, error });
      return true;
    },
    generation: () => {
      const path = resolveUnderVault(root, GENERATION_PATH);
      if (!existsSync(path)) return undefined;
      return readFileSync(path, 'utf8').trim() || undefined;
    },
    setGeneration: (value: string) => {
      atomicWriteText(resolveUnderVault(root, GENERATION_PATH), `${value}\n`);
    },
    get: (id: string): StoredExchange | null => readEpisode(root, id),
    preview: (id: string): EpisodicRecordView | null => {
      const record = readEpisode(root, id);
      if (!record || record.state !== 'ready') return null;
      return {
        ...record,
        messages: record.messages.map((message) => ({
          role: message.role,
          content: message.content.slice(0, 2000),
          truncated: message.content.length > 2000,
        })),
      };
    },
    pending: (): EpisodicRecord[] => listReady(root).filter((record) => !record.indexed).slice(0, 16),
    resetIndexes: () => {
      for (const record of listReady(root)) writeEpisode(root, { ...record, indexed: false });
    },
    clear: () => {
      const paths = vaultPaths(root);
      if (!existsSync(paths.memoryEpisodes)) return;
      for (const name of readdirSync(paths.memoryEpisodes).filter((file) => file.endsWith('.json'))) {
        unlinkSync(join(paths.memoryEpisodes, name));
      }
    },
    close: () => undefined,
  };
}

export type VaultEpisodicStore = ReturnType<typeof createVaultEpisodicStore>;
