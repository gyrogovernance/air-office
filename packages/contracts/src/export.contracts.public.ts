/**
 * Portable workspace export and import contracts. A bundle moves source
 * references with their provenance: every version keeps its content hash so the
 * receiving workspace verifies identity instead of trusting a display name. The
 * payload shape has no field that could carry a provider credential, so a
 * bundle cannot leak one by construction.
 */
import type { ExtractionArtifact, SourceKind } from './document.contracts.public';
import type { RichDocumentRecord } from './rich-document.contracts.public';

/** Upper bound for an import body; larger bundles are rejected before parsing. */
export const MAX_BUNDLE_BYTES = 32_000_000;

export type ExportRole = 'system' | 'user' | 'assistant';

export interface ExportedMessage {
  id: string;
  /** Null for a root message; otherwise the id this message follows. */
  parentId: string | null;
  role: ExportRole;
  content: string;
  complete: boolean;
  /** The chat run that produced an assistant message, kept for provenance. */
  runId: string | null;
  createdAt: string;
  /** Model identity and column index, so a comparison keeps its columns after import. */
  modelId?: string | null;
  modelIndex?: number;
  /** Structured blocks carried by an assistant message, whitelisted field by field. */
  output?: { kind: string; text?: string; toolCallId?: string; name?: string; result?: unknown; status?: string; message?: string; sourceId?: string; mimeType?: string }[];
  statusHistory?: { at: string; label: string; state: string; detail?: string }[];
  usage?: { inputTokens: number; outputTokens: number } | null;
  error?: { code: string; message: string; retryable?: boolean } | null;
  files?: string[];
  attachments?: { id: string; kind: string; label: string; version?: string }[];
}

export interface ExportedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ExportedMessage[];
  /** Sidebar metadata. Absent in a bundle written before these fields existed. */
  pinned?: boolean;
  archivedAt?: string | null;
  tags?: string[];
  folderId?: string | null;
  unreadAt?: string | null;
}

export interface ExportedCollection {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

/** One immutable revision of a source document. The artifact carries extracted portable text when one exists. */
export interface ExportedVersion {
  contentHash: string;
  byteSize: number;
  observedAt: string;
  artifact: ExtractionArtifact | null;
  /** Original bytes, or null when the source was not retained locally. */
  sourceBase64: string | null;
}

export interface ExportedDocument {
  id: string;
  name: string;
  kind: SourceKind;
  collectionId: string | null;
  createdAt: string;
  /** Bundle-relative storage path. Validation rejects anything that escapes the bundle root. */
  path: string;
  versions: ExportedVersion[];
}

export interface WorkspacePayload {
  conversations: ExportedConversation[];
  collections: ExportedCollection[];
  documents: ExportedDocument[];
  richDocuments: RichDocumentRecord[];
  methods: unknown[];
  workspaceNodes: unknown[];
  disconnectedFolders: number;
  automations: unknown[];
  omittedSchedules: number;
}

export interface ExportManifest {
  exportId: string;
  createdAt: string;
  kind: 'workspace-bundle';
  counts: { conversations: number; collections: number; documents: number; versions: number };
  /** Fingerprint of the canonical payload; a modified payload no longer matches. */
  payloadSha256: string;
}

export interface WorkspaceBundle {
  manifest: ExportManifest;
  payload: WorkspacePayload;
}

export interface ExportJob {
  id: string;
  kind: 'workspace-bundle';
  state: 'succeeded' | 'failed';
  createdAt: string;
  finishedAt: string;
  manifest: ExportManifest | null;
  error: string | null;
}

export type ImportRejectionCode = 'oversized' | 'not-a-bundle' | 'path-traversal' | 'corrupt' | 'fingerprint-mismatch';

export interface ImportRejection {
  code: ImportRejectionCode;
  message: string;
}

export interface ImportReport {
  accepted: boolean;
  rejections: ImportRejection[];
  restored: { conversations: number; collections: number; documents: number; versions: number };
  portableWork?: { richDocuments: number; methods: number; workspaceNodes: number; schedules: number; pausedSchedules: number; omittedSchedules: number; conflicts: { kind: 'rich-document' | 'method' | 'workspace' | 'conversation' | 'collection' | 'document' | 'schedule'; id: string }[]; missingSources: string[]; disconnectedFolders: number };
}
