import { validateAttachment } from './rich-document-attachment.domain.public';
import { emptyNativeBody } from './rich-document-native-bridge.domain.public';

export const RICH_DOCUMENT_FORMAT = 'air-office.rich-document';

export type RichDocumentAttachment = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  dataUrl: string;
};

/**
 * The canonical AIR rich document: an envelope around a native Lobe editor body.
 *
 * This is the only shape AIR writes. There is no format-version field and no
 * version dispatch anywhere in this model — Lobe owns the body structure, AIR
 * owns the envelope. The body is Lobe's serialized editor state (`{ root: ... }`);
 * the node ids inside it are session-scoped and are re-keyed by Lobe on load, so
 * AIR treats the body as opaque and never matches on ids across sessions.
 */
export type RichDocumentProjection = {
  markdownPath: string;
  sourceJsonHash: string;
  markdownHash: string;
};

export type RichDocument = {
  format: typeof RICH_DOCUMENT_FORMAT;
  id: string;
  title: string;
  updatedAt: string;
  /** Native Lobe editor JSON (`{ root: ... }`). */
  body: unknown;
  attachments: RichDocumentAttachment[];
  /** Vault-relative path to the canonical `*.note.json` when stored in the vault. */
  path?: string;
  programSlug?: string;
  slug?: string;
  projection?: RichDocumentProjection;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A native body is Lobe's serialized editor state: an object carrying a `root`. */
export function isNativeBody(value: unknown): boolean {
  return object(value) && object(value.root);
}

/** Envelope fields common to native and inbound notes. */
function envelopeValid(value: Record<string, unknown>): boolean {
  if (value.format !== RICH_DOCUMENT_FORMAT) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return false;
  const attachments = value.attachments;
  if (!Array.isArray(attachments) || !attachments.every(validateAttachment)) return false;
  return new Set(attachments.map((item) => (item as RichDocumentAttachment).id)).size === attachments.length;
}

/** True only for a native document. This is the gate for saves and drafts. */
export function validateRichDocument(value: unknown): value is RichDocument {
  return object(value) && isNativeBody(value.body) && envelopeValid(value);
}

/**
 * True for a stored note that still carries pre-native `content` (a tree object
 * or a block array) and no native body. Read for one-time conversion only.
 */
export function isInboundRichDocument(value: unknown): boolean {
  if (!object(value) || !envelopeValid(value)) return false;
  if (isNativeBody(value.body)) return false;
  return object(value.content) || Array.isArray(value.content);
}

/** A valid, empty native document for a brand-new note. */
export function createRichDocument(
  title = 'Untitled note',
  id: string = crypto.randomUUID(),
): RichDocument {
  return {
    format: RICH_DOCUMENT_FORMAT,
    id,
    title,
    updatedAt: new Date().toISOString(),
    body: emptyNativeBody(),
    attachments: []
  };
}

// Lobe-native conversion, re-exported for callers that read or write Markdown.
export { markdownToNativeBody, nativeBodyToMarkdown, nativeBodyContentKey, emptyNativeBody, sanitizeNativeBodyMath, isProseMistakenForMath } from './rich-document-native-bridge.domain.public';

// One-time inbound bootstrap and native export.
export { ensureNativeRichDocument, documentMarkdown, exportRichDocument } from './rich-document-converter.domain.public';
export type { ConversionReport, RichExportResult } from './rich-document-converter.domain.public';
