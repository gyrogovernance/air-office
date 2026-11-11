/**
 * Workspace bundle assembly. Every entry travels with the provenance needed to
 * verify it on the receiving side: content hashes for versions, the extraction
 * artifact for retrieval continuity, and a payload fingerprint in the manifest.
 * Field selection is whitelist-driven so no future provider, token, or key
 * field can ride into a bundle by accident.
 */
import type { WorkspacePayload, ExportManifest, WorkspaceBundle, ExportedConversation, ExportedMessage, ExportedCollection, ExportedDocument, ExportedVersion } from '@office/contracts/export';
import type { ExtractionArtifact, SourceKind } from '@office/contracts/document';
import type { RichDocumentRecord } from '@office/contracts/rich-document';

export interface ExportSources {
  listConversations(): Promise<{ id: string; createdAt: string }[]>;
  readConversation(id: string): Promise<string>;
  listCollections(): Promise<ExportedCollection[]>;
  listDocuments(): Promise<ExportedDocumentSource[]>;
  artifact(documentId: string, versionId: string): ExtractionArtifact | null;
  sourceBytes?(documentId: string, versionId: string): Uint8Array | null;
  listRichDocuments?(): Promise<RichDocumentRecord[]>;
  listMethods?(): Promise<unknown[]>;
  listWorkspaceNodes?(): Promise<{ nodes: unknown[]; disconnectedFolders: number }>;
  listAutomations?(): Promise<{ schedules: unknown[]; omittedSchedules: number }>;
}

export interface ExportedDocumentSource {
  id: string;
  name: string;
  kind: SourceKind;
  collectionId: string | null;
  createdAt: string;
  versions: { id: string; contentHash: string; byteSize: number; observedAt: string }[];
}

const MESSAGE_COLUMNS = ['id', 'parentId', 'role', 'content', 'complete', 'runId', 'createdAt'] as const;

function pickMessage(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of MESSAGE_COLUMNS) out[column] = row[column] ?? null;
  if (typeof row.modelId === 'string') out.modelId = row.modelId;
  if (typeof row.modelIndex === 'number') out.modelIndex = row.modelIndex;
  if (Array.isArray(row.output)) out.output = row.output.map(pickOutputBlock).filter((block) => block !== null);
  if (Array.isArray(row.statusHistory)) out.statusHistory = row.statusHistory.map(pickStatusEntry).filter((entry) => entry !== null);
  if (row.usage !== null && typeof row.usage === 'object' && row.usage !== undefined) {
    const usage = row.usage as Record<string, unknown>;
    if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number') out.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  }
  if (row.error !== null && typeof row.error === 'object' && row.error !== undefined) {
    const error = row.error as Record<string, unknown>;
    if (typeof error.code === 'string' && typeof error.message === 'string') out.error = { code: error.code, message: error.message, ...(error.retryable === true ? { retryable: true } : {}) };
  }
  if (Array.isArray(row.files)) out.files = row.files.filter((file): file is string => typeof file === 'string').slice(0, 200);
  if (Array.isArray(row.attachments)) out.attachments = row.attachments.map(pickAttachment).filter((item) => item !== null);
  return out;
}

/**
 * Each new field is copied field by field rather than spread, so an unknown key
 * on a source row cannot ride into a bundle. Blocks and attachments keep only
 * the shape the receiving side validates.
 */
function pickOutputBlock(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const block = value as Record<string, unknown>;
  if (typeof block.kind !== 'string') return null;
  const out: Record<string, unknown> = { kind: block.kind };
  if (typeof block.text === 'string') out.text = block.text;
  if (typeof block.toolCallId === 'string') out.toolCallId = block.toolCallId;
  if (typeof block.name === 'string') out.name = block.name;
  if (block.arguments !== undefined && typeof block.arguments === 'object' && block.arguments !== null && !Array.isArray(block.arguments)) out.arguments = block.arguments;
  if (block.result !== undefined) out.result = block.result;
  if (typeof block.status === 'string') out.status = block.status;
  if (typeof block.message === 'string') out.message = block.message;
  if (typeof block.sourceId === 'string') out.sourceId = block.sourceId;
  if (typeof block.mimeType === 'string') out.mimeType = block.mimeType;
  return out;
}

