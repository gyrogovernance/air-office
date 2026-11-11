export const protocolVersion = 1;
export { createLocalInferenceControl } from './local-inference.service';
export { storageLocationStatus, requestStorageLocation, prepareStorageLocation } from './storage-location.adapter';
export type { StorageLayout, StorageLocationStatus } from './storage-location.adapter';
export { runMigrations } from './migration.adapter';
export type { MigrationStep, MigrationResult, CoordinatorOptions } from './migration.adapter';
