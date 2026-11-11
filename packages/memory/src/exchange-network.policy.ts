import type { ExchangeReference } from './episodic-memory.policy';

/** Packs count distinct messages along one retained path; a fork requires a selected branch. */
export function exchangePack(records: readonly ExchangeReference[], recordId: string, size: 12 | 24) {
  const byId = new Map(records.map(record => [record.record_id, record]));
  const anchor = byId.get(recordId);
  if (!anchor) return null;
  const children = new Map<string, ExchangeReference[]>();
  for (const record of records) {
    if (!record.previous_record_id || record.conversation_id !== anchor.conversation_id) continue;
    const siblings = children.get(record.previous_record_id) ?? [];
    siblings.push(record); children.set(record.previous_record_id, siblings);
  }
  const past: ExchangeReference[] = [];
  const seen = new Set([recordId]);
  let first = anchor;
  while (first.previous_record_id) {
    const previous = byId.get(first.previous_record_id);
    if (!previous || seen.has(previous.record_id) || previous.conversation_id !== anchor.conversation_id || previous.snapshot_ids[2] !== first.snapshot_ids[0]) break;
    past.push(previous); seen.add(previous.record_id); first = previous;
  }
  const chain = [...past.reverse(), anchor];
  const anchorPosition = past.length * 2 + 1;
  const start = Math.floor(anchorPosition / size) * size;
  let last = anchor;
  while (chain.length * 2 + 1 < start + size) {
    const next = (children.get(last.record_id) ?? []).filter(record => record.snapshot_ids[0] === last.snapshot_ids[2] && !seen.has(record.record_id));
    if (next.length !== 1 || !next[0]) break;
    last = next[0]; chain.push(last); seen.add(last.record_id);
  }
  const firstRecord = Math.max(0, Math.floor((start - 2) / 2));
  const related = chain.slice(firstRecord, Math.ceil((start + size) / 2));
  const positions = new Map<number, string>();
  related.forEach((record, index) => record.snapshot_ids.forEach((id, offset) => {
    const position = (firstRecord + index) * 2 + offset;
    if (position >= start && position < start + size) positions.set(position, id);
  }));
  const selected = [...positions.entries()].sort((a, b) => a[0] - b[0]).map(item => item[1]);
  const selectedIds = new Set(selected);
  return { requested_count: size, message_count: selected.length, complete: selected.length === size, start_position: start,
    snapshot_ids: selected, record_ids: related.filter(record => record.snapshot_ids.some(id => selectedIds.has(id))).map(record => record.record_id) };
}
