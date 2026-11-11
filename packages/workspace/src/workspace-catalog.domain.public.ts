interface WorkspaceNodeBase {
  id: string;
  name: string;
  instruction: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceNode = WorkspaceNodeBase & (
  | { kind: 'program'; parentId: null }
  | { kind: 'project'; parentId: string }
  | { kind: 'folder'; parentId: string }
  | { kind: 'note'; parentId: string | null; targetId: string }
  | { kind: 'mount'; parentId: string | null; rootId: string }
);

export type WorkspaceNodeInput = { id: string; name: string; instruction?: string } & (
  | { kind: 'program'; parentId?: null }
  | { kind: 'project'; parentId?: string | null }
  | { kind: 'folder'; parentId: string }
  | { kind: 'note'; parentId: string | null; targetId: string }
  | { kind: 'mount'; parentId: string | null; rootId: string }
);

export type PortableWorkspaceNode = Exclude<WorkspaceNodeInput, { kind: 'mount' }>;

/** Validate and order portable nodes so each parent precedes its children. */
export function parsePortableWorkspaceNodes(value: unknown): PortableWorkspaceNode[] | null {
  if (!Array.isArray(value) || value.length > 10000) return null;
  const nodes: PortableWorkspaceNode[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('id' in raw) || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 200 || !('name' in raw) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200 || !('instruction' in raw) || typeof raw.instruction !== 'string' || raw.instruction.length > 20000 || !('kind' in raw) || !('parentId' in raw)) return null;
    const common = { id: raw.id, name: raw.name, instruction: raw.instruction };
    if (raw.kind === 'program' && raw.parentId === null) nodes.push({ ...common, kind: 'program', parentId: null });
    else if ((raw.kind === 'project' || raw.kind === 'folder') && typeof raw.parentId === 'string' && raw.parentId) nodes.push({ ...common, kind: raw.kind, parentId: raw.parentId });
    else if (raw.kind === 'note' && (raw.parentId === null || typeof raw.parentId === 'string' && raw.parentId) && 'targetId' in raw && typeof raw.targetId === 'string' && raw.targetId) nodes.push({ ...common, kind: 'note', parentId: raw.parentId, targetId: raw.targetId });
    else return null;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length || new Set(nodes.filter((node) => node.kind === 'note').map((node) => node.targetId)).size !== nodes.filter((node) => node.kind === 'note').length) return null;
  const names = new Set<string>();
  for (const node of nodes) {
    const key = JSON.stringify([node.parentId ?? null, node.name.trim().toLocaleLowerCase()]);
    if (names.has(key)) return null;
    names.add(key);
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent || node.kind === 'project' && parent.kind !== 'program') return null;
    }
  }
  const ordered: PortableWorkspaceNode[] = [];
  const visited = new Set<string>();
  for (const node of nodes) {
    const path: PortableWorkspaceNode[] = [];
    const visiting = new Set<string>();
    let current: PortableWorkspaceNode | undefined = node;
    while (current && !visited.has(current.id)) {
      if (visiting.has(current.id)) return null;
      visiting.add(current.id);
      path.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const item of path.reverse()) { visited.add(item.id); ordered.push(item); }
  }
  return ordered;
}

export interface WorkspaceNodeUpdate { name?: string; instruction?: string; parentId?: string | null; }
export interface WorkspaceMove { ids: string[]; parentId: string | null; beforeId?: string | null; }
export interface WorkspaceOrganization extends WorkspaceMove {
  chatIds: string[];
  notes: { id: string; targetId: string; name: string }[];
}
export interface WorkspaceRemoval { chatIds: string[]; documentIds: string[]; rootIds: string[]; }
export class WorkspaceError extends Error {
  constructor(message: string, readonly code: 'missing' | 'duplicate' | 'cycle' | 'invalid-parent' | 'invalid') { super(message); }
}
