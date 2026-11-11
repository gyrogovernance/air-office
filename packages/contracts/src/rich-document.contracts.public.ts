export type RichDocumentAttachment = { id: string; name: string; mediaType: string; size: number; dataUrl: string };

/**
 * The AIR rich-document envelope. Every stored note carries these fields.
 *
 * The stored body is native Lobe editor JSON. A note is either:
 *  - native: it has a `body` — the shape AIR writes and the only shape it saves; or
 *  - inbound: it still has pre-native `content` from before the native body was
 *    adopted. Inbound notes are read so they can be converted to a native body the
 *    first time they are opened, then re-saved. AIR never writes `content`.
 *
 * The pre-native `content` is either a tree object or a block array — the shape of
 * the value tells them apart. There is no format-version field and no version
 * dispatch anywhere in this envelope.
 */
export type RichDocumentProjection = {
  markdownPath: string;
  sourceJsonHash: string;
  markdownHash: string;
};

export type RichDocumentRecord = {
  format: 'air-office.rich-document';
  id: string;
  title: string;
  updatedAt: string;
  /** Native Lobe editor JSON (`{ root: ... }`). Present on every note AIR writes. */
  body?: unknown;
  /** Pre-native content read for one-time conversion. Never written by AIR. */
  content?: unknown;
  attachments: RichDocumentAttachment[];
  /** Vault-relative path to the canonical `*.note.json` when the vault store owns the note. */
  path?: string;
  /** Program folder slug derived from `programs/<program-slug>/notes/...`. */
  programSlug?: string;
  /** Note file slug (basename without `.note.json`). */
  slug?: string;
  /** Paired markdown projection hashes written beside the canonical JSON. */
  projection?: RichDocumentProjection;
};
export type MethodSetting = { temperature?: number; maxOutputTokens?: number };
export type MethodDefinitionRecord = { kind: 'preset' | 'prompt' | 'skill'; value: Record<string, unknown> };
export type MethodVersionRecord = { id: string; definitionId: string; kind: 'preset' | 'prompt' | 'skill'; revision: number; savedAt: string; value: Record<string, unknown> };
