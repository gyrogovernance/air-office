import {
  ensureVaultSettingsFiles,
  readModelHarnessSettingsFile,
  writeModelHarnessSettingsFile,
} from '../../vault/src/vault-settings.authority.public';

export type ModelHarnessPreference = {
  providerId: string;
  modelId: string;
  fullHarness: boolean;
};

export interface ModelHarnessStore {
  /** Full harness is off by default for every local model. */
  fullHarnessEnabled(providerId: string, modelId: string): boolean;
  setFullHarness(providerId: string, modelId: string, enabled: boolean): ModelHarnessPreference;
  list(): ModelHarnessPreference[];
  close(): void;
}

/**
 * Per-model Full harness preference in `.air/settings/model-harness.yaml`.
 * Only explicitly enabled models are listed; absence means lean default.
 */
export function createModelHarnessStore(vaultRoot: string): ModelHarnessStore {
  ensureVaultSettingsFiles(vaultRoot);
  const readEnabled = (providerId: string, modelId: string): boolean => {
    const settings = readModelHarnessSettingsFile(vaultRoot);
    return settings.fullHarness.some((item) => item.providerId === providerId && item.modelId === modelId && item.enabled);
  };
  return {
    fullHarnessEnabled: readEnabled,
    setFullHarness(providerId, modelId, enabled) {
      const provider = providerId.trim();
      const model = modelId.trim();
      if (!provider || !model) throw new Error('Choose a provider and model.');
      const current = readModelHarnessSettingsFile(vaultRoot);
      const fullHarness = current.fullHarness.filter((item) => !(item.providerId === provider && item.modelId === model));
      if (enabled) fullHarness.push({ providerId: provider, modelId: model, enabled: true });
      fullHarness.sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
      writeModelHarnessSettingsFile({ schema: 'air.model-harness/1', fullHarness }, vaultRoot);
      return { providerId: provider, modelId: model, fullHarness: enabled };
    },
    list() {
      return readModelHarnessSettingsFile(vaultRoot).fullHarness
        .filter((item) => item.enabled)
        .map((item) => ({ providerId: item.providerId, modelId: item.modelId, fullHarness: true }));
    },
    close() { /* vault file store */ },
  };
}
