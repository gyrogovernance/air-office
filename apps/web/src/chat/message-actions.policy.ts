import type { ConversationGraph } from '@office/chat/domain';

/**
 * Policy for the message actions the thread offers: what a delete removes,
 * which follow-up questions a settled answer can suggest, and where ratings
 * with their optional reason are kept on this machine. Every function is
 * pure over its inputs so the dialog copy and the stored outcome agree.
 */

export interface MessageDeletePlan {
  /** The message and everything below it: the branch this delete removes. */
  messageIds: string[];
  /** Replies below the message, excluding the message itself. */
  replyCount: number;
  /** Whether a fork sits at or beside this message, so the wider scope is offered. */
  branchPoint: boolean;
}

/** Maps a message to its subtree, walking children breadth-first so a deep reply chain is kept whole. */
function collectSubtree(graph: ConversationGraph, messageId: string): string[] {
  const ids = [messageId];
  const queue = [messageId];
  while (queue.length) {
    const cursor = queue.shift()!;
    for (const child of graph.messages) {
      if (child.parentId !== cursor || ids.includes(child.id)) continue;
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

/**
 * Plans a deletion: the branch always goes with its replies so no stored row
 * is left pointing at a removed parent, and the dialog gains the
 * conversation-wide choice only where branches actually fork.
 */
export function planMessageDelete(graph: ConversationGraph, messageId: string): MessageDeletePlan | null {
  const target = graph.messages.find((message) => message.id === messageId);
  if (!target) return null;
  const messageIds = collectSubtree(graph, messageId);
  const forks = graph.messages.filter((message) => message.parentId === messageId).length;
  const siblings = graph.messages.filter((message) => message.parentId === target.parentId).length;
  return { messageIds, replyCount: messageIds.length - 1, branchPoint: forks > 1 || siblings > 1 };
}

const QUESTION_HEADING = /^(follow[- ]?ups?|next steps|you could ask|suggested questions|questions)\b/i;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const HEADING_MARKER = /^\s*#{1,6}\s+/;
const BOLD_LINE = /^\s*\*\*(.+?)\*\*\s*$/;
/** Assistant host offers are questions to the user, not prompts the user should send next. */
const ASSISTANT_OFFER = /^(?:(?:hey|hi|hello)[!.,]?\s+)*(?:how (?:can|may) i (?:help|assist)|what (?:can|would) you like|what do you (?:need|want)|how can i help you today)\b/i;

function headingText(line: string): string | null {
  const match = line.match(HEADING_MARKER);
  if (match) return line.slice(match[0].length).trim();
  const bold = line.match(BOLD_LINE);
  return bold ? bold[1]!.trim() : null;
}

function cleanCandidate(text: string): string | null {
  const value = text.replace(/\s+/g, ' ').replace(/^[`*_>"']+/, '').replace(/[`*_]+$/, '').trim();
  if (value.length < 8 || value.length > 160) return null;
  return value;
}

/**
 * Pulls follow-up questions out of a settled answer: question lines on their
 * own and list items under a follow-up heading, in reading order, deduplicated
 * and capped. An answer without candidates yields nothing, so the thread never
 * invents questions the model did not raise. Assistant greetings and host
 * offers that end in "?" are not user follow-ups.
 */
export function deriveFollowUps(content: string, limit = 3): string[] {
  const bounded = Math.max(1, Math.floor(limit));
  const whole = content.replace(/\s+/g, ' ').trim().toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();
  let underQuestionHeading = false;
  for (const raw of content.split(/\r?\n/)) {
    const heading = headingText(raw);
    if (heading !== null) {
      underQuestionHeading = QUESTION_HEADING.test(heading);
      continue;
    }
    const isListItem = LIST_MARKER.test(raw);
    const text = (isListItem ? raw.replace(LIST_MARKER, '') : raw).trim();
    if (!text.endsWith('?') && !(isListItem && underQuestionHeading)) continue;
    const statement = text.lastIndexOf('. ');
    const candidate = !isListItem && statement >= 0 ? text.slice(statement + 2) : text;
    const value = cleanCandidate(candidate);
    if (!value) continue;
    const key = value.toLowerCase();
    // A chip that would resend the whole reply (or the assistant's own offer) is not a follow-up.
    if (!underQuestionHeading && !isListItem && (key === whole || ASSISTANT_OFFER.test(value))) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(value);
    if (found.length >= bounded) break;
  }
  return found;
}

export type MessageRatingValue = 'up' | 'down';

export interface MessageRating {
  value: MessageRatingValue;
  reason: string;
}

function ratingsKey(conversationId: string): string {
  return `air-office:chat-ratings:${conversationId}`;
}

export function normalizeRating(value: unknown): MessageRating | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.value !== 'up' && record.value !== 'down') return null;
  return { value: record.value, reason: typeof record.reason === 'string' ? record.reason.slice(0, 500) : '' };
}

function normalizeRatings(value: unknown): Record<string, MessageRating> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ratings: Record<string, MessageRating> = {};
  for (const [messageId, entry] of Object.entries(value as Record<string, unknown>)) {
    const rating = normalizeRating(entry);
    if (rating) ratings[messageId] = rating;
  }
  return ratings;
}

export function readRatings(conversationId: string, storage?: Storage): Record<string, MessageRating> {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(ratingsKey(conversationId));
    return raw ? normalizeRatings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Stores one rating, or clears it when the rating is null, keeping the rest of the conversation untouched. */
export function writeRating(conversationId: string, messageId: string, rating: MessageRating | null, storage?: Storage): Record<string, MessageRating> {
  const ratings = readRatings(conversationId, storage);
  if (rating) ratings[messageId] = { value: rating.value, reason: rating.reason.slice(0, 500) };
  else delete ratings[messageId];
  try { (storage ?? globalThis.localStorage)?.setItem(ratingsKey(conversationId), JSON.stringify(ratings)); } catch { /* browser persistence is optional */ }
  return ratings;
}
