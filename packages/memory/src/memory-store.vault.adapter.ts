import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseJsonlLines, rewriteJsonlFile } from '@office/vault/jsonl';
import { ensureVaultLayout, vaultPaths } from '@office/vault/service';
import { resolveVaultRoot } from '@office/vault/host';
import { isMemoryFact, type MemoryFact } from './memory.domain.public';
import type { MemoryStore } from './memory-store.port';

function enabledPath(root: string): string {
  return join(root, '.air', 'runtime', 'memory-enabled');
}

/** Facts durable as memory/facts.jsonl under the vault. */
export function createVaultMemoryStore(vaultRoot = resolveVaultRoot()): MemoryStore {
  const root = resolveVaultRoot(vaultRoot);
  const paths = ensureVaultLayout(root);
  const factsFile = paths.memoryFacts;
  mkdirSync(dirname(enabledPath(root)), { recursive: true });

  const readAll = (): MemoryFact[] => {
    if (!existsSync(factsFile)) return [];
    const bytes = readFileSync(factsFile, 'utf8');
    if (!bytes.trim()) return [];
    return parseJsonlLines(bytes, isMemoryFact);
  };

  const writeAll = (facts: MemoryFact[]): void => {
    rewriteJsonlFile(factsFile, facts);
  };

  return {
    list: (query, limit = 50) => {
      const needle = query?.trim().toLowerCase();
      let facts = readAll().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
      if (needle) facts = facts.filter((fact) => fact.content.toLowerCase().includes(needle));
      return facts.slice(0, Math.max(1, Math.min(limit, 50)));
    },
    get: (id) => readAll().find((fact) => fact.id === id) ?? null,
    save: (fact) => {
      if (!isMemoryFact(fact)) throw new Error('Invalid memory fact.');
      const facts = readAll().filter((item) => item.id !== fact.id);
      facts.push(fact);
      writeAll(facts);
    },
    remove: (id) => {
      const facts = readAll();
      const next = facts.filter((fact) => fact.id !== id);
      if (next.length === facts.length) return false;
      writeAll(next);
      return true;
    },
    clear: () => {
      const count = readAll().length;
      writeAll([]);
      return count;
    },
    enabled: () => {
      if (!existsSync(enabledPath(root))) return true;
      return readFileSync(enabledPath(root), 'utf8').trim() !== '0';
    },
    setEnabled: (value) => {
      writeFileSync(enabledPath(root), value ? '1\n' : '0\n', 'utf8');
    },
    close: () => undefined,
  };
}

export { vaultPaths };
