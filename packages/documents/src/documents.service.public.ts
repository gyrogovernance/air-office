import { createHash } from 'node:crypto';
import type { ExtractionArtifact, SourceDocument, SourceVersion } from '@office/contracts/document';
import { resolveVaultRoot } from '@office/vault/host';
import type { DocumentStore } from './document-store.port';
import type { ExtractionWorker } from './extraction-worker.port';
import { newSourceDocument } from './documents.domain.public';
export { pageAnchorsForArtifact, resolveAnchor, sourceKindForName, hasBlockingWarning } from './documents.domain.public';
import { createSqliteDocumentStore } from './document-store.adapter';
import { extensionFromName, readSourceOriginal, storeSourceOriginal } from './sources-vault.adapter';

export { createSqliteDocumentStore };
export { storeSourceOriginal, readSourceOriginal, runtimeKnowledgePath } from './sources-vault.adapter';
export type { DocumentStore } from './document-store.port';
export { PythonExtractionWorker, requiresOcrResource } from './python-worker.adapter';
export type { PythonWorkerOptions } from './python-worker.adapter';
export type { ExtractionRequest, ExtractionResult, ExtractionWorker } from './extraction-worker.port';
export { resolveDocumentWorkerPython, ensureDocumentWorkerPython } from './document-worker-python.adapter';

/** Vault root when configured; null when AIR_VAULT_ROOT is unset (pre-cutover or tests without a vault). */
function configuredVaultRoot(): string | null {
  try {
    return resolveVaultRoot();
  } catch {
    return null;
  }
}

export interface IngestResult {
  document: SourceDocument;
  version: SourceVersion;
  created: boolean;
}

export interface DocumentsService {
  ingest(input: { documentId: string; name: string; collectionId: string | null; bytes: Uint8Array }): IngestResult;
  documents(collectionId: string | null): SourceDocument[];
  deleteDocument(documentId: string): void;
  clearPersonalData(): number;
  versions(documentId: string): SourceVersion[];
  /** Looks up one source version by its identifier, or null when unknown. */
  version(versionId: string): SourceVersion | null;
  sourceBytes(versionId: string): Uint8Array | null;
  retainSourceBytes(versionId: string, bytes: Uint8Array): void;
  artifact(versionId: string): ExtractionArtifact | null;
  /** Extracts a version through the worker and stores the artifact. Returns the cached artifact when the extractor identity already matches. */
  extract(versionId: string, inputPath: string, signal?: AbortSignal): Promise<ExtractionArtifact>;
  /**
   * Stores an artifact the caller produced itself, for a source whose text is
   * already known. The artifact is persisted like a worker extraction, so a
   * later rebuild finds the same source instead of an empty collection.
   */
  recordArtifact(versionId: string, artifact: ExtractionArtifact): ExtractionArtifact;
  /** Restores a document, its immutable version, and its stored artifact from export data. Idempotent under the same content hash. */
  restore(input: { document: SourceDocument; version: { contentHash: string; byteSize: number; observedAt: string }; artifact: ExtractionArtifact | null }): SourceVersion;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Application service for documents. Ingesting the same bytes for a document is
 * idempotent: the store returns the existing version instead of a duplicate.
 * Extraction is skipped when an artifact for the version was produced by the
 * same extractor identity, so a re-run does not discard a valid artifact.
 */
export function createDocumentsService(store: DocumentStore, worker?: ExtractionWorker): DocumentsService {
  return {
    ingest: ({ documentId, name, collectionId, bytes }) => {
      const document = store.ensureDocument(newSourceDocument(documentId, name, collectionId));
      const contentHash = hashBytes(bytes);
      const { version, created } = store.recordVersion({ documentId, contentHash, byteSize: bytes.byteLength, observedAt: new Date().toISOString() });
      const vaultRoot = configuredVaultRoot();
      if (vaultRoot) {
        storeSourceOriginal({
          vaultRoot,
          collectionId,
          documentId,
          name,
          kind: document.kind,
          bytes,
          extension: extensionFromName(name) ?? undefined,
        });
      }
      return { document, version, created };
    },
    documents: (collectionId: string | null) => store.listDocuments(collectionId),
    // Index/runtime only: vault originals under sources/ are never deleted here.
    deleteDocument: (documentId) => store.deleteDocument(documentId),
    clearPersonalData: () => store.clearPersonalData(),
    versions: (documentId: string) => store.versionsOf(documentId),
    version: (versionId: string) => store.getVersion(versionId),
    sourceBytes: (versionId: string) => {
      const version = store.getVersion(versionId);
      if (!version) return null;
      const vaultRoot = configuredVaultRoot();
      if (vaultRoot) {
        const document = store.getDocument(version.documentId);
        if (!document) throw new Error('Unknown source document for version.');
        const fromVault = readSourceOriginal({
          vaultRoot,
          collectionId: document.collectionId,
          contentHash: version.contentHash,
        });
        if (!fromVault) throw new Error(`Vault original missing for content hash ${version.contentHash}.`);
        return fromVault;
      }
      return store.readBytes(versionId);
    },
    retainSourceBytes: (versionId, bytes) => {
      const version = store.getVersion(versionId);
      if (!version || version.contentHash !== hashBytes(bytes) || version.byteSize !== bytes.byteLength) throw new Error('Source bytes do not match the stored version.');
      store.saveBytes(versionId, bytes);
      const vaultRoot = configuredVaultRoot();
      if (vaultRoot) {
        const document = store.getDocument(version.documentId);
        if (!document) throw new Error('Unknown source document for version.');
        storeSourceOriginal({
          vaultRoot,
          collectionId: document.collectionId,
          documentId: document.id,
          name: document.name,
          kind: document.kind,
          bytes,
          extension: extensionFromName(document.name) ?? undefined,
        });
      }
    },
    artifact: (versionId: string) => store.getArtifact(versionId),
    recordArtifact: (versionId, artifact) => {
      if (!store.getVersion(versionId)) throw new Error('Unknown source version.');
      return store.saveArtifact(versionId, artifact);
    },
    extract: async (versionId: string, inputPath: string, signal?: AbortSignal) => {
      if (!worker) throw new Error('No extraction worker is configured.');
      const version = store.getVersion(versionId);
      if (!version) throw new Error('Unknown source version.');
      const document = store.getDocument(version.documentId);
      if (!document) throw new Error('Unknown source document for version.');
      const existing = store.getArtifact(versionId);
      if (existing && existing.extractor === worker.extractor && existing.extractorVersion === worker.extractorVersion) return existing;
      const { artifact } = await worker.extract({ sourceVersionId: versionId, kind: document.kind, inputPath, signal });
      return store.saveArtifact(versionId, artifact);
    },
    restore: ({ document, version, artifact }) => {
      const restored = store.ensureDocument(document);
      const { version: recorded } = store.recordVersion({ documentId: restored.id, contentHash: version.contentHash, byteSize: version.byteSize, observedAt: version.observedAt });
      if (artifact) store.saveArtifact(recorded.id, artifact);
      return recorded;
    }
  };
}
