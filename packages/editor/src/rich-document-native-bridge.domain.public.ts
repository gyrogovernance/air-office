import { createHeadlessEditor } from '@lobehub/editor';

/**
 * Lobe-native conversion bridge.
 *
 * Lobe owns Markdown and editor-state structure. AIR never reconstructs a
 * document from Markdown by hand: every Markdown ↔ native-body conversion runs
 * through Lobe's headless kernel, which is lossless in both directions (verified
 * against the pinned package). This module has no AIR-side dependencies so it can
 * be imported by the model, the inbound bootstrap, and the app without cycles.
 *
 * Native ids emitted here are session-scoped: they are stable for the lifetime of
 * the editor that produced them, so bodies are treated as opaque payloads and are
 * re-keyed by Lobe whenever they are loaded into a new editor.
 */

type HeadlessLike = {
  hydrateMarkdown(markdown: string, options?: unknown): unknown;
  hydrateEditorData(editorData: unknown, options?: unknown): unknown;
  exportState(options?: unknown): { editorData: unknown; markdown: string };
  destroy?: () => void;
};

function withHeadless<T>(run: (editor: HeadlessLike) => T): T {
  const editor = createHeadlessEditor() as unknown as HeadlessLike;
  try {
    return run(editor);
  } finally {
    try { editor.destroy?.(); } catch { /* A failed teardown must not mask the result. */ }
  }
}

/**
 * Lobe turns `$…$` into an inline math widget. A currency span such as
 * `US$6.3 … $1.5` becomes one of those widgets: jammed glyphs in the note, and
 * a click selects the whole chunk for the chat AI-edit handoff. Real formulas
 * stay compact (`$a+b$`, `$E=mc^2$`); prose-sized spans are restored as text.
 */
export function isProseMistakenForMath(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  const letterRuns = trimmed.match(/[A-Za-z]{2,}/g) ?? [];
  if (letterRuns.length >= 2) return true;
  if (letterRuns.length === 1 && letterRuns[0]!.length >= 4 && /\d/.test(trimmed) && /\s/.test(trimmed)) return true;
  if (trimmed.length > 60) return true;
  return false;
}

function plainTextNode(text: string): Record<string, unknown> {
  return { detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 };
}

/** Replace prose-sized inline math nodes with literal `$…$` text. */
export function sanitizeNativeBodyMath(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    if (record.type === 'math' && typeof record.code === 'string' && isProseMistakenForMath(record.code)) {
      return plainTextNode(`$${record.code}$`);
    }
    let next: Record<string, unknown> | null = null;
    if (record.root && typeof record.root === 'object') {
      const root = walk(record.root);
      if (root !== record.root) next = { ...(next ?? record), root };
    }
    if (Array.isArray(record.children)) {
      let changed = false;
      const children = record.children.map((child) => {
        const childNext = walk(child);
        if (childNext !== child) changed = true;
        return childNext;
      });
      if (changed) next = { ...(next ?? record), children };
    }
    return next ?? node;
  };
  return walk(body);
}

/** Convert Markdown to a native Lobe body (`{ root: ... }`). */
export function markdownToNativeBody(markdown: string): unknown {
  return withHeadless((editor) => {
    editor.hydrateMarkdown(markdown);
    return sanitizeNativeBodyMath(editor.exportState().editorData);
  });
}

/** Convert a native Lobe body back to Markdown. */
export function nativeBodyToMarkdown(body: unknown): string {
  return withHeadless((editor) => {
    editor.hydrateEditorData(body);
    return editor.exportState().markdown;
  });
}

/**
 * Content key for a native body. Node ids are session-scoped and re-allocated on
 * every load, so they are stripped: identical structure means identical content.
 * Serializer output has a fixed key order, so the stringify is stable.
 */
export function nativeBodyContentKey(body: unknown): string {
  return JSON.stringify(body, (key, value) => (key === 'id' ? undefined : value));
}

let cachedEmptyBody: unknown;

/**
 * A valid, empty native body for a brand-new document: a root holding one empty
 * paragraph (a bare empty root is rejected by Lexical, and must never be seeded).
 * Built once through Lobe's own serializer so it matches what the editor returns
 * when it is read back, then reused. That makes id-stripped change detection see
 * a freshly opened empty document as unchanged.
 */
export function emptyNativeBody(): unknown {
  if (cachedEmptyBody === undefined) {
    const seed = { root: { type: 'root', children: [{ type: 'paragraph', children: [], direction: null, format: '', indent: 0, version: 1 }], direction: null, format: '', indent: 0, version: 1 } };
    try {
      cachedEmptyBody = withHeadless((editor) => {
        editor.hydrateEditorData(seed);
        return editor.exportState().editorData;
      });
    } catch {
      // Document creation must never throw; the seed itself is a valid shape.
      cachedEmptyBody = seed;
    }
  }
  return structuredClone(cachedEmptyBody);
}
