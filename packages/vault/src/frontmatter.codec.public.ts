export type FrontmatterDocument = {
  data: Record<string, unknown>;
  body: string;
  raw: string;
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): FrontmatterDocument {
  const match = FRONTMATTER.exec(raw);
  if (!match) throw new Error('Missing YAML frontmatter delimited by --- lines.');
  const yamlText = match[1]!;
  const body = match[2] ?? '';
  let data: unknown;
  try {
    data = Bun.YAML.parse(yamlText);
  } catch (error) {
    throw new Error(`Invalid frontmatter YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Frontmatter must be a YAML mapping.');
  }
  return { data: data as Record<string, unknown>, body, raw };
}

export function serializeFrontmatter(data: Record<string, unknown>, body = ''): string {
  const yaml = Bun.YAML.stringify(data).replace(/\s+$/, '');
  const normalizedBody = body.replace(/^\r?\n/, '');
  if (!normalizedBody) return `---\n${yaml}\n---\n`;
  return `---\n${yaml}\n---\n${normalizedBody.endsWith('\n') ? normalizedBody : `${normalizedBody}\n`}`;
}

export function assertNoUnknownKeys(data: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) throw new Error(`Unknown frontmatter key: ${key}`);
  }
}
