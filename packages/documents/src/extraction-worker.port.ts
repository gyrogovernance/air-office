import type { ExtractionArtifact, SourceKind } from '@office/contracts/document';

/**
 * Extraction boundary. The worker receives already-materialized input (a path to
 * a bounded scratch copy or raw bytes) and returns a normalized artifact. It
 * never opens the application database and never decides source identity; it
 * reports warnings and refusal honestly so the caller can surface them.
 */
export interface ExtractionRequest {
  sourceVersionId: string;
  kind: SourceKind;
  /** Absolute path to a bounded scratch copy of the source bytes. */
  inputPath: string;
  /** Signals cooperative cancellation to the worker. */
  signal?: AbortSignal;
}

export interface ExtractionResult {
  artifact: ExtractionArtifact;
}

export interface ExtractionWorker {
  /** Worker protocol identity, so a version mismatch is detectable before work. */
  readonly protocolVersion: number;
  readonly extractor: string;
  readonly extractorVersion: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
