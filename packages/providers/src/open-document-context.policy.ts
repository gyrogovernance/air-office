/**
 * Prompt lines that identify the open document for path-based tools.
 * When a workspace selection is already supplied, do not demand a full-file
 * read first — that fights Copilot's size cap and burns turns on view/grep.
 */

export type OpenDocumentContextInput = {
  selection?: string;
  fileName?: string;
  fileId?: string;
  workspaceFilePath?: string;
};

function notePath(fileId: string): string {
  return fileId.startsWith('note:') ? fileId.slice('note:'.length) : fileId;
}

function selectionGuidance(hasSelection: boolean): string {
  if (!hasSelection) {
    return 'Prefer view_range or grep for large files rather than reading the entire file at once.';
  }
  return 'A workspace selection is already supplied as reference material — treat that text as the passage to explain, answer about, or rewrite. Do not open the whole file first. Only use view or grep when you need surrounding lines or to apply an edit; prefer view_range over a full read.';
}

/** Copilot session: first-party file tools own the path. */
export function copilotOpenDocumentContext(input: OpenDocumentContextInput): string | null {
  const hasSelection = Boolean(input.selection?.trim());
  const guide = selectionGuidance(hasSelection);
  if (input.workspaceFilePath) {
    const label = input.fileName ?? input.workspaceFilePath;
    return `The connected-folder file open in the editor right now is "${label}" at path ${input.workspaceFilePath}. When the user says "this file" without another name, they mean it. Read and edit it with Copilot first-party file tools against that path. ${guide}`;
  }
  if (input.fileName && input.fileId) {
    const path = notePath(input.fileId);
    const memory = hasSelection
      ? ''
      : ' Its content was not sent with this request: do not answer from a guessed memory of the note; read the needed span first.';
    return `The AIR Office note open in the editor right now is "${input.fileName}" at vault path ${path}. When the user says "this document" or "this note" without another name, they mean it.${memory} Use path-based view, create, edit, glob, and grep against that path, and apply_markdown_note when applying Markdown onto the note pair. ${guide}`;
  }
  return null;
}

/** Lean local: AIR builtins own the path. */
export function leanOpenDocumentContext(input: OpenDocumentContextInput): string | null {
  const hasSelection = Boolean(input.selection?.trim());
  const guide = selectionGuidance(hasSelection);
  if (input.fileName && input.fileId?.startsWith('note:')) {
    return `The AIR Office note open in the editor right now is "${input.fileName}" at vault path ${notePath(input.fileId)}. When the user says "this document" or "this note" without another name, they mean it. Use view, create, edit, glob, and grep against that path, and apply_markdown_note when applying Markdown onto the note pair. ${guide}`;
  }
  if (input.fileId) {
    const openPath = input.workspaceFilePath ?? input.fileId;
    return `The file open in the editor right now is "${input.fileName ?? openPath}" at path ${openPath}. When the user says "this file" or "this document" without another name, they mean it. Use view, create, edit, glob, and grep against that path. ${guide}`;
  }
  if (input.workspaceFilePath) {
    return `A connected-folder file is open at ${input.workspaceFilePath}. Use view, create, edit, glob, and grep against that path. ${guide}`;
  }
  return null;
}
