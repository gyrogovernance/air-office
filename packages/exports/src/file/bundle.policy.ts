/**
 * Import-side validation. Rejections happen before any write: format version,
 * bundle-relative paths, payload size, and the manifest fingerprint. Restored
 * rows are assembled from whitelist-selected fields only, so provider
 * configuration or session material can never enter a workspace through a bundle.
 */
import type { WorkspaceBundle, WorkspacePayload, ImportReport, ImportRejection, ExportedConversation, ExportedMessage, ExportedDocument, ExportedCollection, ExportedVersion } from '@office/contracts/export';
import { MAX_BUNDLE_BYTES } from '@office/contracts/export';
import { sha256 } from './file.exports.public';

const REQUIRED_MANIFEST_KEYS = ['exportId', 'createdAt', 'kind', 'counts', 'payloadSha256'];
const REQUIRED_PAYLOAD_KEYS = ['conversations', 'collections', 'documents'];

function reject(code: ImportRejection['code'], message: string): ImportReport {
  return { accepted: false, rejections: [{ code, message }], restored: { conversations: 0, collections: 0, documents: 0, versions: 0 } };
}

function safePath(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return false;
  return !path.split(/[\\/]/u).some((segment) => segment === '..' || segment === '.' || segment === '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function validateBundle(raw: string): Promise<{ bundle: WorkspaceBundle | null; report: ImportReport }> {
  if (new Blob([raw]).size > MAX_BUNDLE_BYTES) return { bundle: null, report: reject('oversized', `Bundle exceeds ${MAX_BUNDLE_BYTES} bytes`) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { bundle: null, report: reject('not-a-bundle', 'Bundle is not valid JSON') };
  }
  if (!isRecord(parsed) || !isRecord(parsed.manifest) || !isRecord(parsed.payload)) return { bundle: null, report: reject('not-a-bundle', 'Bundle missing manifest or payload') };
  for (const key of REQUIRED_MANIFEST_KEYS) {
    if (!(key in parsed.manifest)) return { bundle: null, report: reject('not-a-bundle', `Manifest missing ${key}`) };
  }
  for (const key of REQUIRED_PAYLOAD_KEYS) {
    if (!(key in parsed.payload)) return { bundle: null, report: reject('not-a-bundle', `Payload missing ${key}`) };
  }
  const manifest = parsed.manifest as unknown as WorkspaceBundle['manifest'];
  if (manifest.kind !== 'workspace-bundle') return { bundle: null, report: reject('not-a-bundle', 'This is not a workspace bundle') };
  const payload = parsed.payload as unknown as WorkspacePayload;
  if (!Array.isArray(payload.conversations) || !Array.isArray(payload.collections) || !Array.isArray(payload.documents)) {
    return { bundle: null, report: reject('corrupt', 'Payload collections are not arrays') };
  }
  if (!Array.isArray(payload.richDocuments) || !Array.isArray(payload.methods) || !Array.isArray(payload.workspaceNodes) || !Number.isSafeInteger(payload.disconnectedFolders) || payload.disconnectedFolders < 0 || !Array.isArray(payload.automations) || !Number.isSafeInteger(payload.omittedSchedules) || payload.omittedSchedules < 0) {
    return { bundle: null, report: reject('corrupt', 'Portable workspace data is invalid') };
  }
  for (const document of payload.documents) {
    if (!isRecord(document) || typeof document.path !== 'string' || !safePath(document.path)) {
      return { bundle: null, report: reject('path-traversal', 'A document path escapes the bundle root') };
    }
    if (!['text', 'markdown', 'pdf', 'docx', 'html', 'image', 'unsupported'].includes(String(document.kind))) {
      return { bundle: null, report: reject('corrupt', 'Document kind is not a known source kind') };
    }
    if (typeof document.id !== 'string' || !document.id || typeof document.name !== 'string' || typeof document.createdAt !== 'string' || !(document.collectionId === null || typeof document.collectionId === 'string') || !Array.isArray(document.versions)) return { bundle: null, report: reject('corrupt', 'Document metadata is invalid') };
    if (!document.versions.every((version) => isRecord(version) && typeof version.contentHash === 'string' && /^[a-f0-9]{64}$/.test(version.contentHash) && typeof version.byteSize === 'number' && Number.isSafeInteger(version.byteSize) && version.byteSize >= 0 && typeof version.observedAt === 'string')) return { bundle: null, report: reject('corrupt', 'Document version metadata is invalid') };
    if (!document.versions.every((version) => isRecord(version) && (version.sourceBase64 === null || typeof version.sourceBase64 === 'string'))) {
      return { bundle: null, report: reject('corrupt', 'Document source bytes are invalid') };
    }
  }
  const fingerprint = await sha256(JSON.stringify(payload));
  if (fingerprint !== manifest.payloadSha256) return { bundle: null, report: reject('fingerprint-mismatch', 'Payload does not match its manifest fingerprint') };
  return { bundle: parsed as unknown as WorkspaceBundle, report: { accepted: true, rejections: [], restored: { conversations: 0, collections: 0, documents: 0, versions: 0 } } };
}

export interface RestoredWorkspace {
  conversations: ExportedConversation[];
  collections: ExportedCollection[];
  documents: ExportedDocument[];
}

/** Assembles restored rows from whitelist-validated fields. The caller writes them through authorized ports. */
export function restoreRows(bundle: WorkspaceBundle): RestoredWorkspace {
  const documents: ExportedDocument[] = bundle.payload.documents.map((doc) => ({
    id: String(doc.id),
    name: String(doc.name),
    kind: doc.kind as ExportedDocument['kind'],
    collectionId: doc.collectionId === null ? null : String(doc.collectionId),
    createdAt: String(doc.createdAt),
    path: String(doc.path),
    versions: (doc.versions ?? []).map((version): ExportedVersion => ({
      contentHash: String(version.contentHash),
      byteSize: Number(version.byteSize) || 0,
      observedAt: String(version.observedAt),
      artifact: version.artifact ?? null,
      sourceBase64: version.sourceBase64
    }))
  }));
  return {
    conversations: bundle.payload.conversations.map((conversation) => {
      const restored: ExportedConversation = {
        id: String(conversation.id),
        title: String(conversation.title),
        createdAt: String(conversation.createdAt),
        updatedAt: String(conversation.updatedAt),
        messages: Array.isArray(conversation.messages) ? conversation.messages.map((message): ExportedMessage => {
          const row: ExportedMessage = {
            id: String(message.id),
            parentId: message.parentId === null || message.parentId === undefined ? null : String(message.parentId),
            role: message.role as ExportedMessage['role'],
            content: String(message.content ?? ''),
            complete: Boolean(message.complete),
            runId: message.runId === null || message.runId === undefined ? null : String(message.runId),
            createdAt: String(message.createdAt)
          };
          if (typeof message.modelId === 'string') row.modelId = message.modelId;
          if (typeof message.modelIndex === 'number') row.modelIndex = message.modelIndex;
          if (Array.isArray(message.output)) row.output = message.output;
          if (Array.isArray(message.statusHistory)) row.statusHistory = message.statusHistory;
          if (message.usage !== null && typeof message.usage === 'object' && message.usage !== undefined) row.usage = message.usage;
          if (message.error !== null && typeof message.error === 'object' && message.error !== undefined) row.error = message.error;
          if (Array.isArray(message.files)) row.files = message.files.filter((file) => typeof file === 'string');
          if (Array.isArray(message.attachments)) row.attachments = message.attachments;
          return row;
        }) : []
      };
      if (conversation.pinned === true) restored.pinned = true;
      if (typeof conversation.archivedAt === 'string') restored.archivedAt = conversation.archivedAt;
      if (Array.isArray(conversation.tags)) restored.tags = conversation.tags.filter((tag) => typeof tag === 'string');
      if (typeof conversation.folderId === 'string') restored.folderId = conversation.folderId;
      if (typeof conversation.unreadAt === 'string') restored.unreadAt = conversation.unreadAt;
      return restored;
    }),
    collections: bundle.payload.collections.map((collection) => ({ id: String(collection.id), name: String(collection.name), ...(typeof collection.description === 'string' && collection.description ? { description: collection.description } : {}), createdAt: String(collection.createdAt) })),
    documents
  };
}
