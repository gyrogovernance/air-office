import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModelHarnessStore } from '../../../packages/providers/src/model-harness.adapter';
import { ensureVaultLayout } from '../../../packages/vault/src/vault.service.public';

describe('model harness store', () => {
  test('defaults off and persists Full harness per model in vault yaml', () => {
    const root = mkdtempSync(join(tmpdir(), 'air-model-harness-'));
    process.env.AIR_VAULT_ROOT = root;
    ensureVaultLayout(root);
    const store = createModelHarnessStore(root);
    try {
      expect(store.fullHarnessEnabled('managed-local', 'Bonsai')).toBe(false);
      expect(store.setFullHarness('managed-local', 'Bonsai', true)).toEqual({
        providerId: 'managed-local',
        modelId: 'Bonsai',
        fullHarness: true
      });
      expect(store.fullHarnessEnabled('managed-local', 'Bonsai')).toBe(true);
      expect(store.list()).toEqual([{ providerId: 'managed-local', modelId: 'Bonsai', fullHarness: true }]);
      store.setFullHarness('managed-local', 'Bonsai', false);
      expect(store.fullHarnessEnabled('managed-local', 'Bonsai')).toBe(false);
      expect(store.list()).toEqual([]);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
