/**
 * Document and source contracts. A source document has stable identity; each
 * observed revision becomes an immutable source version keyed by a content hash.
 * Extraction output is derived data tied to one version, so a citation can always
 * be traced back to the exact bytes it came from.
 */

export type SourceKind = 'text' | 'markdown' | 'pdf' | 'docx' | 'html' | 'image' | 'unsupported';

export interface SourceDocument {
  id: string;
  collectionId: string | null;
  name: string;
  kind: SourceKind;
  createdAt: string;
}

export interface SourceVersion {
  id: string;
  documentId: string;
  /** SHA-256 of the source bytes, lowercase hex. Two versions never share this. */
  contentHash: string;
  byteSize: number;
  observedAt: string;
}

export type ExtractionWarningCode =
  | 'ocr-low-confidence'
  | 'encrypted'
  | 'corrupt'
  | 'unsupported-format'
  | 'truncated'
  | 'empty-content';

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  message: string;
  /** One-based page the warning applies to, when known. */
  page?: number;
}

export type SourceAnchorKind = 'page' | 'text-range';

/** A resolvable location in a source version. Page numbers are one-based; text offsets are UTF-8 bytes in the normalized extraction. */
export interface SourceAnchor {
  sourceVersionId: string;
  extractionVersion: string;
  kind: SourceAnchorKind;
  page?: number;
  startByte?: number;
  endByte?: number;
}

export interface ExtractedPage {
  /** One-based page number in the preserved source. */
  page: number;
  /** Normalized text observed on that page. */
  text: string;
}

export interface ExtractionArtifact {
  /** Extractor identity plus its version, so a change in output is explainable. */
  extractor: string;
  extractorVersion: string;
  /** Version of the anchor addressing scheme, so a stored anchor is only resolved against a matching extraction. */
  extractionVersion: string;
  /** Normalized extracted text. */
  text: string;
  /** One-based page count when the format has pages. */
  pageCount: number | null;
  /** Optional per-page text so page anchors can resolve against the stored extraction of a preserved original. */
  pages?: ExtractedPage[];
  warnings: ExtractionWarning[];
  contentHash: string;
  createdAt: string;
}
