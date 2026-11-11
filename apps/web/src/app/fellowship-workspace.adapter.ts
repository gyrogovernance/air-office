import type { RichDocument } from '@office/editor/rich-document-domain';
import type { WorkspaceNode, WorkspaceNodeInput } from '@office/workspace/domain';
import type { ServiceClient } from '../shared/service-client.hook';
import { fellowshipProgramInstruction, fellowshipRouteInstruction, type FellowshipPlan } from './fellowship-workspace.policy';

async function createWorkspaceNode(client: ServiceClient, nodes: WorkspaceNode[], input: WorkspaceNodeInput): Promise<WorkspaceNode> {
  const { node } = await client.json<{ node: WorkspaceNode }>('/api/v1/workspace/nodes', { method: 'POST', body: JSON.stringify(input) });
  nodes.push(node);
  return node;
}

export async function prepareResearchProject(client: ServiceClient, plan: FellowshipPlan): Promise<WorkspaceNode> {
  const { nodes } = await client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes');
  const selected = plan.parentId ? nodes.find((node) => node.id === plan.parentId) : undefined;
  if (plan.parentId && (!selected || selected.kind !== 'program' && selected.kind !== 'project')) throw new Error('Choose an available program or project.');
  if (selected?.kind === 'project') return selected;
  const program = selected ?? nodes.find((node) => node.kind === 'program' && node.name.toLocaleLowerCase() === 'air fellowship')
    ?? await createWorkspaceNode(client, nodes, { id: crypto.randomUUID(), kind: 'program', name: 'AIR Fellowship', instruction: fellowshipProgramInstruction() });
  const name = plan.question.trim().slice(0, 160);
  return nodes.find((node) => node.kind === 'project' && node.parentId === program.id && node.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    ?? createWorkspaceNode(client, nodes, { id: crypto.randomUUID(), kind: 'project', parentId: program.id, name, instruction: `${fellowshipProgramInstruction()}\n\n${fellowshipRouteInstruction(plan.route)}` });
}

export async function filePreparedNote(client: ServiceClient, stored: RichDocument, parentId: string): Promise<void> {
  const { nodes } = await client.json<{ nodes: WorkspaceNode[] }>('/api/v1/workspace/nodes');
  if (!nodes.some((node) => node.id === parentId && (node.kind === 'program' || node.kind === 'project'))) throw new Error('Choose an available program or project.');
  await client.json('/api/v1/workspace/nodes', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), kind: 'note', parentId, name: stored.title, targetId: stored.path ?? stored.id } satisfies WorkspaceNodeInput) });
}
