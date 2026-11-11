import type { ExtractionArtifact, SourceDocument, SourceVersion } from '@office/contracts/document';

/**
 * Persistence boundary for documents. Source versions are immutable: recording a
 * version with a content hash that already exists is idempotent and returns the
 * existing version rather than creating a duplicate.
 */
export interface RecordVersionInput {
  documentId: string;
  contentHash: string;
  byteSize: number;
  observedAt: string;
}

export interface DocumentStore {
  ensureDocument(document: SourceDocument): SourceDocument;
  getDocument(documentId: string): SourceDocument | null;
  listDocuments(collectionId: string | null): SourceDocument[];
  /** Records an observed revision. Returns the existing version when the hash already exists. */
  recordVersion(input: RecordVersionInput): { version: SourceVersion; created: boolean };
  getVersion(versionId: string): SourceVersion | null;
  saveBytes(versionId: string, bytes: Uint8Array): void;
  readBytes(versionId: string): Uint8Array | null;
  versionsOf(documentId: string): SourceVersion[];
  saveArtifact(versionId: string, artifact: ExtractionArtifact): ExtractionArtifact;
  getArtifact(versionId: string): ExtractionArtifact | null;
  deleteDocument(documentId: string): void;
  clearPersonalData(): number;
  close(): void;
}