function pickStatusEntry(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.at !== 'string' || typeof entry.label !== 'string' || typeof entry.state !== 'string') return null;
  const out: Record<string, unknown> = { at: entry.at, label: entry.label, state: entry.state };
  if (typeof entry.detail === 'string') out.detail = entry.detail;
  return out;
}

function pickAttachment(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const attachment = value as Record<string, unknown>;
  if (typeof attachment.id !== 'string' || typeof attachment.kind !== 'string' || typeof attachment.label !== 'string') return null;
  const out: Record<string, unknown> = { id: attachment.id, kind: attachment.kind, label: attachment.label };
  if (typeof attachment.version === 'string') out.version = attachment.version;
  return out;
}

function pickConversation(raw: Record<string, unknown>, id: string, fallbackCreatedAt: string): ExportedConversation {
  const conversation: ExportedConversation = {
    id,
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : fallbackCreatedAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : fallbackCreatedAt,
    messages: (Array.isArray(raw.messages) ? raw.messages : []).map((row) => ({ ...pickMessage(row as Record<string, unknown>), parentId: ((row as Record<string, unknown>).parentId ?? null) as string | null, runId: ((row as Record<string, unknown>).runId ?? null) as string | null }) as ExportedMessage)
  };
  if (raw.pinned === true) conversation.pinned = true;
  if (typeof raw.archivedAt === 'string') conversation.archivedAt = raw.archivedAt;
  if (Array.isArray(raw.tags)) conversation.tags = raw.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 25);
  if (typeof raw.folderId === 'string') conversation.folderId = raw.folderId;
  if (typeof raw.unreadAt === 'string') conversation.unreadAt = raw.unreadAt;
  return conversation;
}

export async function buildWorkspaceBundle(sources: ExportSources): Promise<WorkspaceBundle> {
  const conversations: ExportedConversation[] = [];
  for (const file of await sources.listConversations()) {
    const raw = JSON.parse(await sources.readConversation(file.id)) as Record<string, unknown>;
    conversations.push(pickConversation(raw, file.id, file.createdAt));
  }
  const collections: ExportedCollection[] = await sources.listCollections();
  const documents: ExportedDocument[] = [];
  let versionCount = 0;
  for (const doc of await sources.listDocuments()) {
    const versions: ExportedVersion[] = doc.versions.map((version) => {
      versionCount += 1;
      return {
        contentHash: version.contentHash,
        byteSize: version.byteSize,
        observedAt: version.observedAt,
        artifact: sources.artifact(doc.id, version.id),
        sourceBase64: (() => { const bytes = sources.sourceBytes?.(doc.id, version.id); return bytes ? Buffer.from(bytes).toString('base64') : null; })()
      };
    });
    documents.push({ id: doc.id, name: doc.name, kind: doc.kind, collectionId: doc.collectionId, createdAt: doc.createdAt, path: `documents/${doc.id}`, versions });
  }
  const richDocuments = sources.listRichDocuments ? await sources.listRichDocuments() : [];
  const methods = sources.listMethods ? await sources.listMethods() : [];
  const workspace = sources.listWorkspaceNodes ? await sources.listWorkspaceNodes() : { nodes: [], disconnectedFolders: 0 };
  const automations = sources.listAutomations ? await sources.listAutomations() : { schedules: [], omittedSchedules: 0 };
  const payload: WorkspacePayload = { conversations, collections, documents, richDocuments, methods, workspaceNodes: workspace.nodes, disconnectedFolders: workspace.disconnectedFolders, automations: automations.schedules, omittedSchedules: automations.omittedSchedules };
  const manifest: ExportManifest = {
    exportId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: 'workspace-bundle',
    counts: {
      conversations: conversations.length,
      collections: collections.length,
      documents: documents.length,
      versions: versionCount
    },
    payloadSha256: await sha256(JSON.stringify(payload))
  };
  return { manifest, payload };
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
