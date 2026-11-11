/**
 * Mention and note-link navigation for chat (CHAT-159).
 *
 * Chat text can reference workspace objects with @Title (notes, files,
 * programs, conversations) and wiki-style links [label](note:Title),
 * [label](note:vault/path.md), or [label](air-file:path). The policy parses
 * these shapes out of plain text and resolves them against a supplied target
 * list, so navigation never invents a destination and an unknown reference
 * renders as ordinary text.
 */

export type MentionTargetKind = 'note' | 'file' | 'program' | 'conversation';

export interface MentionTarget {
  id: string;
  kind: MentionTargetKind;
  title: string;
}

export interface ParsedMentionSegment {
  kind: 'text' | 'mention';
  text: string;
  target?: MentionTarget;
}

function resolveNoteLink(raw: string, targets: MentionTarget[]): MentionTarget | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const byId = targets.find((item) => item.kind === 'note' && item.id === value);
  if (byId) return byId;
  const byTitle = targets.find((item) => item.kind === 'note' && item.title.toLowerCase() === value.toLowerCase());
  if (byTitle) return byTitle;
  if (value.includes('/') || /\.(md|note\.json)$/i.test(value)) {
    return { id: value, kind: 'note', title: value.split('/').pop() ?? value };
  }
  return undefined;
}

function resolveFileLink(raw: string, targets: MentionTarget[]): MentionTarget | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  return targets.find((item) => item.kind === 'file' && (item.id === value || item.title.toLowerCase() === value.toLowerCase()))
    ?? { id: value, kind: 'file', title: value.split(/[\\/]/).pop() ?? value };
}

/** Finds @Title and [label](note:…|air-file:…) references in one line of chat text. */
export function parseMentions(text: string, targets: MentionTarget[]): ParsedMentionSegment[] {
  const segments: ParsedMentionSegment[] = [];
  const push = (segment: ParsedMentionSegment) => {
    const last = segments.at(-1);
    if (segment.kind === 'text' && last?.kind === 'text') last.text += segment.text;
    else segments.push(segment);
  };
  const linkPattern = /\[([^\]]+)\]\((note|air-file):([^)]+)\)|@/g;
  let cursor = 0;
  for (const match of text.matchAll(linkPattern)) {
    const start = match.index ?? 0;
    if (match[1] !== undefined) {
      if (start > cursor) push({ kind: 'text', text: text.slice(cursor, start) });
      const scheme = match[2] ?? 'note';
      const reference = match[3]?.trim() ?? '';
      const target = scheme === 'air-file'
        ? resolveFileLink(reference, targets)
        : resolveNoteLink(reference, targets);
      push(target ? { kind: 'mention', text: match[1], target } : { kind: 'text', text: match[0] });
      cursor = start + match[0].length;
      continue;
    }
    // @Title: match the longest known target title at this position.
    if (start > cursor) push({ kind: 'text', text: text.slice(cursor, start) });
    const rest = text.slice(start + 1);
    const lower = rest.toLowerCase();
    const candidates = targets
      .filter((item) => item.title && lower.startsWith(item.title.toLowerCase()))
      .sort((a, b) => b.title.length - a.title.length);
    const target = candidates[0];
    if (target) {
      push({ kind: 'mention', text: `@${target.title}`, target });
      cursor = start + 1 + target.title.length;
    } else {
      push({ kind: 'text', text: '@' });
      cursor = start + 1;
    }
  }
  if (cursor < text.length) push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

type MentionName = string | { id: string; title: string };

function namedTarget(kind: MentionTargetKind, value: MentionName): MentionTarget {
  if (typeof value === 'string') return { id: value, kind, title: value };
  return { id: value.id, kind, title: value.title };
}

/** Collects mention targets from the workspace names a chat can see. Note entries may carry vault paths as ids. */
export function mentionTargetsFrom(names: {
  notes?: MentionName[];
  files?: MentionName[];
  programs?: MentionName[];
  conversations?: MentionName[];
}): MentionTarget[] {
  return [
    ...(names.notes ?? []).map((value) => namedTarget('note', value)),
    ...(names.files ?? []).map((value) => namedTarget('file', value)),
    ...(names.programs ?? []).map((value) => namedTarget('program', value)),
    ...(names.conversations ?? []).map((value) => namedTarget('conversation', value)),
  ];
}
