export { createMarketCatalogService, createSqliteMarketSourceStore, defaultMarketSources, parseMarketSources, parseStandaloneSkill, MarketCatalogError } from './market-catalog.service';
export type { MarketCatalogService, MarketFetch, MarketKind, MarketSource, MarketSourceStore, MarketSkillEntry, MarketSourceStatus } from './market-catalog.service';
export { createSqliteCraftStore } from './craft-store.adapter';
export { createCraftService } from './craft-composition.service';
export { createVaultMethodsStore } from './methods-vault.adapter';

import type { MethodDefinition, MethodVersion, MethodsBundle } from './methods.domain.public';

export type MethodsImportConflict = { id: string; existingKind: MethodDefinition['kind']; incomingKind: MethodDefinition['kind'] };
export type MethodsImportResult = { imported: MethodDefinition[]; conflicts: MethodsImportConflict[] };

export interface MethodsStore {
  list(): MethodDefinition[];
  get(id: string): MethodDefinition | null;
  save(definition: MethodDefinition): MethodDefinition;
  history(id: string): MethodVersion[];
  restore(versionId: string, expectedDefinitionId?: string): MethodDefinition | null;
  exportBundle(): MethodsBundle;
  clearAll(): number;
  remove(id: string): void;
  importBundle(bundle: unknown): MethodsImportResult;
  close(): void;
}
