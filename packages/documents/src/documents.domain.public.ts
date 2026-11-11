import type {
  ExtractionArtifact,
  ExtractionWarning,
  SourceAnchor,
  SourceDocument,
  SourceKind
} from '@office/contracts/document';

export type {
  ExtractionArtifact,
  ExtractionWarning,
  ExtractionWarningCode,
  ExtractedPage,
  SourceAnchor,
  SourceAnchorKind,
  SourceDocument,
  SourceKind,
  SourceVersion
} from '@office/contracts/document';

/** Maps a file extension to a source kind. An unknown extension is explicitly unsupported rather than guessed. */
export function sourceKindForName(name: string): SourceKind {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (extension === '.txt') return 'text';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.pdf') return 'pdf';
  if (extension === '.docx') return 'docx';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tiff'].includes(extension)) return 'image';
  return 'unsupported';
}

/**
 * Builds one-based page anchors for every page recorded on an extraction
 * artifact. Callers resolve these against the stored artifact of a preserved
 * source version; Docling geometry/bbox remapping is out of scope here.
 */
export function pageAnchorsForArtifact(sourceVersionId: string, artifact: ExtractionArtifact): SourceAnchor[] {
  if (artifact.pageCount === null || artifact.pageCount < 1) return [];
  return Array.from({ length: artifact.pageCount }, (_, index) => ({
    sourceVersionId,
    extractionVersion: artifact.extractionVersion,
    kind: 'page' as const,
    page: index + 1
  }));
}

/**
 * Resolves a source anchor against an extraction artifact. A page anchor is
 * valid when the artifact has that one-based page; when per-page text is stored,
 * the resolved text is that page's extraction. A text-range anchor is valid when
 * its UTF-8 byte range lies within the extraction text. An anchor that does not
 * resolve is reported unresolved so the caller can mark the citation rather than
 * present it as verified.
 */
export function resolveAnchor(anchor: SourceAnchor, artifact: ExtractionArtifact): { resolved: boolean; text: string } {
  if (artifact.extractionVersion !== anchor.extractionVersion) return { resolved: false, text: '' };
  const byteLength = new TextEncoder().encode(artifact.text).length;
  if (anchor.kind === 'text-range') {
    const start = anchor.startByte ?? -1;
    const end = anchor.endByte ?? -1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > byteLength) return { resolved: false, text: '' };
    const bytes = new TextEncoder().encode(artifact.text).slice(start, end);
    try {
      return { resolved: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
    } catch {
      return { resolved: false, text: '' };
    }
  }
  if (anchor.kind === 'page') {
    if (artifact.pageCount === null || anchor.page === undefined || anchor.page < 1 || anchor.page > artifact.pageCount) return { resolved: false, text: '' };
    const page = artifact.pages?.find((entry) => entry.page === anchor.page);
    return { resolved: true, text: page?.text ?? '' };
  }
  return { resolved: false, text: '' };
}

/** True when the artifact carries a warning that a caller must surface before trusting the extraction. */
export function hasBlockingWarning(artifact: ExtractionArtifact): boolean {
  return artifact.warnings.some((warning) => warning.code === 'corrupt' || warning.code === 'encrypted');
}

export function newSourceDocument(id: string, name: string, collectionId: string | null, createdAt = new Date().toISOString()): SourceDocument {
  return { id, collectionId, name, kind: sourceKindForName(name), createdAt };
}
