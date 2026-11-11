/**
 * Plain-language Ask-first copy. Users approve everyday actions — create a
 * note, edit a file, remember a fact — not internal storage jargon.
 */

export type ToolApprovalCopy = {
  title: string;
  message: string;
  detail?: string;
  detailLabel?: string;
  confirmLabel: string;
  destructive?: boolean;
};

const text = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === 'string' ? (args[key] as string).trim() : '';

const clip = (value: string, limit = 1200): string =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

function shellCommand(args: Record<string, unknown>): string {
  return text(args, 'command') || text(args, 'fullCommandText') || text(args, 'cmd');
}

function isShellTool(name: string): boolean {
  return name === 'run_command' || name === 'shell' || name === 'bash' || name === 'powershell' || name === 'cmd';
}

function fileLeaf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const leaf = normalized.split('/').filter(Boolean).at(-1);
  return leaf || path;
}

/** Builds the Ask-first dialog for one tool approval request. */
export function toolApprovalCopy(name: string, args: Record<string, unknown>): ToolApprovalCopy {
  if (name === 'schedule_run') {
    return {
      title: 'Run this schedule now?',
      message: 'This starts a saved schedule once, right away.',
      detail: text(args, 'name') || text(args, 'path') || undefined,
      detailLabel: text(args, 'name') ? 'Schedule' : 'File',
      confirmLabel: 'Run schedule',
    };
  }
  if (name === 'action_run') {
    return {
      title: 'Run this Action?',
      message: 'This runs a saved Action from your library on the material you provided.',
      detail: text(args, 'path') || undefined,
      detailLabel: 'Action',
      confirmLabel: 'Run Action',
    };
  }
  if (isShellTool(name)) {
    const command = shellCommand(args);
    const intention = text(args, 'intention');
    const writes = args.hasWriteFileRedirection === true;
    const bypass = args.requestSandboxBypass === true;
    const reason = text(args, 'requestSandboxBypassReason');
    const context = [
      intention || 'AIR Office wants to run a terminal command on this computer.',
      writes ? 'This command may create or overwrite files.' : '',
      bypass ? (reason || 'This would run with fewer safety limits than usual.') : '',
    ].filter(Boolean).join('\n\n');
    return {
      title: bypass ? 'Allow this command with fewer limits?' : 'Allow this terminal command?',
      message: context,
      detail: command ? clip(command) : undefined,
      detailLabel: name === 'powershell' ? 'PowerShell' : name === 'bash' ? 'Bash' : 'Command',
      confirmLabel: 'Allow',
      ...(writes || bypass ? { destructive: true } : {}),
    };
  }
  if (name === 'write') {
    const path = text(args, 'fileName') || 'a file';
    const intention = text(args, 'intention');
    const diff = text(args, 'diff');
    return {
      title: 'Update this file?',
      message: intention || `AIR Office wants to change ${fileLeaf(path)}.`,
      detail: diff ? clip(diff, 1600) : path,
      detailLabel: diff ? 'Proposed change' : 'File',
      confirmLabel: 'Allow edit',
    };
  }
  if (name === 'read') {
    const path = text(args, 'path');
    const intention = text(args, 'intention');
    return {
      title: 'Allow reading this file?',
      message: intention || 'AIR Office wants to read a file from your workspace.',
      detail: path ? clip(path) : undefined,
      detailLabel: 'File',
      confirmLabel: 'Allow',
    };
  }
  if (name === 'url') {
    const bypass = args.requestSandboxBypass === true;
    const reason = text(args, 'requestSandboxBypassReason');
    const intention = text(args, 'intention');
    const url = text(args, 'url');
    return {
      title: bypass ? 'Open this page with fewer limits?' : 'Open this web page?',
      message: [
        intention || 'AIR Office wants to open a web page to help with this answer.',
        bypass ? (reason || 'This page could not be reached with the usual safety limits.') : '',
      ].filter(Boolean).join('\n\n'),
      detail: url || undefined,
      detailLabel: 'Address',
      confirmLabel: 'Allow',
    };
  }
  if (name === 'memory' || name === 'memory_remember') {
    const fact = text(args, 'content');
    return {
      title: 'Remember this for later?',
      message: 'Save a short note so AIR Office can recall it in future chats.',
      detail: fact ? clip(fact, 600) : undefined,
      detailLabel: 'Note',
      confirmLabel: 'Remember',
    };
  }
  if (name === 'memory_update') {
    return {
      title: 'Update this saved note?',
      message: 'Replace a note AIR Office saved earlier.',
      detail: text(args, 'content') ? clip(String(args.content), 600) : undefined,
      detailLabel: 'Note',
      confirmLabel: 'Update',
    };
  }
  if (name === 'memory_forget') {
    return {
      title: 'Forget this saved note?',
      message: 'Remove a note AIR Office saved earlier.',
      detail: text(args, 'id') || undefined,
      detailLabel: 'Saved note',
      confirmLabel: 'Forget',
      destructive: true,
    };
  }
  if (name === 'create') {
    const path = text(args, 'path');
    return {
      title: 'Create this file?',
      message: path
        ? `Create ${fileLeaf(path)} in your workspace.`
        : 'Create a new file in your workspace.',
      detail: path || undefined,
      detailLabel: 'Where',
      confirmLabel: 'Create',
    };
  }
  if (name === 'edit') {
    const path = text(args, 'path');
    return {
      title: 'Edit this file?',
      message: path
        ? `Update ${fileLeaf(path)} in your workspace.`
        : 'Update a file in your workspace.',
      detail: path || undefined,
      detailLabel: 'File',
      confirmLabel: 'Edit',
    };
  }
  if (name === 'apply_markdown_note') {
    const path = text(args, 'path');
    return {
      title: 'Update this note?',
      message: path
        ? `Apply the markdown for ${fileLeaf(path)} into the note.`
        : 'Apply markdown into a note in your workspace.',
      detail: path || undefined,
      detailLabel: 'Note',
      confirmLabel: 'Update note',
    };
  }
  if (name === 'delete') {
    const path = text(args, 'path');
    return {
      title: 'Delete this file?',
      message: path
        ? `Remove ${fileLeaf(path)} from your workspace.`
        : 'Remove a file from your workspace.',
      detail: path || undefined,
      detailLabel: 'File',
      confirmLabel: 'Delete',
      destructive: true,
    };
  }
  if (name === 'move') {
    const path = text(args, 'path');
    const to = text(args, 'to');
    return {
      title: 'Move this file?',
      message: path
        ? (to ? `Move ${fileLeaf(path)} to ${fileLeaf(to)}.` : `Move ${fileLeaf(path)} in your workspace.`)
        : 'Move a file in your workspace.',
      detail: [path, to].filter(Boolean).join(' → ') || undefined,
      detailLabel: 'Where',
      confirmLabel: 'Move',
    };
  }

  const readable = humanToolArguments(args);
  return {
    title: `Allow ${humanToolName(name)}?`,
    message: `AIR Office wants to use ${humanToolName(name)}.`,
    detail: readable || undefined,
    detailLabel: readable ? 'Details' : undefined,
    confirmLabel: 'Allow',
  };
}

function humanToolName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Prefer short labeled fields over a raw JSON dump when asking a person. */
function humanToolArguments(args: Record<string, unknown>): string {
  const preferred = ['path', 'name', 'title', 'fileId', 'query', 'url', 'content', 'prompt'];
  const lines: string[] = [];
  for (const key of preferred) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) lines.push(`${key}: ${clip(value.trim(), 240)}`);
  }
  if (lines.length) return lines.join('\n');
  const keys = Object.keys(args);
  if (!keys.length) return '';
  try {
    return clip(JSON.stringify(args, null, 2), 800);
  } catch {
    return '';
  }
}
