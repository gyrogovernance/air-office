import { atomicWriteText } from './atomic-write.adapter';

export function parseJsonlLines<T>(bytes: string, validate: (value: unknown) => value is T): T[] {
  const lines = bytes.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const items: T[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!validate(parsed)) throw new Error(`Invalid JSONL record at line ${index + 1}.`);
    items.push(parsed);
  }
  return items;
}

export function serializeJsonl<T>(items: readonly T[]): string {
  if (items.length === 0) return '';
  return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
}

export function rewriteJsonlFile<T>(
  absolutePath: string,
  items: readonly T[],
): void {
  atomicWriteText(absolutePath, serializeJsonl(items));
}
